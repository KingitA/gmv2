"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Trash2, Plus, Save, AlertCircle, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { CondicionesVentaDialog } from "./condiciones-venta-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCatalogoForCliente } from "@/lib/actions/catalogo"

interface EditarPedidoProps {
  pedido: any
  vendedorId: string
}

export function EditarPedido({ pedido, vendedorId }: EditarPedidoProps) {
  const router = useRouter()
  const [items, setItems] = useState(pedido.detalle || [])
  const [observaciones, setObservaciones] = useState(pedido.observaciones || "")
  const [condiciones, setCondiciones] = useState<any>({
    direccion_entrega: pedido.direccion_entrega || "",
    razon_social_factura: pedido.razon_social_factura || "",
    forma_facturacion: pedido.forma_facturacion || "factura",
  })
  const [catalogo, setCatalogo] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingCatalogo, setLoadingCatalogo] = useState(false)
  const [catalogoCargado, setCatalogoCargado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedArticulo, setSelectedArticulo] = useState("")

  const cargarCatalogo = async () => {
    if (catalogoCargado && catalogo.length > 0) return // Already loaded

    setLoadingCatalogo(true)
    try {
      console.log("[v0] Loading catalogo for cliente:", pedido.cliente_id, "forma:", condiciones.forma_facturacion)
      const result = await getCatalogoForCliente(pedido.cliente_id)

      if (!result.success) {
        throw new Error(result.error || "Error al cargar el catálogo")
      }

      console.log("[v0] Catalogo loaded:", result.data?.articulos?.length, "articulos")
      setCatalogo(result.data?.articulos || [])
      setCatalogoCargado(true)
    } catch (error) {
      console.error("[v0] Error cargando catálogo:", error)
      setError(error instanceof Error ? error.message : "Error al cargar el catálogo")
    } finally {
      setLoadingCatalogo(false)
    }
  }

  const calcularTotal = () => {
    return items.reduce((sum: number, item: any) => sum + (item.subtotal || 0), 0)
  }

  const actualizarCantidad = (index: number, cantidad: number) => {
    if (cantidad < 1) return
    const newItems = [...items]
    const item = newItems[index]
    item.cantidad = cantidad
    item.subtotal = cantidad * item.precio_unitario
    setItems(newItems)
  }

  const eliminarItem = (index: number) => {
    setItems(items.filter((_: any, i: number) => i !== index))
  }

  const agregarArticulo = (articuloId: string, esBulto: boolean) => {
    if (!articuloId) return

    const articulo = catalogo.find((a) => a.id === articuloId)
    if (!articulo) return

    const cantidadEnUnidades = esBulto ? articulo.unidades_por_bulto || 1 : 1
    const newItem = {
      articulo_id: articulo.id,
      cantidad: cantidadEnUnidades,
      precio_unitario: articulo.precio_final,
      subtotal: cantidadEnUnidades * articulo.precio_final,
      articulos: {
        sku: articulo.sku,
        nombre: articulo.descripcion,
      },
    }

    setItems([...items, newItem])
    setSelectedArticulo("")
  }

  const handleCondicionesChange = (nuevasCondiciones: any) => {
    const formaFacturacionCambio = nuevasCondiciones.forma_facturacion !== condiciones.forma_facturacion

    setCondiciones(nuevasCondiciones)

    if (formaFacturacionCambio) {
      if (catalogoCargado) {
        setError("La forma de facturación cambió. Los precios se están actualizando automáticamente.")
        setTimeout(() => actualizarPreciosItems(), 500)
      }
    }
  }

  const actualizarPreciosItems = async () => {
    try {
      console.log("[v0] Updating prices for", items.length, "items")
      const result = await getCatalogoForCliente(pedido.cliente_id)

      if (!result.success) {
        throw new Error(result.error || "Error al actualizar precios")
      }

      const nuevoCatalogo = result.data?.articulos || []
      console.log("[v0] New catalogo loaded:", nuevoCatalogo.length, "articulos")

      // Update prices for existing items
      const itemsActualizados = items.map((item: any) => {
        const articuloCatalogo = nuevoCatalogo.find((a: any) => a.id === item.articulo_id)
        if (articuloCatalogo) {
          const nuevoPrecio = articuloCatalogo.precio_final
          console.log(
            "[v0] Updating price for",
            item.articulos?.nombre,
            "from",
            item.precio_unitario,
            "to",
            nuevoPrecio,
          )
          return {
            ...item,
            precio_unitario: nuevoPrecio,
            subtotal: item.cantidad * nuevoPrecio,
          }
        }
        return item
      })

      setItems(itemsActualizados)
      setCatalogo(nuevoCatalogo)
      setCatalogoCargado(true)
      setError(null)
    } catch (error) {
      console.error("[v0] Error actualizando precios:", error)
      setError("Error al actualizar los precios. Por favor, verifica los artículos.")
    }
  }

  const handleGuardar = async () => {
    if (items.length === 0) {
      setError("El pedido debe tener al menos un artículo")
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log("[v0] Updating pedido:", pedido.id)
      const response = await fetch(`/api/pedidos/${pedido.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((item: any) => ({
            articulo_id: item.articulo_id,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
          })),
          observaciones,
          condiciones_temporales: condiciones,
        }),
      })

      if (response.ok) {
        alert("Pedido actualizado exitosamente")
        router.push("/vendedor/mis-ventas")
      } else {
        const error = await response.json()
        setError(error.error || "Error al actualizar el pedido")
      }
    } catch (error) {
      console.error("Error guardando pedido:", error)
      setError("Error de conexión al guardar el pedido")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Condiciones de Venta */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Condiciones de Venta</CardTitle>
            <CondicionesVentaDialog
              cliente={{
                id: pedido.cliente_id,
                nombre: pedido.cliente_nombre,
                direccion: condiciones.direccion_entrega,
                razon_social: condiciones.razon_social_factura,
                metodo_facturacion: condiciones.forma_facturacion,
              } as any}
              condicionesActuales={condiciones}
              onGuardar={handleCondicionesChange}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Dirección: </span>
            <span>{condiciones.direccion_entrega || "No especificada"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Razón Social: </span>
            <span>{condiciones.razon_social_factura || "No especificada"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Forma Facturación: </span>
            <span>
              {condiciones.forma_facturacion === "factura"
                ? "Factura A/B"
                : condiciones.forma_facturacion === "final"
                  ? "Factura C / Consumidor Final"
                  : "Solo Remito"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Agregar Artículos */}
      <Card>
        <CardHeader>
          <CardTitle>Agregar Artículo</CardTitle>
        </CardHeader>
        <CardContent>
          {!catalogoCargado ? (
            <Button onClick={cargarCatalogo} disabled={loadingCatalogo} className="w-full">
              {loadingCatalogo ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando catálogo...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Cargar Catálogo de Productos
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Por Unidades</Label>
                <div className="flex gap-2">
                  <Select value={selectedArticulo} onValueChange={setSelectedArticulo}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Seleccionar artículo" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogo.map((art) => (
                        <SelectItem key={art.id} value={art.id}>
                          {art.descripcion} - ${art.precio_final.toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={() => agregarArticulo(selectedArticulo, false)} disabled={!selectedArticulo}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Por Bultos</Label>
                <div className="flex gap-2">
                  <Select
                    value={selectedArticulo}
                    onValueChange={(value) => {
                      setSelectedArticulo(value)
                      agregarArticulo(value, true)
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Seleccionar artículo" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogo
                        .filter((art) => art.unidades_por_bulto > 1)
                        .map((art) => (
                          <SelectItem key={art.id} value={art.id}>
                            {art.descripcion} - Bulto x{art.unidades_por_bulto} ($
                            {(art.precio_final * art.unidades_por_bulto).toFixed(2)})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista de Artículos */}
      <Card>
        <CardHeader>
          <CardTitle>Artículos del Pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No hay artículos en el pedido. Agrega artículos arriba.
            </p>
          ) : (
            items.map((item: any, index: number) => (
              <div key={index} className="flex gap-2 p-3 rounded-lg border">
                <div className="flex-1">
                  <p className="font-medium text-sm">{item.articulos?.nombre || "Sin nombre"}</p>
                  <p className="text-xs text-muted-foreground">SKU: {item.articulos?.sku || "N/A"}</p>
                  <p className="text-xs text-muted-foreground">
                    ${item.precio_unitario?.toFixed(2)} x {item.cantidad} un.
                  </p>
                  <p className="text-sm font-bold mt-1">${item.subtotal?.toFixed(2)}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="1"
                      value={item.cantidad}
                      onChange={(e) => actualizarCantidad(index, Number.parseInt(e.target.value) || 1)}
                      className="w-20 h-8"
                    />
                    <span className="text-xs">un.</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => eliminarItem(index)} className="h-8">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <Separator />

          <div className="flex justify-between text-lg font-bold">
            <span>Total:</span>
            <span>${calcularTotal().toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Observaciones */}
      <Card>
        <CardHeader>
          <CardTitle>Observaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Notas adicionales..."
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Botones */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.back()} className="flex-1" disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={handleGuardar} disabled={loading || items.length === 0} className="flex-1">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Guardar Cambios
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
