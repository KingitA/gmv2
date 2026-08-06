"use client"

// Cierre del día de caja chica desde la Caja del Día.
// Los cobros ya impactaron la caja al registrarse (y se imputan con su chip
// Imputar); el cierre es el arqueo: contás el efectivo, se verifican en lote
// los cobros del día (segunda firma) y la diferencia queda como ajuste
// auditado (RPC cierre_caja_confirmar) con nota obligatoria.

import { useEffect, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })

export function CerrarDia({
  fecha,
  cajaChicaId,
  cajaChicaNombre,
  onCerrar,
  onListo,
}: {
  fecha: string
  cajaChicaId: string
  cajaChicaNombre: string
  onCerrar: () => void
  onListo: () => void
}) {
  const { toast } = useToast()
  const [teorico, setTeorico] = useState<number | null>(null)
  const [sinVerificar, setSinVerificar] = useState<{ id: string; desc: string; monto: number }[]>([])
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({})
  const [contado, setContado] = useState("")
  const [notas, setNotas] = useState("")
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    fetch(`/api/finanzas/cierres?fecha=${fecha}`)
      .then((r) => r.json())
      .then((d) => {
        const caja = (d.cajas || []).find((c: any) => c.cuenta_id === cajaChicaId)
        setTeorico(caja ? Number(caja.saldos?.BLANCO ?? 0) : null)
        // Cobros confirmados del día sin segunda firma (efectivo/cheque; las
        // transferencias se cruzan en conciliación bancaria)
        const pagos = (d.pagos_sin_verificar || [])
          .filter((p: any) =>
            (p.pagos_detalle || []).some((det: any) => !["transferencia", "deposito"].includes(det.tipo_pago))
          )
          .map((p: any) => ({
            id: p.id,
            desc: p.clientes?.nombre ?? "pago",
            monto: Number(p.monto),
          }))
        setSinVerificar(pagos)
        setSeleccion(Object.fromEntries(pagos.map((p: any) => [p.id, true])))
      })
      .catch(() => {})
  }, [fecha, cajaChicaId])

  const contadoNum = Number(contado.replace(",", ".")) || 0
  const diferencia = teorico != null && contado !== "" ? contadoNum - teorico : null

  const cerrar = async () => {
    if (contado === "" || isNaN(contadoNum)) {
      toast({ variant: "destructive", title: "Falta el conteo", description: "Ingresá el efectivo contado" })
      return
    }
    if (diferencia !== null && diferencia !== 0 && !notas.trim()) {
      toast({
        variant: "destructive",
        title: "Hay diferencia — contá el motivo",
        description: "Antes de cerrar con diferencia, dejá una nota (queda auditada en el ajuste).",
      })
      return
    }
    setGuardando(true)
    try {
      const abrirRes = await fetch("/api/finanzas/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abrir", fecha, cuenta_id: cajaChicaId }),
      })
      const abrir = await abrirRes.json()
      if (!abrirRes.ok) throw new Error(abrir.error || "No se pudo abrir el cierre")

      const confRes = await fetch("/api/finanzas/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirmar",
          cierre_id: abrir.cierre_id,
          saldo_contado: contadoNum,
          pago_ids: Object.entries(seleccion)
            .filter(([, v]) => v)
            .map(([id]) => id),
          notas: notas || null,
        }),
      })
      const conf = await confRes.json()
      if (!confRes.ok) throw new Error(conf.error || "No se pudo confirmar el cierre")

      toast({
        title: "Día cerrado",
        description:
          diferencia && diferencia !== 0
            ? `Caja chica cerrada con ajuste auditado de $ ${fmt(Math.abs(diferencia))}.`
            : "Caja chica cerrada sin diferencia.",
      })
      onListo()
    } catch (e: any) {
      toast({ variant: "destructive", title: "El cierre no se completó", description: e.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900">
          Cerrar el día — {cajaChicaNombre} · {fecha.split("-").reverse().join("/")}
        </h3>

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <span>
            Efectivo esperado: <b style={NUM}>{teorico != null ? `$ ${fmt(teorico)}` : "…"}</b>
          </span>
          <span className="flex items-center gap-1.5">
            contado:
            <input
              value={contado}
              onChange={(e) => setContado(e.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              placeholder="0"
              className="w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-right text-sm font-semibold outline-none focus:border-blue-500"
              style={NUM}
            />
          </span>
          {diferencia === null ? null : diferencia === 0 ? (
            <span className="rounded-full bg-green-100 px-3 py-0.5 text-[11px] font-bold text-green-700">
              ✓ La caja da bien
            </span>
          ) : (
            <span className="rounded-full bg-red-100 px-3 py-0.5 text-[11px] font-bold text-red-700" style={NUM}>
              {diferencia > 0 ? "Sobra" : "Falta"} $ {fmt(Math.abs(diferencia))}
            </span>
          )}
        </div>

        {diferencia !== null && diferencia !== 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <b>Antes de cerrar con diferencia, revisá:</b> ¿cobraste a alguien y no lo registraste?
            (cerrá esto y usá la barra de registro) · ¿salió plata sin anotar? (viáticos, gastos →
            Mover plata) · ¿una rendición quedó sin controlar? Si la diferencia es real, dejá la
            nota y cerrá: queda como ajuste auditado.
          </div>
        )}

        {sinVerificar.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Cobros del día a verificar (segunda firma)
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {sinVerificar.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={!!seleccion[p.id]}
                    onChange={(e) => setSeleccion((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  <span className="flex-1 truncate">{p.desc}</span>
                  <span className="font-semibold" style={NUM}>
                    $ {fmt(p.monto)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder={
            diferencia !== null && diferencia !== 0
              ? "Motivo de la diferencia (obligatorio) — ej. faltó registrar viáticos"
              : "Notas del cierre (opcional)"
          }
          rows={2}
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={cerrar}
            disabled={guardando}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              diferencia !== null && diferencia !== 0 ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {guardando
              ? "Cerrando…"
              : diferencia !== null && diferencia !== 0
                ? `Cerrar igual — ajuste de $ ${fmt(Math.abs(diferencia ?? 0))}`
                : "✓ Cerrar el día"}
          </button>
          <button
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
