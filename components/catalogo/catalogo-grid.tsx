"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Search, ShoppingCart, Package } from "lucide-react"
import type { PrecioArticulo } from "@/lib/api/erp-client"
import { useRouter } from "next/navigation"
import { createPedido } from "@/lib/actions/catalogo"

interface CatalogoGridProps {
  articulos: PrecioArticulo[]
  clienteId: string
  isVendedor?: boolean
  vendedorId?: string
}

interface CartItem extends PrecioArticulo {
  cantidad: number
}

export function CatalogoGrid({ articulos, clienteId, isVendedor = false, vendedorId }: CatalogoGridProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState("")
  const [cart, setCart] = useState<CartItem[]>([])
  const [isCreatingOrder, setIsCreatingOrder] = useState(false)

  const filteredArticulos = articulos.filter((articulo) => {
    const searchLower = searchTerm.toLowerCase()
    return (
      articulo.descripcion?.toLowerCase().includes(searchLower) ||
      articulo.sku?.toLowerCase().includes(searchLower) ||
      articulo.categoria?.toLowerCase().includes(searchLower)
    )
  })

  const addToCart = (articulo: PrecioArticulo) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.articulo_id === articulo.articulo_id)
      if (existing) {
        return prev.map((item) =>
          item.articulo_id === articulo.articulo_id ? { ...item, cantidad: item.cantidad + 1 } : item,
        )
      }
      return [...prev, { ...articulo, cantidad: 1 }]
    })
  }

  const updateQuantity = (articuloId: string, cantidad: number) => {
    if (cantidad <= 0) {
      setCart((prev) => prev.filter((item) => item.articulo_id !== articuloId))
    } else {
      setCart((prev) => prev.map((item) => (item.articulo_id === articuloId ? { ...item, cantidad } : item)))
    }
  }

  const totalCart = cart.reduce((sum, item) => sum + item.precio_final * item.cantidad, 0)

  const handleCreateOrder = async () => {
    if (cart.length === 0) return

    setIsCreatingOrder(true)
    try {
      const result = await createPedido({
        cliente_id: clienteId,
        vendedor_id: vendedorId,
        items: cart.map((item) => ({
          articulo_id: item.articulo_id,
          cantidad: item.cantidad,
        })),
      })

      if (result.success && result.data) {
        alert(`Pedido creado exitosamente! Número: ${result.data.numero_pedido}`)
        setCart([])
        router.refresh()
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error) {
      alert("Error al crear el pedido")
    } finally {
      setIsCreatingOrder(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Buscar productos por nombre, SKU o categoría..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Cart Summary */}
      {cart.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                <h3 className="font-semibold">Carrito ({cart.length} productos)</h3>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">${totalCart.toFixed(2)}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {cart.map((item) => (
                <div key={item.articulo_id} className="flex items-center justify-between text-sm">
                  <span className="flex-1 truncate">{item.descripcion}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateQuantity(item.articulo_id, item.cantidad - 1)}
                    >
                      -
                    </Button>
                    <span className="w-8 text-center">{item.cantidad}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateQuantity(item.articulo_id, item.cantidad + 1)}
                    >
                      +
                    </Button>
                    <span className="w-24 text-right font-medium">
                      ${(item.precio_final * item.cantidad).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" size="lg" onClick={handleCreateOrder} disabled={isCreatingOrder}>
              {isCreatingOrder ? "Creando Pedido..." : "Crear Pedido"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Products Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredArticulos.map((articulo) => (
          <Card key={articulo.articulo_id} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight line-clamp-2">{articulo.descripcion}</h3>
                  {articulo.descuento_aplicado > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      -{articulo.descuento_aplicado}%
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">SKU: {articulo.sku}</p>
                {articulo.categoria && (
                  <Badge variant="outline" className="text-xs">
                    {articulo.categoria}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-2 pb-3">
              <div className="space-y-1">
                {articulo.descuento_aplicado > 0 && (
                  <p className="text-sm text-muted-foreground line-through">${articulo.precio_base.toFixed(2)}</p>
                )}
                <p className="text-2xl font-bold text-primary">${articulo.precio_final.toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>Stock: {articulo.stock_disponible}</span>
              </div>
            </CardContent>
            <CardFooter className="pt-0">
              <Button className="w-full" onClick={() => addToCart(articulo)} disabled={articulo.stock_disponible <= 0}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                Agregar al Carrito
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {filteredArticulos.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No se encontraron productos que coincidan con la búsqueda</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
