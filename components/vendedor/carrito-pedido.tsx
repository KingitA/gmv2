"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Trash2, Loader2, CheckCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import type { PrecioArticulo } from "@/lib/api/erp-client"

interface CarritoItem {
  articulo: PrecioArticulo
  cantidad: number
  es_bulto: boolean
}

interface CarritoPedidoProps {
  items: CarritoItem[]
  total: number
  clienteId: string
  vendedorId: string
  condicionesTemporales: any
  onActualizarCantidad: (articuloId: string, cantidad: number) => void
  onEliminar: (articuloId: string) => void
  pedidoId?: string // Add optional pedidoId for editing mode
}

export function CarritoPedido({
  items,
  total,
  clienteId,
  vendedorId,
  condicionesTemporales,
  onActualizarCantidad,
  onEliminar,
  pedidoId, // Receive pedidoId to detect edit mode
}: CarritoPedidoProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [observaciones, setObservaciones] = useState("")

  const handleConfirmarPedido = async () => {
    if (items.length === 0) {
      alert("El carrito está vacío")
      return
    }

    setLoading(true)
    try {
      const method = pedidoId ? "PUT" : "POST"
      const url = pedidoId ? `/api/pedidos/${pedidoId}` : "/api/pedidos"

      console.log(`[v0] ${method} pedido to:`, url)

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          vendedor_id: vendedorId,
          items: items.map((item) => {
            // Convert bultos to units here
            const cantidadEnUnidades = item.es_bulto
              ? item.cantidad * (item.articulo.unidades_por_bulto || 1)
              : item.cantidad

            return {
              articulo_id: item.articulo.articulo_id,
              cantidad: cantidadEnUnidades, // Always send in units
              precio_unitario: item.articulo.precio_final,
            }
          }),
          observaciones,
          condiciones_temporales: condicionesTemporales,
        }),
      })

      console.log("[v0] Pedido response status:", response.status)

      if (response.ok) {
        const data = await response.json()
        console.log("[v0] Pedido processed successfully:", data)
        alert(
          pedidoId ? "Pedido actualizado exitosamente!" : `Pedido #${data.pedido.numero_pedido} creado exitosamente!`,
        )
        router.push("/vendedor")
      } else {
        const error = await response.json()
        console.error("[v0] Error response:", error)
        alert(`Error: ${error.error || "No se pudo procesar el pedido"}`)
      }
    } catch (error) {
      console.error("[v0] Error processing pedido:", error)
      alert("Error al procesar el pedido")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">El carrito está vacío</p>
      ) : (
        <>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {items.map((item) => {
              const cantidadFinal = item.es_bulto
                ? item.cantidad * (item.articulo.unidades_por_bulto || 1)
                : item.cantidad
              const subtotal = item.articulo.precio_final * cantidadFinal

              return (
                <div key={item.articulo.id} className="flex gap-2 p-3 rounded-lg border">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{item.articulo.descripcion}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.cantidad} {item.es_bulto ? "bulto(s)" : "unidad(es)"}
                      {item.es_bulto && ` (${cantidadFinal} un.)`}
                    </p>
                    <p className="text-sm font-bold mt-1">
                      ${subtotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Input
                      type="number"
                      min="1"
                      value={item.cantidad}
                      onChange={(e) => onActualizarCantidad(item.articulo.articulo_id, Number.parseInt(e.target.value) || 1)}
                      className="w-16 h-8 text-sm"
                    />
                    <Button variant="ghost" size="sm" onClick={() => onEliminar(item.articulo.articulo_id)} className="h-8">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex justify-between text-lg font-bold">
              <span>Total:</span>
              <span>${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              placeholder="Notas adicionales para el pedido..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={3}
            />
          </div>

          <Button className="w-full" size="lg" onClick={handleConfirmarPedido} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {pedidoId ? "Guardando Cambios..." : "Creando Pedido..."}
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                {pedidoId ? "Guardar Cambios" : "Confirmar Pedido"}
              </>
            )}
          </Button>
        </>
      )}
    </div>
  )
}
