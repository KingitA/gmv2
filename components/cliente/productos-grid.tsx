"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ShoppingCart, Search, Package } from "lucide-react"
import { useRouter } from "next/navigation"

type Producto = {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  precio_base: number
  stock_disponible: number
  stock_reservado: number
  unidad_medida: string
  activo: boolean
}

type Cliente = {
  id: string
  descuento_general: number | null
  condicion_iva: string
}

export function ProductosGrid({ productos, cliente }: { productos: Producto[]; cliente: Cliente }) {
  const [searchTerm, setSearchTerm] = useState("")
  const [cart, setCart] = useState<Map<string, number>>(new Map())
  const router = useRouter()

  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem("cart")
    if (savedCart) {
      try {
        const cartData = JSON.parse(savedCart)
        const cartMap = new Map<string, number>(
          cartData.map((item: { productoId: string; cantidad: number }) => [item.productoId, item.cantidad] as [string, number]),
        )
        setCart(cartMap)
      } catch (error) {
        console.error("Error loading cart:", error)
      }
    }
  }, [])

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    const cartArray = Array.from(cart.entries()).map(([productoId, cantidad]) => ({
      productoId,
      cantidad,
    }))
    localStorage.setItem("cart", JSON.stringify(cartArray))
  }, [cart])

  const filteredProductos = productos.filter(
    (p) =>
      p.activo &&
      (p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.codigo.toLowerCase().includes(searchTerm.toLowerCase())),
  )

  const addToCart = (productoId: string) => {
    const newCart = new Map(cart)
    const currentQty = newCart.get(productoId) || 0
    newCart.set(productoId, currentQty + 1)
    setCart(newCart)
  }

  const calculatePrice = (precioBase: number) => {
    let precio = precioBase
    if (cliente.descuento_general) {
      precio = precio * (1 - cliente.descuento_general / 100)
    }
    return precio
  }

  const stockDisponible = (producto: Producto) => {
    return producto.stock_disponible - producto.stock_reservado
  }

  const totalItemsInCart = Array.from(cart.values()).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar productos por nombre o código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {totalItemsInCart > 0 && (
        <Card className="border-primary bg-primary/5">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <span className="font-medium">{totalItemsInCart} productos en el carrito</span>
            </div>
            <Button onClick={() => router.push("/cliente/carrito")}>Ver Carrito</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredProductos.map((producto) => {
          const precio = calculatePrice(producto.precio_base)
          const stock = stockDisponible(producto)
          const enCarrito = cart.get(producto.id) || 0

          return (
            <Card key={producto.id} className="flex flex-col">
              <CardHeader>
                <div className="mb-2 flex items-start justify-between">
                  <Badge variant="secondary">{producto.codigo}</Badge>
                  {stock > 0 ? (
                    <Badge variant="outline" className="bg-green-50 text-green-700">
                      Stock: {stock}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Sin Stock</Badge>
                  )}
                </div>
                <CardTitle className="line-clamp-2 text-lg">{producto.nombre}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                {producto.descripcion && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{producto.descripcion}</p>
                )}
                <div className="mt-4">
                  <p className="text-2xl font-bold text-primary">${precio.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">por {producto.unidad_medida}</p>
                  {cliente.descuento_general && (
                    <p className="text-xs text-green-600">Descuento {cliente.descuento_general}% aplicado</p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-2">
                {enCarrito > 0 && (
                  <div className="w-full rounded-md bg-primary/10 p-2 text-center text-sm font-medium text-primary">
                    {enCarrito} en el carrito
                  </div>
                )}
                <Button className="w-full" onClick={() => addToCart(producto.id)} disabled={stock === 0}>
                  {stock > 0 ? (
                    <>
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Agregar al Carrito
                    </>
                  ) : (
                    <>
                      <Package className="mr-2 h-4 w-4" />
                      Sin Stock
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {filteredProductos.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium text-muted-foreground">No se encontraron productos</p>
            <p className="text-sm text-muted-foreground">Intenta con otros términos de búsqueda</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
