"use client"

// Cierre del día de caja chica desde la Caja del Día (Etapa 4).
// El corazón del flujo: contás el efectivo, revisás el destino de cada cobro
// del día (comprobante o a cuenta, mismo criterio que choferes/viajantes) y
// un botón imputa todo y cierra la caja. Si no da, primero sugerencias de
// dónde mirar; el ajuste auditado es la última opción (lo registra el RPC
// cierre_caja_confirmar como AJUSTE_CAJA con quién/cuándo/nota).

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })

export interface CobroEnCaja {
  pago_id: string
  cliente_id: string | null
  quien: string
  monto: number
}

interface Comprobante {
  id: string
  numero_comprobante: string
  tipo_comprobante: string
  saldo_pendiente: number
}

export function CerrarDia({
  fecha,
  cajaChicaId,
  cajaChicaNombre,
  cobros,
  usuarioId,
  onCerrar,
  onListo,
}: {
  fecha: string
  cajaChicaId: string
  cajaChicaNombre: string
  cobros: CobroEnCaja[]
  usuarioId: string
  onCerrar: () => void
  onListo: () => void
}) {
  const { toast } = useToast()
  const [teorico, setTeorico] = useState<number | null>(null)
  const [sinVerificar, setSinVerificar] = useState<{ id: string; desc: string }[]>([])
  const [contado, setContado] = useState("")
  const [notas, setNotas] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [progreso, setProgreso] = useState("")
  // Imputación por cobro: comprobante elegido o "" = a cuenta
  const [comprobantes, setComprobantes] = useState<Record<string, Comprobante[]>>({})
  const [eleccion, setEleccion] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch(`/api/finanzas/cierres?fecha=${fecha}`)
      .then((r) => r.json())
      .then((d) => {
        const caja = (d.cajas || []).find((c: any) => c.cuenta_id === cajaChicaId)
        setTeorico(caja ? Number(caja.saldos?.BLANCO ?? 0) : null)
        setSinVerificar(
          (d.pagos_sin_verificar || [])
            .filter((p: any) =>
              (p.pagos_detalle || []).some((det: any) => !["transferencia", "deposito"].includes(det.tipo_pago))
            )
            .map((p: any) => ({ id: p.id, desc: p.clientes?.nombre ?? "pago" }))
        )
      })
      .catch(() => {})
  }, [fecha, cajaChicaId])

  // Comprobantes con saldo de cada cliente de los cobros del día
  useEffect(() => {
    const cargar = async () => {
      const supabase = createClient()
      const porCliente: Record<string, Comprobante[]> = {}
      for (const c of cobros) {
        if (!c.cliente_id || porCliente[c.pago_id]) continue
        const { data } = await supabase
          .from("comprobantes_venta")
          .select("id, numero_comprobante, tipo_comprobante, saldo_pendiente")
          .eq("cliente_id", c.cliente_id)
          .in("estado_pago", ["pendiente", "parcial"])
          .order("fecha", { ascending: true })
          .limit(20)
        porCliente[c.pago_id] = (data || []).map((x: any) => ({
          id: x.id,
          numero_comprobante: x.numero_comprobante,
          tipo_comprobante: x.tipo_comprobante,
          saldo_pendiente: Number(x.saldo_pendiente),
        }))
      }
      setComprobantes(porCliente)
    }
    if (cobros.length) cargar()
  }, [cobros])

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
      // 1. Confirmar e imputar cada cobro del día (mismo circuito que Revisión)
      const confirmados: string[] = []
      for (const c of cobros) {
        setProgreso(`Imputando ${c.quien}…`)
        const compId = eleccion[c.pago_id]
        const comp = compId ? (comprobantes[c.pago_id] || []).find((x) => x.id === compId) : null
        const body: any = { usuario_confirmador: usuarioId, accion: "confirmar" }
        if (comp) {
          body.imputaciones = [
            { comprobante_id: comp.id, monto_imputado: Math.min(c.monto, comp.saldo_pendiente) },
          ]
        }
        const res = await fetch(`/api/pagos/${c.pago_id}/confirmar`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(`${c.quien}: ${data.error || "error al confirmar"}`)
        confirmados.push(c.pago_id)
      }

      // 2. Abrir (o retomar) el cierre de caja chica
      setProgreso("Abriendo cierre…")
      const abrirRes = await fetch("/api/finanzas/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abrir", fecha, cuenta_id: cajaChicaId }),
      })
      const abrir = await abrirRes.json()
      if (!abrirRes.ok) throw new Error(abrir.error || "No se pudo abrir el cierre")

      // 3. Confirmar el cierre: fija el saldo al contado y audita la diferencia
      setProgreso("Confirmando cierre…")
      const confRes = await fetch("/api/finanzas/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirmar",
          cierre_id: abrir.cierre_id,
          saldo_contado: contadoNum,
          pago_ids: [...confirmados, ...sinVerificar.map((p) => p.id)],
          notas: notas || null,
        }),
      })
      const conf = await confRes.json()
      if (!confRes.ok) throw new Error(conf.error || "No se pudo confirmar el cierre")

      toast({
        title: "Día cerrado",
        description:
          cobros.length > 0
            ? `${cobros.length} cobro${cobros.length > 1 ? "s" : ""} imputado${cobros.length > 1 ? "s" : ""} y caja chica cerrada${diferencia ? " con ajuste auditado" : " sin diferencia"}.`
            : `Caja chica cerrada${diferencia ? " con ajuste auditado" : " sin diferencia"}.`,
      })
      onListo()
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "El cierre no se completó",
        description: `${e.message}. Los cobros ya confirmados quedaron confirmados; reintentá el cierre.`,
      })
    } finally {
      setGuardando(false)
      setProgreso("")
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900">
          Cerrar el día — {cajaChicaNombre} · {fecha.split("-").reverse().join("/")}
        </h3>

        {/* Arqueo */}
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

        {/* Sugerencias si no da */}
        {diferencia !== null && diferencia !== 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <b>Antes de cerrar con diferencia, revisá:</b> ¿cobraste a alguien y no lo registraste?
            (cerrá esto y usá la barra de registro) · ¿un monto mal cargado en los cobros de abajo? ·
            ¿salió plata sin anotar? (viáticos, gastos → Mover plata). Si la diferencia es real,
            dejá la nota y cerrá: queda como ajuste auditado.
          </div>
        )}

        {/* Cobros a imputar */}
        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {cobros.length
              ? `Se imputan ${cobros.length} cobro${cobros.length > 1 ? "s" : ""} — revisá el destino de cada uno`
              : "No hay cobros en caja para imputar"}
          </div>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {cobros.map((c) => (
              <div key={c.pago_id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="w-[180px] flex-none truncate font-semibold">{c.quien}</span>
                <span className="w-[110px] flex-none text-right font-semibold" style={NUM}>
                  $ {fmt(c.monto)}
                </span>
                <span className="text-slate-400">→</span>
                <select
                  value={eleccion[c.pago_id] ?? ""}
                  onChange={(e) => setEleccion((prev) => ({ ...prev, [c.pago_id]: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500"
                >
                  <option value="">A cuenta (sin imputar)</option>
                  {(comprobantes[c.pago_id] || []).map((comp) => (
                    <option key={comp.id} value={comp.id}>
                      {comp.tipo_comprobante} {comp.numero_comprobante} — saldo $ {fmt(comp.saldo_pendiente)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Verificación en lote */}
        {sinVerificar.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            También se verifican (segunda firma) {sinVerificar.length} cobro
            {sinVerificar.length > 1 ? "s" : ""} confirmados del día:{" "}
            {sinVerificar.map((p) => p.desc).join(", ")}.
          </p>
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
              ? progreso || "Cerrando…"
              : diferencia !== null && diferencia !== 0
                ? `Cerrar igual — ajuste de $ ${fmt(Math.abs(diferencia ?? 0))}`
                : "✓ Cerrar e imputar todo"}
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
