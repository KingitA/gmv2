"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, ShoppingCart, AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CatalogoProductos } from "@/components/vendedor/catalogo-productos"
import { CarritoPedido } from "@/components/vendedor/carrito-pedido"
import { CondicionesVentaDialog } from "@/components/vendedor/condiciones-venta-dialog"
import { getCatalogoForCliente } from "@/lib/actions/catalogo"
import type { PrecioArticulo } from "@/lib/api/erp-client"
import type { Cliente } from "@/lib/types/database"

interface PedidoBuilderProps {
  cliente: Cliente
  vendedorId: string
  pedidoExistente?: any // Add optional existing pedido to pre-load cart
}

interface CarritoItem {
  articulo: PrecioArticulo
  cantidad: number
  es_bulto: boolean
}

export function PedidoBuilder({ cliente, vendedorId, pedidoExistente }: PedidoBuilderProps) {
  const [catalogo, setCatalogo] = useState<PrecioArticulo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [carrito, setCarrito] = useState<CarritoItem[]>([])
  const [condicionesTemporales, setCondicionesTemporales] = useState<any>(null)

  useEffect(() => {
    if (pedidoExistente) {
      console.log("[v0] Pre-loading cart with existing pedido items:", pedidoExistente.detalle?.length)

      // Set condiciones from existing pedido
      setCondicionesTemporales({
        direccion_entrega: pedidoExistente.direccion_entrega || "",
        razon_social_factura: pedidoExistente.razon_social_factura || cliente.razon_social,
        forma_facturacion: pedidoExistente.forma_facturacion || cliente.metodo_facturacion,
      })

      // Load detalle into cart (once catalogo is loaded, we'll match items)
    }
  }, [pedidoExistente])

  useEffect(() => {
    loadCatalogo()
  }, [cliente.id])

  useEffect(() => {
    if (pedidoExistente && catalogo.length > 0 && carrito.length === 0) {
      console.log("[v0] Matching pedido items with catalogo")
      const itemsPreCargados: CarritoItem[] =
        pedidoExistente.detalle
          ?.map((item: any) => {
            // Find matching articulo in catalogo
            const articulo = catalogo.find((a) => a.id === item.articulo_id)

            if (articulo) {
              return {
                articulo: articulo,
                cantidad: item.cantidad,
                es_bulto: false, // Will be recalculated based on cantidad
              }
            }

            // If not in catalogo, create mock articulo from pedido data
            return {
              articulo: {
                id: item.articulo_id,
                sku: item.articulos?.sku || "N/A",
                descripcion: item.articulos?.nombre || "Artículo",
                precio_final: item.precio_unitario,
                unidades_por_bulto: item.articulos?.unidades_por_bulto || 1,
              } as PrecioArticulo,
              cantidad: item.cantidad,
              es_bulto: false,
            }
          })
          .filter(Boolean) || []

      console.log("[v0] Pre-loaded", itemsPreCargados.length, "items into cart")
      setCarrito(itemsPreCargados)
    }
  }, [catalogo, pedidoExistente])

  const loadCatalogo = async () => {
    setLoading(true)
    setError(null)
    try {
      console.log("[v0] Loading catalogo for cliente:", cliente.id)
      const result = await getCatalogoForCliente(cliente.id)

      if (!result.success) {
        throw new Error(result.error || "Error al cargar el catálogo")
      }

      console.log("[v0] Catalogo loaded successfully:", result.data)
      setCatalogo(result.data?.articulos || [])
    } catch (error) {
      console.error("[v0] Error loading catalogo:", error)
      setError(error instanceof Error ? error.message : "Error al cargar el catálogo")
    } finally {
      setLoading(false)
    }
  }

  const agregarAlCarrito = (articulo: PrecioArticulo, cantidad: number, es_bulto: boolean) => {
    setCarrito((prev) => {
      const existing = prev.find((item) => item.articulo.id === articulo.id)
      if (existing) {
        return prev.map((item) =>
          item.articulo.id === articulo.id ? { ...item, cantidad: item.cantidad + cantidad, es_bulto } : item,
        )
      }
      return [...prev, { articulo, cantidad, es_bulto }]
    })
  }

  const actualizarCantidad = (articuloId: string, cantidad: number) => {
    if (cantidad <= 0) {
      setCarrito((prev) => prev.filter((item) => item.articulo.id !== articuloId))
    } else {
      setCarrito((prev) => prev.map((item) => (item.articulo.id === articuloId ? { ...item, cantidad } : item)))
    }
  }

  const eliminarDelCarrito = (articuloId: string) => {
    setCarrito((prev) => prev.filter((item) => item.articulo.id !== articuloId))
  }

  const calcularTotal = () => {
    return carrito.reduce((total, item) => {
      const cantidadFinal = item.es_bulto ? item.cantidad * (item.articulo.unidades_por_bulto || 1) : item.cantidad
      return total + item.articulo.precio_final * cantidadFinal
    }, 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <div className="font-semibold">Error al cargar el catálogo</div>
            <div className="text-sm">{error}</div>
            {error.includes("endpoint") && (
              <div className="text-sm mt-2 p-2 bg-muted rounded">
                <strong>Solución:</strong> El endpoint <code className="text-xs">/api/precios/catalogo</code> debe estar
                implementado en el ERP y devolver JSON con la estructura correcta.
              </div>
            )}
            <button
              onClick={loadCatalogo}
              className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Reintentar
            </button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6 p-4 md:p-6">
      {/* Catálogo */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Catálogo de Productos</CardTitle>
            <CondicionesVentaDialog
              cliente={cliente}
              condicionesActuales={condicionesTemporales}
              onGuardar={setCondicionesTemporales}
            />
          </CardHeader>
          <CardContent>
            <CatalogoProductos productos={catalogo} onAgregarAlCarrito={agregarAlCarrito} />
          </CardContent>
        </Card>
      </div>

      {/* Carrito */}
      <div className="lg:col-span-1">
        <div className="sticky top-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Carrito ({carrito.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CarritoPedido
                items={carrito}
                total={calcularTotal()}
                clienteId={cliente.id}
                vendedorId={vendedorId}
                condicionesTemporales={condicionesTemporales}
                onActualizarCantidad={actualizarCantidad}
                onEliminar={eliminarDelCarrito}
                pedidoId={pedidoExistente?.id}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
