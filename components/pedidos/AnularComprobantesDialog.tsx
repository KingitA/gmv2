"use client"

// Anular todos los comprobantes del pedido para volver a facturarlo (#19/#20).
// La lógica es de cuentas corrientes y listas de precios: GET/POST
// /api/pedidos/[id]/anular-comprobantes. Acá solo se muestra y se confirma.

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react"
import { moneda } from "@/lib/formato"

type Anulable = { id: string; tipo_comprobante: string; numero_comprobante: string; total_factura: number }
type Evaluacion = { puede: boolean; motivo: string | null; aAnular: Anulable[] }
type Resultado = { a_favor: number; anulados: unknown[]; advertencias?: string[] }

const FISCALES = new Set(["FA", "FB", "FC", "NCA", "NCB", "NCC", "NDA", "NDB", "NDC"])

export function AnularComprobantesDialog({
  pedidoId,
  numeroPedido,
  open,
  onOpenChange,
  onAnulado,
}: {
  pedidoId: string
  numeroPedido: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAnulado: (completo: boolean) => void
}) {
  const [evaluacion, setEvaluacion] = useState<Evaluacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [anulando, setAnulando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    if (!open) return
    setEvaluacion(null); setError(null); setResultado(null)
    fetch(`/api/pedidos/${pedidoId}/anular-comprobantes`)
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || "No se pudo revisar el pedido")
        setEvaluacion(j)
      })
      .catch((e) => setError(e.message))
  }, [open, pedidoId])

  const anular = async () => {
    setAnulando(true); setError(null)
    try {
      const r = await fetch(`/api/pedidos/${pedidoId}/anular-comprobantes`, { method: "POST" })
      const j = await r.json()
      if (!r.ok) {
        // Corte a mitad: lo anulado queda anulado; volviendo a tocar sigue con lo pendiente
        const pend = Array.isArray(j.pendientes) && j.pendientes.length ? ` Quedan sin anular: ${j.pendientes.join(", ")}. Volvé a tocar "Anular" para seguir.` : ""
        throw new Error((j.error || j.motivo || "No se pudieron anular los comprobantes") + pend)
      }
      setResultado(j)
      onAnulado(true)
    } catch (e: any) {
      setError(e.message)
      onAnulado(false)
    } finally {
      setAnulando(false)
    }
  }

  const hayFiscal = evaluacion?.aAnular.some((c) => FISCALES.has(c.tipo_comprobante)) ?? false

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!anulando) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular comprobantes · Pedido #{numeroPedido}</DialogTitle>
          <DialogDescription>Para volver a facturarlo con otras condiciones.</DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                <strong>Comprobantes anulados.</strong> El pedido sigue en su estado: cambiá las condiciones (Editar pedido) o Repreciar, y volvé a Generar.
              </p>
            </div>
            {resultado.a_favor > 0 && (
              <p className="text-slate-600">Lo que ya había pagado contra este pedido (<strong>{moneda(resultado.a_favor)}</strong>) se aplica al comprobante nuevo cuando lo vuelvas a generar.</p>
            )}
            {resultado.advertencias?.map((a, i) => <p key={i} className="text-amber-700">{a}</p>)}
            <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Listo</Button></div>
          </div>
        ) : !evaluacion && !error ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />Revisando el pedido…
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {evaluacion && evaluacion.aAnular.length > 0 && (
              <div className="rounded-lg border divide-y">
                {evaluacion.aAnular.map((c) => (
                  <div key={c.id} className="flex justify-between px-3 py-2">
                    <span className="font-medium text-slate-700">{c.tipo_comprobante} {c.numero_comprobante}</span>
                    <span className="tabular-nums text-slate-600">{moneda(c.total_factura)}</span>
                  </div>
                ))}
              </div>
            )}
            {evaluacion && !evaluacion.puede && evaluacion.motivo && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">{evaluacion.motivo}</p>
            )}
            {evaluacion?.puede && hayFiscal && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>La nota de crédito se emite en ARCA y no se puede deshacer.</p>
              </div>
            )}
            {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={anulando} onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button variant="destructive" disabled={anulando || !evaluacion?.puede || !evaluacion.aAnular.length} onClick={anular}>
                {anulando ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Anulando</> : "Anular"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
