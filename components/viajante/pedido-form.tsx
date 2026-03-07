"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { Cliente } from "@/lib/types/database"
import { searchProductos, checkStockDisponible } from "@/lib/actions/productos"
import { createPedido } from "@/lib/actions/pedidos"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Search, Plus, Trash2, Package, ShoppingCart } from "lucide-react"

interface ProductoSearchResult {
  id: string
  nombre: string
  sku: string
  precio_base: number
  stock_actual: number
  stock_reservado: number
  unidades_por_bulto: number
  proveedores: {
    nombre: string
  }
}

interface PedidoItem {
  producto_id: string
  producto_nombre: string
  producto_sku: string
  cantidad: number
  precio_unitario: number
  descuento: number
  subtotal: number
}

export function PedidoForm({
  clientes,
  clienteIdInicial,
}: {
  clientes: Cliente[]
  clienteIdInicial?: string
}) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clienteId, setClienteId] = useState(clienteIdInicial || "")
  const [observaciones, setObservaciones] = useState("")
  const [items, setItems] = useState<PedidoItem[]>([])

  // Product search
  const [searchTerm, setSearchTerm] = useState("")
  const [searchResults, setSearchResults] = useState<ProductoSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const handleSearch = async () => {
    if (searchTerm.length < 2) return

    setIsSearching(true)
    try {
      const results = await searchProductos(searchTerm)
      setSearchResults(results as ProductoSearchResult[])
    } catch (err) {
      console.error("Error searching:", err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleAddProduct = async (producto: ProductoSearchResult) => {
    // Check if product already in cart
    if (items.find((item) => item.producto_id === producto.id)) {
      setError("Este producto ya está en el pedido")
      return
    }

    // Get client discount
    const cliente = clientes.find((c) => c.id === clienteId)
    const descuento = cliente?.descuento_especial || 0

    const newItem: PedidoItem = {
      producto_id: producto.id,
      producto_nombre: producto.nombre,
      producto_sku: producto.sku,
      cantidad: 1,
      precio_unitario: producto.precio_base,
      descuento,
      subtotal: producto.precio_base * (1 - descuento / 100),
    }

    setItems([...items, newItem])
    setSearchResults([])
    setSearchTerm("")
    setError(null)
  }

  const handleUpdateItem = (index: number, field: keyof PedidoItem, value: number) => {
    const newItems = [...items]
    newItems[index] = {
      ...newItems[index],
      [field]: value,
    }

    // Recalculate subtotal
    newItems[index].subtotal =
      newItems[index].cantidad * newItems[index].precio_unitario * (1 - newItems[index].descuento / 100)

    setItems(newItems)
  }

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const calculateTotal = () => {
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
    const cliente = clientes.find((c) => c.id === clienteId)

    const iva = cliente?.condicion_iva === "responsable_inscripto" ? 0 : subtotal * 0.21
    const percepciones = cliente?.aplica_percepciones ? subtotal * 0.03 : 0

    return {
      subtotal,
      iva,
      percepciones,
      total: subtotal + iva + percepciones,
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    if (!clienteId) {
      setError("Debe seleccionar un cliente")
      setIsSubmitting(false)
      return
    }

    if (items.length === 0) {
      setError("Debe agregar al menos un producto")
      setIsSubmitting(false)
      return
    }

    try {
      // Check stock for all items
      for (const item of items) {
        const stockCheck = await checkStockDisponible(item.producto_id, item.cantidad)
        if (!stockCheck.disponible) {
          throw new Error(`Stock insuficiente para ${item.producto_nombre}. Disponible: ${stockCheck.stockDisponible}`)
        }
      }

      const cliente = clientes.find((c) => c.id === clienteId)

      const pedido = await createPedido({
        cliente_id: clienteId,
        items: items.map((item) => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          descuento: item.descuento,
        })),
        observaciones,
        zona_entrega: cliente?.zona || undefined,
      })

      router.push(`/crm/viajante/pedidos/${pedido.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear el pedido")
      setIsSubmitting(false)
    }
  }

  const totales = calculateTotal()

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Client Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="cliente">
              Seleccionar Cliente <span className="text-destructive">*</span>
            </Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger id="cliente">
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {clientes.map((cliente) => (
                  <SelectItem key={cliente.id} value={cliente.id}>
                    {cliente.razon_social} - {cliente.zona}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Product Search */}
      <Card>
        <CardHeader>
          <CardTitle>Agregar Productos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por nombre, SKU o EAN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSearch())}
                className="pl-10"
              />
            </div>
            <Button type="button" onClick={handleSearch} disabled={isSearching}>
              {isSearching ? <Spinner className="h-4 w-4" /> : "Buscar"}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-2">
              {searchResults.map((producto) => {
                const stockDisponible = producto.stock_actual - producto.stock_reservado
                return (
                  <div
                    key={producto.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{producto.nombre}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>SKU: {producto.sku}</span>
                        <span>•</span>
                        <span>{producto.proveedores?.nombre || "Sin Proveedor"}</span>
                        <span>•</span>
                        <Badge variant={stockDisponible > 0 ? "secondary" : "destructive"}>
                          Stock: {stockDisponible}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-lg font-bold">${producto.precio_base.toFixed(2)}</p>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAddProduct(producto)}
                        disabled={stockDisponible <= 0}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Items */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Productos en el Pedido ({items.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="font-medium">{item.producto_nombre}</p>
                    <p className="text-sm text-muted-foreground">SKU: {item.producto_sku}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveItem(index)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      min="1"
                      value={item.cantidad}
                      onChange={(e) => handleUpdateItem(index, "cantidad", Number.parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Precio Unit.</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.precio_unitario}
                      onChange={(e) =>
                        handleUpdateItem(index, "precio_unitario", Number.parseFloat(e.target.value) || 0)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Descuento %</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={item.descuento}
                      onChange={(e) => handleUpdateItem(index, "descuento", Number.parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Subtotal</Label>
                    <div className="flex h-10 items-center rounded-md border border-border bg-muted px-3 text-sm font-bold">
                      ${item.subtotal.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Totals */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resumen del Pedido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-medium">${totales.subtotal.toFixed(2)}</span>
            </div>
            {totales.iva > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">IVA (21%):</span>
                <span className="font-medium">${totales.iva.toFixed(2)}</span>
              </div>
            )}
            {totales.percepciones > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Percepciones (3%):</span>
                <span className="font-medium">${totales.percepciones.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
              <span>Total:</span>
              <span className="text-primary">${totales.total.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Observations */}
      <Card>
        <CardHeader>
          <CardTitle>Observaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Notas adicionales sobre el pedido..."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting || items.length === 0} className="flex-1">
          {isSubmitting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Creando Pedido...
            </>
          ) : (
            <>
              <Package className="mr-2 h-4 w-4" />
              Crear Pedido
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
          className="flex-1"
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
