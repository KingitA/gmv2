"use client"

// Modal de confirmación/rechazo de un pago pendiente desde la Caja del Día.
// Mismo backend que Revisión de Pagos: PATCH /api/pagos/[id]/confirmar.
// Si el pago tiene cheques a cuenta sin color, exige elegir BLANCO/NEGRO.

import { useMemo, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"
import { ComprobantesSelector } from "@/components/pagos/ComprobantesSelector"

const ICONO: Record<string, string> = {
  efectivo: "💵",
  transferencia: "🏦",
  deposito: "🏧",
  cheque: "📄",
  echeq: "⚡",
}

const COLOR_BADGE: Record<string, string> = {
  BLANCO: "bg-slate-100 text-slate-700 border border-slate-300",
  NEGRO: "bg-slate-900 text-white",
  ECHEQ: "bg-sky-100 text-sky-700",
  PENDIENTE: "bg-amber-100 text-amber-800",
}

export interface PagoAConfirmar {
  pago_id: string
  quien: string
  monto: number
  detalles: { tipo: string; monto: number; color?: string | null; descripcion: string }[]
  requiere_color: boolean
  accion_texto: string // "Confirmar" | "Aceptar echeq" | ...
  /** Para imputar al confirmar (pagos a cuenta) */
  cliente_id?: string | null
  sin_imputaciones?: boolean
  observaciones?: string | null
}

export function ConfirmarDialog({
  pago,
  usuarioId,
  onCerrar,
  onListo,
}: {
  pago: PagoAConfirmar
  usuarioId: string
  onCerrar: () => void
  onListo: () => void
}) {
  const { toast } = useToast()
  const [modo, setModo] = useState<"confirmar" | "rechazar">("confirmar")
  const [color, setColor] = useState<"BLANCO" | "NEGRO" | "">("")
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)
  // Imputar al confirmar (pagos a cuenta): lo tildado viaja con la confirmación
  const [imputarAhora, setImputarAhora] = useState(false)
  const [seleccionados, setSeleccionados] = useState<Record<string, number>>({})
  const ofreceImputar = Boolean(pago.sin_imputaciones && pago.cliente_id)
  const totalImputado = useMemo(
    () =>
      Object.entries(seleccionados)
        .filter(([k]) => !k.startsWith("pedido:"))
        .reduce((s, [, v]) => s + (Number(v) || 0), 0),
    [seleccionados]
  )
  const excedeImputacion = totalImputado > pago.monto + 0.01

  const ejecutar = async () => {
    if (modo === "confirmar" && excedeImputacion) {
      toast({
        variant: "destructive",
        title: "Imputación mayor al pago",
        description: `Tildaste $ ${totalImputado.toLocaleString("es-AR")} y el pago es de $ ${pago.monto.toLocaleString("es-AR")}. Bajá la selección.`,
      })
      return
    }
    if (modo === "confirmar" && pago.requiere_color && !color) {
      toast({
        variant: "destructive",
        title: "Falta el color del cheque",
        description: "Es un cheque a cuenta: elegí Blanco o Negro antes de confirmar.",
      })
      return
    }
    setGuardando(true)
    try {
      const body: any = { usuario_confirmador: usuarioId, accion: modo }
      if (modo === "confirmar" && color) body.color_cheques = color
      if (modo === "confirmar" && imputarAhora && totalImputado > 0) {
        body.imputaciones = Object.entries(seleccionados)
          .filter(([k, v]) => !k.startsWith("pedido:") && Number(v) > 0)
          .map(([comprobante_id, v]) => ({ comprobante_id, monto_imputado: Number(v) }))
      }
      if (modo === "rechazar") body.motivo_rechazo = motivo || undefined
      const res = await fetch(`/api/pagos/${pago.pago_id}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error procesando el pago")
      const bonifMsg = data.bonificacion?.total
        ? ` NC/REV por 10% contado: $ ${Number(data.bonificacion.total).toLocaleString("es-AR")}.`
        : data.bonificacion_error
          ? ` ⚠ El 10% contado falló: ${data.bonificacion_error}`
          : ""
      toast({
        title: modo === "confirmar" ? "Pago confirmado" : "Pago rechazado",
        description:
          modo === "confirmar"
            ? (data.numero_recibo
                ? `Recibo ${data.numero_recibo} generado; el pago quedó asentado.`
                : "El pago quedó asentado.") + bonifMsg
            : "Quedó registrado como rechazado, sin tocar el saldo.",
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
        className={`w-full ${imputarAhora ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900">
          {modo === "confirmar" ? pago.accion_texto : "Rechazar pago"} — {pago.quien}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Total $ {pago.monto.toLocaleString("es-AR")}
        </p>

        <div className="mt-3 flex flex-col gap-1.5">
          {pago.detalles.map((d, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <span className="text-slate-600">
                {ICONO[d.tipo] ?? "💳"} {d.tipo.charAt(0).toUpperCase() + d.tipo.slice(1)}
                {d.descripcion ? ` · ${d.descripcion}` : ""}
                {d.color && d.color !== "ECHEQ" && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${COLOR_BADGE[d.color] ?? "bg-slate-100 text-slate-600"}`}>
                    {d.color}
                  </span>
                )}
              </span>
              <span className="font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                $ {d.monto.toLocaleString("es-AR")}
              </span>
            </div>
          ))}
        </div>

        {pago.observaciones && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">💬 {pago.observaciones}</p>
        )}

        {/* Imputar al confirmar: pago a cuenta sin imputaciones — lo tildado
            viaja con la confirmación (mismo backend que Revisión de Pagos) */}
        {modo === "confirmar" && ofreceImputar && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={imputarAhora}
                onChange={(e) => { setImputarAhora(e.target.checked); if (!e.target.checked) setSeleccionados({}) }}
                className="h-4 w-4"
              />
              Imputar a comprobantes en este paso (opcional)
            </label>
            {imputarAhora && pago.cliente_id && (
              <div className="mt-2">
                <ComprobantesSelector
                  clienteId={pago.cliente_id}
                  seleccionados={seleccionados}
                  onChange={setSeleccionados}
                />
                <p className={`mt-2 text-xs ${excedeImputacion ? "font-bold text-red-600" : "text-slate-500"}`}>
                  Imputado $ {totalImputado.toLocaleString("es-AR")} de $ {pago.monto.toLocaleString("es-AR")}
                  {excedeImputacion ? " — supera el monto del pago" : ""}
                </p>
              </div>
            )}
          </div>
        )}

        {modo === "confirmar" && pago.requiere_color && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800">
              Cheque a cuenta sin color — elegí el circuito:
            </p>
            <div className="mt-2 flex gap-2">
              {(["BLANCO", "NEGRO"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    color === c
                      ? c === "BLANCO"
                        ? "border-slate-800 bg-white text-slate-900 ring-2 ring-slate-800"
                        : "border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900"
                      : "border-slate-300 bg-white text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {modo === "rechazar" && (
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional) — ej. la transferencia no aparece acreditada"
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            rows={2}
          />
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={ejecutar}
            disabled={guardando || (modo === "confirmar" && excedeImputacion)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              modo === "confirmar" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {modo === "confirmar" ? `✓ ${pago.accion_texto}` : "Rechazar pago"}
          </button>
          {modo === "confirmar" ? (
            <button
              onClick={() => setModo("rechazar")}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Rechazar…
            </button>
          ) : (
            <button
              onClick={() => setModo("confirmar")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Volver
            </button>
          )}
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
