"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, AlertCircle, Clock, Eye, RefreshCw, X, ChevronDown, ChevronUp } from "lucide-react"
import type { QueueItem } from "@/hooks/use-order-queue"
import type { ParseResult } from "@/lib/actions/ai-order-import"
import { ReviewPedidoDialog } from "./ReviewPedidoDialog"

interface ColaProcesamientoProps {
  queue: QueueItem[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  onConfirmOrder: (itemId: string, items: ParseResult["items"], clienteId: string) => Promise<void>
}

export function ColaProcesamiento({ queue, onRemove, onRetry, onConfirmOrder }: ColaProcesamientoProps) {
  const [expanded, setExpanded] = useState(true)
  const [reviewingItem, setReviewingItem] = useState<QueueItem | null>(null)

  if (queue.length === 0) return null

  const activeCount = queue.filter(i => i.status === "waiting" || i.status === "processing").length
  const reviewCount = queue.filter(i => i.status === "needs_review").length

  return (
    <>
      <div className="border rounded-xl overflow-hidden bg-blue-50 border-blue-200">
        {/* Header */}
        <button
          className="w-full flex items-center justify-between px-5 py-3 hover:opacity-80 transition-opacity"
          onClick={() => setExpanded(p => !p)}
        >
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-blue-900">📋 Cola de procesamiento</span>
            {activeCount > 0 && (
              <Badge className="bg-blue-600 text-white text-xs">{activeCount} procesando</Badge>
            )}
            {reviewCount > 0 && (
              <Badge className="bg-orange-500 text-white text-xs">{reviewCount} para revisar</Badge>
            )}
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-blue-600" /> : <ChevronDown className="h-4 w-4 text-blue-600" />}
        </button>

        {/* Items */}
        {expanded && (
          <div className="px-3 pb-3 space-y-1.5">
            {queue.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between bg-white border border-blue-100 rounded-lg px-4 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.clienteNombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.files.map(f => f.name).join(", ")}
                    </p>
                    {item.status === "done" && item.pedidoNumero && (
                      <p className="text-xs text-green-600 font-semibold">Pedido #{item.pedidoNumero} creado</p>
                    )}
                    {item.status === "error" && item.error && (
                      <p className="text-xs text-destructive">{item.error}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <StatusBadge status={item.status} />

                  {item.status === "needs_review" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50 gap-1"
                      onClick={() => setReviewingItem(item)}
                    >
                      <Eye className="h-3 w-3" />
                      Revisar
                    </Button>
                  )}

                  {item.status === "error" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-blue-600 hover:text-blue-800"
                      onClick={() => onRetry(item.id)}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Reintentar
                    </Button>
                  )}

                  {(item.status === "done" || item.status === "error") && (
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => onRemove(item.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review dialog */}
      {reviewingItem && reviewingItem.parseResult && (
        <ReviewPedidoDialog
          open={true}
          onOpenChange={(open) => { if (!open) setReviewingItem(null) }}
          queueItemId={reviewingItem.id}
          clienteId={reviewingItem.clienteId}
          clienteNombre={reviewingItem.clienteNombre}
          parseResult={reviewingItem.parseResult}
          onConfirm={async (itemId, items, clienteId) => {
            await onConfirmOrder(itemId, items, clienteId)
            setReviewingItem(null)
          }}
        />
      )}
    </>
  )
}

function StatusIcon({ status }: { status: QueueItem["status"] }) {
  switch (status) {
    case "waiting":
      return <Clock className="h-4 w-4 text-blue-400 shrink-0" />
    case "processing":
      return <Loader2 className="h-4 w-4 text-blue-600 animate-spin shrink-0" />
    case "needs_review":
      return <AlertCircle className="h-4 w-4 text-orange-500 shrink-0" />
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
  }
}

function StatusBadge({ status }: { status: QueueItem["status"] }) {
  const config = {
    waiting: { label: "En espera", className: "bg-blue-100 text-blue-700" },
    processing: { label: "Procesando...", className: "bg-blue-600 text-white" },
    needs_review: { label: "Revisar", className: "bg-orange-100 text-orange-700" },
    done: { label: "Listo", className: "bg-green-100 text-green-700" },
    error: { label: "Error", className: "bg-red-100 text-red-700" },
  }[status]

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
