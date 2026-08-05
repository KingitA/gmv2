"use client"

// Control físico de una rendición desde la Caja del Día (Etapa 3).
// Cuando el chofer/viajante trae el sobre: se coteja cheque por cheque y el
// efectivo contra lo declarado, CON LA PERSONA ADELANTE. Confirmar dispara el
// RPC rendicion_confirmar (efectivo a la caja elegida, transferencias a
// conciliación, diferencia auditada con forzar explícito).

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"
import type { CuentaFondos } from "./registrar-cobro"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })

interface ChequeFisico {
  key: string
  pago_id: string
  cliente: string
  banco: string
  numero: string
  vencimiento: string | null
  monto: number
  color: string | null
}

export function ControlarRendicion({
  rendicionId,
  cuentas,
  onCerrar,
  onListo,
}: {
  rendicionId: string
  cuentas: CuentaFondos[]
  onCerrar: () => void
  onListo: () => void
}) {
  const { toast } = useToast()
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [rendicion, setRendicion] = useState<any>(null)
  const [cheques, setCheques] = useState<ChequeFisico[]>([])
  const [digitales, setDigitales] = useState<{ desc: string; monto: number }[]>([])
  const [pagosDigitales, setPagosDigitales] = useState<string[]>([])
  const [pagosSinColor, setPagosSinColor] = useState<{ pago_id: string; cliente: string }[]>([])
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [colores, setColores] = useState<Record<string, "BLANCO" | "NEGRO">>({})
  const [efectivoContado, setEfectivoContado] = useState("")
  const [cajaDestino, setCajaDestino] = useState("")
  const [requiereForzar, setRequiereForzar] = useState(false)

  const cajas = useMemo(() => cuentas.filter((c) => c.grupo === "EFECTIVO"), [cuentas])

  useEffect(() => {
    const cargar = async () => {
      try {
        const supabase = createClient()
        const { data: rend, error: rendErr } = await supabase
          .from("rendiciones")
          .select("*, rendicion_items(pago_id)")
          .eq("id", rendicionId)
          .single()
        if (rendErr) throw rendErr
        const pagoIds = (rend.rendicion_items || []).map((i: any) => i.pago_id)
        const { data: pagos, error: pagErr } = await supabase
          .from("pagos_clientes")
          .select("id, monto, cliente_id, clientes(nombre), pagos_detalle(*)")
          .in("id", pagoIds.length ? pagoIds : ["00000000-0000-0000-0000-000000000000"])
        if (pagErr) throw pagErr

        const fisicos: ChequeFisico[] = []
        const digs: { desc: string; monto: number }[] = []
        const digPagos: string[] = []
        const sinColor: { pago_id: string; cliente: string }[] = []
        for (const p of pagos || []) {
          const cliente = (p as any).clientes?.nombre ?? "Cliente"
          let soloDigital = true
          for (const d of (p as any).pagos_detalle || []) {
            const esEcheq = d.tipo_pago === "cheque" && d.color_cheque === "ECHEQ"
            if (d.tipo_pago === "cheque" && !esEcheq) {
              soloDigital = false
              fisicos.push({
                key: d.id,
                pago_id: p.id,
                cliente,
                banco: d.banco ?? "—",
                numero: d.numero_cheque ?? "—",
                vencimiento: d.fecha_cheque,
                monto: Number(d.monto),
                color: d.color_cheque,
              })
              if (!d.color_cheque || d.color_cheque === "PENDIENTE") {
                if (!sinColor.some((s) => s.pago_id === p.id)) sinColor.push({ pago_id: p.id, cliente })
              }
            } else if (d.tipo_pago === "efectivo") {
              soloDigital = false
            } else {
              digs.push({
                desc: `${esEcheq ? "⚡ Echeq" : d.tipo_pago === "transferencia" ? "🏦 Transferencia" : "🏧 Depósito"} · ${cliente}`,
                monto: Number(d.monto),
              })
            }
          }
          if (soloDigital) digPagos.push(p.id)
        }
        setRendicion(rend)
        setCheques(fisicos)
        setDigitales(digs)
        setPagosDigitales(digPagos)
        setPagosSinColor(sinColor)
        setEfectivoContado(String(Number(rend.efectivo_declarado ?? 0)))
      } catch (e: any) {
        toast({ variant: "destructive", title: "Error", description: e.message })
        onCerrar()
      } finally {
        setCargando(false)
      }
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendicionId])

  const chequesOk = cheques.filter((c) => checks[c.key])
  const chequesFaltantes = cheques.filter((c) => !checks[c.key])
  const efectivoDeclarado = Number(rendicion?.efectivo_declarado ?? 0)
  const contadoNum = Number(efectivoContado.replace(",", ".")) || 0
  const difEfectivo = contadoNum - efectivoDeclarado

  const confirmar = async (forzar: boolean) => {
    if (!cajaDestino) {
      toast({ variant: "destructive", title: "Falta la caja destino", description: "Elegí a qué caja entra el efectivo" })
      return
    }
    const faltanColores = pagosSinColor.filter((s) => !colores[s.pago_id])
    if (faltanColores.length) {
      toast({
        variant: "destructive",
        title: "Cheques sin color",
        description: `Asigná BLANCO o NEGRO a: ${faltanColores.map((f) => f.cliente).join(", ")}`,
      })
      return
    }
    setGuardando(true)
    try {
      // Verificados: pagos cuyos cheques físicos están todos tildados + los 100% digitales
      const pagosConFisicoCompleto = [...new Set(cheques.map((c) => c.pago_id))].filter(
        (pid) => cheques.filter((c) => c.pago_id === pid).every((c) => checks[c.key])
      )
      const res = await fetch(`/api/finanzas/rendiciones/${rendicionId}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_destino_tipo: "CAJA",
          caja_destino_id: cajaDestino,
          efectivo_declarado: contadoNum,
          pagos_verificados: [...pagosConFisicoCompleto, ...pagosDigitales],
          forzar_diferencia: forzar,
          colores_cheque: Object.keys(colores).length ? colores : undefined,
        }),
      })
      const data = await res.json()
      if (res.status === 409 && data.requiere_forzar) {
        setRequiereForzar(true)
        toast({
          variant: "destructive",
          title: "Hay diferencia de efectivo",
          description: "Revisala con el cobrador. Si es real, confirmá CON diferencia (queda auditada).",
        })
        return
      }
      if (!res.ok) throw new Error(data.error || "Error confirmando la rendición")
      toast({
        title: "Rendición confirmada",
        description: "El efectivo entró a la caja y las transferencias pasaron a conciliación.",
      })
      onListo()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {cargando ? (
          <div className="py-10 text-center text-sm text-slate-400">Cargando rendición…</div>
        ) : (
          <>
            <h3 className="text-base font-bold text-slate-900">
              Controlar rendición — {rendicion?.cobrador_tipo}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Cotejá lo que te entregó contra lo declarado, con la persona adelante. Las
              transferencias y echeqs ya viajan por su canal — esto es solo lo físico.
            </p>

            {/* Cheques físicos */}
            {cheques.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Cheques en el sobre — tildá los que están
                </div>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {cheques.map((c) => (
                    <label
                      key={c.key}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                        checks[c.key] ? "border-green-300 bg-green-50" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!checks[c.key]}
                        onChange={(e) => setChecks((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                        className="h-4 w-4"
                      />
                      <span className="flex-1 min-w-0 truncate">
                        📄 {c.banco} {c.numero}
                        {c.vencimiento ? ` · venc ${c.vencimiento.split("-").reverse().join("/")}` : ""} ·{" "}
                        <span className="text-slate-500">{c.cliente}</span>
                      </span>
                      <span className="font-semibold" style={NUM}>
                        $ {fmt(c.monto)}
                      </span>
                    </label>
                  ))}
                </div>
                {chequesFaltantes.length > 0 && (
                  <p className="mt-1.5 text-xs font-semibold text-amber-700">
                    ⚠ {chequesFaltantes.length} cheque{chequesFaltantes.length > 1 ? "s" : ""} sin
                    tildar: su pago quedará confirmado pero SIN verificar (segunda firma pendiente
                    hasta que aparezca).
                  </p>
                )}
              </div>
            )}

            {/* Colores pendientes */}
            {pagosSinColor.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">
                  Cheques a cuenta sin color — elegí el circuito de cada pago:
                </p>
                {pagosSinColor.map((s) => (
                  <div key={s.pago_id} className="mt-2 flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{s.cliente}</span>
                    {(["BLANCO", "NEGRO"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setColores((prev) => ({ ...prev, [s.pago_id]: c }))}
                        className={`rounded-lg border px-3 py-1 text-xs font-bold ${
                          colores[s.pago_id] === c
                            ? c === "BLANCO"
                              ? "border-slate-800 bg-white ring-2 ring-slate-800"
                              : "border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900"
                            : "border-slate-300 bg-white text-slate-500"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Efectivo */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  💵 Efectivo declarado: <b style={NUM}>$ {fmt(efectivoDeclarado)}</b>
                </span>
                <span className="flex items-center gap-1.5">
                  contado:
                  <input
                    value={efectivoContado}
                    onChange={(e) => setEfectivoContado(e.target.value.replace(/[^\d.,]/g, ""))}
                    inputMode="decimal"
                    className="w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-right text-sm font-semibold outline-none focus:border-blue-500"
                    style={NUM}
                  />
                </span>
                {difEfectivo === 0 ? (
                  <span className="rounded-full bg-green-100 px-3 py-0.5 text-[11px] font-bold text-green-700">
                    ✓ coincide
                  </span>
                ) : (
                  <span className="rounded-full bg-red-100 px-3 py-0.5 text-[11px] font-bold text-red-700" style={NUM}>
                    diferencia {difEfectivo > 0 ? "+" : "−"} $ {fmt(Math.abs(difEfectivo))}
                  </span>
                )}
              </div>
            </div>

            {/* Digitales informativos */}
            {digitales.length > 0 && (
              <div className="mt-3 text-xs text-slate-400">
                Ya asentado aparte:{" "}
                {digitales.map((d) => `${d.desc} $ ${fmt(d.monto)}`).join(" · ")}
              </div>
            )}

            {/* Caja destino + acciones */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Caja destino del efectivo:</span>
              <select
                value={cajaDestino}
                onChange={(e) => setCajaDestino(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Elegir caja…</option>
                {cajas.map((c) => (
                  <option key={c.cuenta_id} value={c.cuenta_id}>
                    💵 {c.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex items-center gap-2">
              {requiereForzar || difEfectivo !== 0 ? (
                <button
                  onClick={() => confirmar(true)}
                  disabled={guardando}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirmar CON diferencia (queda auditada)
                </button>
              ) : (
                <button
                  onClick={() => confirmar(false)}
                  disabled={guardando}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                  ✓ Confirmar — el efectivo entra al arqueo
                </button>
              )}
              <button
                onClick={onCerrar}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
