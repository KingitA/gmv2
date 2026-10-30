"use client"

// Facturar varios pedidos tildados de una vez (P2-22, /clientes-pedidos).
// El servidor (POST /api/comprobantes-venta/generar-lote) los factura uno atrás
// del otro con el mismo circuito que "Generar" y devuelve cuál salió y cuál no.
// Acá solo se confirma y se muestra el resultado.

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react"

export const MAX_FACTURAR_JUNTOS = 30

type PedidoAFacturar = { id: string; numero_pedido: string; estado: string; cliente: string }
type Resultado = {
  pedido_id: string
  ok: boolean
  comprobantes?: { tipo_comprobante: string; numero: string }[]
  error?: string
}

export function FacturarVariosDialog({
  pedidos,
  open,
  onOpenChange,
  onTerminado,
}: {
  pedidos: PedidoAFacturar[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onTerminado: () => void
}) {
  const [facturando, setFacturando] = useState(false)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setResultados(null); setError(null) }
  }, [open])

  const otroEstado = pedidos.filter((p) => p.estado !== "pendiente_facturacion")
  const demasiados = pedidos.length > MAX_FACTURAR_JUNTOS
  const pedidoDe = new Map(pedidos.map((p) => [p.id, p]))

  const facturar = async () => {
    setFacturando(true); setError(null)
    try {
      const r = await fetch("/api/comprobantes-venta/generar-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_ids: pedidos.map((p) => p.id) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "No se pudieron facturar los pedidos")
      setResultados(j.resultados || [])
      onTerminado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setFacturando(false)
    }
  }

  const ok = resultados?.filter((r) => r.ok).length ?? 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!facturando) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Facturar {pedidos.length === 1 ? "1 pedido" : `${pedidos.length} pedidos`}</DialogTitle>
          <DialogDescription>
            {resultados ? `Salieron ${ok} de ${resultados.length}.` : "Se facturan uno atrás del otro, igual que con Generar en cada pedido."}
          </DialogDescription>
        </DialogHeader>

        {resultados ? (
          <div className="space-y-3 text-sm">
            <div className="max-h-80 overflow-y-auto rounded-lg border divide-y">
              {resultados.map((r) => {
                const p = pedidoDe.get(r.pedido_id)
                return (
                  <div key={r.pedido_id} className="flex items-start gap-2 px-3 py-2">
                    {r.ok
                      ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                      : <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-700">#{p?.numero_pedido} · <span className="font-normal">{p?.cliente}</span></div>
                      <div className={r.ok ? "text-slate-500" : "text-red-700"}>
                        {r.ok
                          ? (r.comprobantes?.length ? r.comprobantes.map((c) => `${c.tipo_comprobante} ${c.numero}`).join(" · ") : "Sin nada para facturar")
                          : r.error || "No se pudo facturar"}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Listo</Button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {demasiados && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                Se pueden facturar hasta {MAX_FACTURAR_JUNTOS} pedidos por vez. Destildá {pedidos.length - MAX_FACTURAR_JUNTOS}.
              </p>
            )}
            {otroEstado.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  {otroEstado.length === 1 ? "1 pedido no está" : `${otroEstado.length} pedidos no están`} en Pendiente Facturación:{" "}
                  {otroEstado.map((p) => `#${p.numero_pedido}`).join(", ")}. Se intentan facturar igual; si no se puede, el resultado dice por qué.
                </p>
              </div>
            )}
            {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={facturando} onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={facturando || demasiados || !pedidos.length} onClick={facturar}>
                {facturando ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Facturando…</> : "Facturar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
