"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { parseOrderFile, processMatches, type ParseResult } from "@/lib/actions/ai-order-import"
import { createPedido } from "@/lib/actions/pedidos"

export type QueueItemStatus = "waiting" | "processing" | "needs_review" | "done" | "error"

export type PedidoOverrides = {
  // General (todo el pedido)
  metodo_facturacion_pedido?: string
  lista_precio_pedido_id?: string
  // Por segmento de proveedor
  lista_limpieza_pedido_id?: string
  metodo_limpieza_pedido?: string
  lista_perf0_pedido_id?: string
  metodo_perf0_pedido?: string
  lista_perf_plus_pedido_id?: string
  metodo_perf_plus_pedido?: string
}

export type QueueItem = {
  id: string
  clienteId: string
  clienteNombre: string
  files: File[]
  status: QueueItemStatus
  overrides?: PedidoOverrides
  parseResult?: ParseResult
  pedidoNumero?: string
  pedidoId?: string
  error?: string
  addedAt: Date
}

export function useOrderQueue(onOrderCreated?: () => void) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const processingRef = useRef(false)

  const addToQueue = useCallback((clienteId: string, clienteNombre: string, files: File[], overrides?: PedidoOverrides) => {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      clienteId,
      clienteNombre,
      files,
      overrides,
      status: "waiting",
      addedAt: new Date(),
    }
    setQueue(prev => [...prev, item])
  }, [])

  const updateItem = useCallback((id: string, changes: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...changes } : item))
  }, [])

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id))
  }, [])

  // Sequential processor: watches queue and processes one at a time
  useEffect(() => {
    const nextWaiting = queue.find(item => item.status === "waiting")
    const isProcessing = queue.some(item => item.status === "processing")

    if (!nextWaiting || isProcessing || processingRef.current) return

    processingRef.current = true
    updateItem(nextWaiting.id, { status: "processing" })

    const process = async () => {
      try {
        // Build FormData from the stored files
        const formData = new FormData()
        for (const file of nextWaiting.files) {
          formData.append("file", file)
        }

        const parseResult = await parseOrderFile(formData)

        // Check if all items are high confidence and we have the client
        const allHigh = parseResult.items.length > 0 &&
          parseResult.items.every(i => i.confidence === "HIGH" && i.matchedProduct)

        if (allHigh) {
          // Auto-create order
          const pedido = await createPedido({
            cliente_id: nextWaiting.clienteId,
            items: parseResult.items.map(i => ({
              producto_id: i.matchedProduct!.id,
              cantidad: i.quantity,
              precio_unitario: i.matchedProduct!.precio_base || 0,
              descuento: 0,
            })),
            observaciones: "Importado vía IA",
            ...nextWaiting.overrides,
          })
          updateItem(nextWaiting.id, {
            status: "done",
            pedidoNumero: pedido.numero_pedido,
            pedidoId: pedido.id,
            parseResult,
          })
          onOrderCreated?.()
          // Auto-remove from queue after brief confirmation window
          setTimeout(() => removeFromQueue(nextWaiting.id), 1500)
        } else {
          // Needs manual review
          updateItem(nextWaiting.id, {
            status: "needs_review",
            parseResult,
          })
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error desconocido"
        updateItem(nextWaiting.id, { status: "error", error: msg })
      } finally {
        processingRef.current = false
      }
    }

    process()
  }, [queue, updateItem, onOrderCreated])

  const confirmOrder = useCallback(async (
    itemId: string,
    items: ParseResult["items"],
    clienteId: string
  ) => {
    const validItems = items.filter(i => i.matchedProduct)
    if (validItems.length === 0) throw new Error("No hay artículos válidos")

    const queueItem = queue.find(q => q.id === itemId)
    const pedido = await createPedido({
      cliente_id: clienteId,
      items: validItems.map(i => ({
        producto_id: i.matchedProduct!.id,
        cantidad: i.quantity,
        precio_unitario: i.matchedProduct!.precio_base || 0,
        descuento: 0,
      })),
      observaciones: "Importado vía IA",
      ...queueItem?.overrides,
    })

    updateItem(itemId, {
      status: "done",
      pedidoNumero: pedido.numero_pedido,
      pedidoId: pedido.id,
    })
    onOrderCreated?.()
    // Auto-remove from queue after brief confirmation window
    setTimeout(() => removeFromQueue(itemId), 1500)
    return pedido
  }, [updateItem, removeFromQueue, onOrderCreated])

  const retryItem = useCallback((id: string) => {
    updateItem(id, { status: "waiting", error: undefined, parseResult: undefined })
  }, [updateItem])

  const pendingCount = queue.filter(i => i.status === "waiting" || i.status === "processing").length
  const reviewCount = queue.filter(i => i.status === "needs_review").length

  return {
    queue,
    addToQueue,
    removeFromQueue,
    confirmOrder,
    retryItem,
    pendingCount,
    reviewCount,
  }
}
