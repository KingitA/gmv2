"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Trash2, Plus, Minus, ShoppingCart, Package, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { getProductoById, checkStockDisponible } from "@/lib/actions/productos"
import { createPedidoCliente } from "@/lib/actions/cliente"
import { useToast } from "@/hooks/use-toast"

type CartItem = {
  productoId: string
  cantidad: number
}

type ProductoDetalle = {
  id: string
  sku: string
  nombre: string
  descripcion: string | null
  precio_base: number
  stock_actual: number
  stock_reservado: number
  unidad_medida: string
}

type Cliente = {
  id: string
  descuento_general: number | null
  condicion_iva: string
  zona: string
}

export function CarritoContent({ cliente }: { cliente: Cliente }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [productos, setProductos] = useState<Map<string, ProductoDetalle>>(new Map())
  const [observaciones, setObservaciones] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  // Load cart from localStorage
  useEffect(() => {
    const savedCart = localStorage.getItem("cart")
    if (savedCart) {
      const cartData: CartItem[] = JSON.parse(savedCart)
      setCart(cartData)

      // Load product details
      Promise.all(
        cartData.map(async (item) => {
          const producto = await getProductoById(item.productoId)
          return [item.productoId, producto] as const
        }),
      ).then((results) => {
        const productosMap = new Map(results)
        setProductos(productosMap)
        setLoading(false)
      })
    } else {
      setLoading(false)
    }
  }, [])

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    if (!loading) {
      localStorage.setItem("cart", JSON.stringify(cart))
    }
  }, [cart, loading])

  const updateQuantity = (productoId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(productoId)
      return
    }

    const producto = productos.get(productoId)
    if (!producto) return

    const stockDisponible = producto.stock_actual - producto.stock_reservado
    if (newQuantity > stockDisponible) {
      toast({
        title: "Stock insuficiente",
        description: `Solo hay ${stockDisponible} unidades disponibles`,
        variant: "destructive",
      })
      return
    }

    setCart((prev) => prev.map((item) => (item.productoId === productoId ? { ...item, cantidad: newQuantity } : item)))
  }

  const removeItem = (productoId: string) => {
    setCart((prev) => prev.filter((item) => item.productoId !== productoId))
  }

  const calculatePrice = (precioBase: number) => {
    let precio = precioBase
    if (cliente.descuento_general) {
      precio = precio * (1 - cliente.descuento_general / 100)
    }
    return precio
  }

  const calculateSubtotal = () => {
    return cart.reduce((total, item) => {
      const producto = productos.get(item.productoId)
      if (!producto) return total
      const precio = calculatePrice(producto.precio_base)
      return total + precio * item.cantidad
    }, 0)
  }

  const calculateIVA = (subtotal: number) => {
    return cliente.condicion_iva === "responsable_inscripto" ? 0 : subtotal * 0.21
  }

  const calculateTotal = () => {
    const subtotal = calculateSubtotal()
    const iva = calculateIVA(subtotal)
    return subtotal + iva
  }

  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast({
        title: "Carrito vacío",
        description: "Agrega productos antes de realizar el pedido",
        variant: "destructive",
      })
      return
    }

    setSubmitting(true)

    try {
      // Verify stock for all items
      for (const item of cart) {
        const stockCheck = await checkStockDisponible(item.productoId, item.cantidad)
        if (!stockCheck.disponible) {
          const producto = productos.get(item.productoId)
          toast({
            title: "Stock insuficiente",
            description: `${producto?.nombre}: solo hay ${stockCheck.stockDisponible} unidades disponibles`,
            variant: "destructive",
          })
          setSubmitting(false)
          return
        }
      }

      // Create order
      const items = cart.map((item) => {
        const producto = productos.get(item.productoId)!
        const precio = calculatePrice(producto.precio_base)
        return {
          producto_id: item.productoId,
          cantidad: item.cantidad,
          precio_unitario: precio,
          descuento: cliente.descuento_general || 0,
        }
      })

      await createPedidoCliente({
        cliente_id: cliente.id,
        items,
        observaciones: observaciones || undefined,
        zona_entrega: cliente.zona,
      })

      // Clear cart
      setCart([])
      localStorage.removeItem("cart")

      toast({
        title: "Pedido creado",
        description: "Tu pedido ha sido enviado exitosamente",
      })

      router.push("/cliente/pedidos")
    } catch (error) {
      console.error("Error creating order:", error)
      toast({
        title: "Error",
        description: "No se pudo crear el pedido. Intenta nuevamente.",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Package className="mx-auto mb-4 h-12 w-12 animate-pulse text-muted-foreground" />
          <p className="text-muted-foreground">Cargando carrito...</p>
        </div>
      </div>
    )
  }

  if (cart.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <ShoppingCart className="mb-4 h-16 w-16 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">Tu carrito está vacío</h2>
          <p className="mb-6 text-muted-foreground">Agrega productos para comenzar tu pedido</p>
          <Button onClick={() => router.push("/cliente/productos")}>Explorar Productos</Button>
        </CardContent>
      </Card>
    )
  }

  const subtotal = calculateSubtotal()
  const iva = calculateIVA(subtotal)
  const total = calculateTotal()

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Productos en el Carrito ({cart.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cart.map((item) => {
              const producto = productos.get(item.productoId)
              if (!producto) return null

              const precio = calculatePrice(producto.precio_base)
              const stockDisponible = producto.stock_actual - producto.stock_reservado
              const itemTotal = precio * item.cantidad

              return (
                <div key={item.productoId} className="flex gap-4 border-b pb-4 last:border-0">
                  <div className="flex-1">
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">{producto.nombre}</h3>
                        <p className="text-sm text-muted-foreground">SKU: {producto.sku}</p>
                      </div>
                      <Badge variant={stockDisponible > 10 ? "outline" : "secondary"}>Stock: {stockDisponible}</Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 bg-transparent"
                          onClick={() => updateQuantity(item.productoId, item.cantidad - 1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          type="number"
                          value={item.cantidad}
                          onChange={(e) => updateQuantity(item.productoId, Number.parseInt(e.target.value) || 0)}
                          className="w-20 text-center"
                          min="1"
                          max={stockDisponible}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 bg-transparent"
                          onClick={() => updateQuantity(item.productoId, item.cantidad + 1)}
                          disabled={item.cantidad >= stockDisponible}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <span className="ml-2 text-sm text-muted-foreground">x ${precio.toFixed(2)}</span>
                      </div>

                      <div className="flex items-center gap-4">
                        <p className="text-lg font-bold">${itemTotal.toFixed(2)}</p>
                        <Button variant="ghost" size="icon" onClick={() => removeItem(item.productoId)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {item.cantidad > stockDisponible && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        Stock insuficiente. Máximo: {stockDisponible}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Observaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Agrega cualquier observación sobre tu pedido..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={4}
            />
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="sticky top-4">
          <CardHeader>
            <CardTitle>Resumen del Pedido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">${subtotal.toFixed(2)}</span>
              </div>

              {cliente.descuento_general && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Descuento ({cliente.descuento_general}%)</span>
                  <span>Aplicado</span>
                </div>
              )}

              {iva > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IVA (21%)</span>
                  <span className="font-medium">${iva.toFixed(2)}</span>
                </div>
              )}

              <div className="border-t pt-2">
                <div className="flex justify-between">
                  <span className="text-lg font-bold">Total</span>
                  <span className="text-lg font-bold text-primary">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">Información de Entrega</p>
              <p className="text-muted-foreground">Zona: {cliente.zona}</p>
              <p className="text-muted-foreground">
                Condición: {cliente.condicion_iva === "responsable_inscripto" ? "Resp. Inscripto" : "Consumidor Final"}
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" size="lg" onClick={handleCheckout} disabled={submitting}>
              {submitting ? "Procesando..." : "Confirmar Pedido"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
