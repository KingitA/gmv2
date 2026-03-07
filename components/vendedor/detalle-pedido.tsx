"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Package, User, FileText, AlertCircle } from "lucide-react"

interface DetallePedidoProps {
  pedidoId: string
  vendedorId: string
}

export function DetallePedido({ pedidoId, vendedorId }: DetallePedidoProps) {
  const [pedido, setPedido] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cargarPedido()
  }, [pedidoId, vendedorId])

  const cargarPedido = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/pedidos/vendedor/${vendedorId}`)

      if (!response.ok) {
        setError("Error al cargar los pedidos del vendedor")
        return
      }

      const pedidos = await response.json()

      const pedidoEncontrado = pedidos.find((p: any) => p.id === pedidoId)

      if (!pedidoEncontrado) {
        setError("Pedido no encontrado en la lista de pedidos del vendedor")
        return
      }

      console.log("[v0] Pedido encontrado:", pedidoEncontrado)
      setPedido(pedidoEncontrado)
    } catch (error) {
      console.error("Error cargando pedido:", error)
      setError("Error de conexión al cargar el pedido")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Cargando detalle del pedido...</div>
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error al cargar el pedido</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!pedido) {
    return <div className="text-center py-8 text-destructive">Pedido no encontrado</div>
  }

  const puedeEditar = pedido.estado === "pendiente"

  const getEstadoBadge = (estado: string) => {
    const variants: Record<string, any> = {
      pendiente: { variant: "secondary", label: "Pendiente" },
      confirmado: { variant: "default", label: "Confirmado" },
      en_preparacion: { variant: "default", label: "En Preparación" },
      enviado: { variant: "default", label: "Enviado" },
      entregado: { variant: "default", label: "Entregado" },
      cancelado: { variant: "destructive", label: "Cancelado" },
    }

    const config = variants[estado] || { variant: "secondary", label: estado }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Pedido #{pedido.numero}</CardTitle>
              <CardDescription>
                {format(new Date(pedido.fecha), "dd 'de' MMMM 'de' yyyy", { locale: es })}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {getEstadoBadge(pedido.estado)}
              {puedeEditar && (
                <a href={`/vendedor/mis-ventas/pedido/${pedidoId}/editar`}>
                  <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                    Editar
                  </Badge>
                </a>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Información del Cliente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Información del Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <p className="text-sm text-muted-foreground">Cliente</p>
            <p className="font-medium">{pedido.cliente_nombre || "Sin nombre"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Localidad</p>
            <p>{pedido.cliente_localidad || "Sin localidad"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Artículos del Pedido */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            Artículos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pedido.detalle && pedido.detalle.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artículo</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Precio Unit.</TableHead>
                    <TableHead>Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedido.detalle.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.articulos?.nombre || "Sin nombre"}</p>
                          <p className="text-sm text-muted-foreground">SKU: {item.articulos?.sku || "N/A"}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.cantidad}</TableCell>
                      <TableCell>${item.precio_unitario?.toFixed(2) || "0.00"}</TableCell>
                      <TableCell className="font-medium">${item.subtotal?.toFixed(2) || "0.00"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              <div className="space-y-2">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>${pedido.total?.toFixed(2) || "0.00"}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-center py-4">No hay artículos en este pedido</p>
          )}
        </CardContent>
      </Card>

      {/* Observaciones */}
      {pedido.observaciones && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Observaciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{pedido.observaciones}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
