"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Eye, Edit } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

interface PedidosClienteProps {
  clienteId: string
  vendedorId: string
}

interface Pedido {
  id: string
  numero_pedido: string
  fecha: string
  estado: string
  total: number
  cliente_nombre?: string
  cliente_localidad?: string
  cliente?: any
}

export function PedidosCliente({ clienteId, vendedorId }: PedidosClienteProps) {
  const [cliente, setCliente] = useState<any>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cargarDatos()
  }, [clienteId, vendedorId])

  const cargarDatos = async () => {
    setLoading(true)
    try {
      console.log("[v0] Fetching pedidos for cliente:", clienteId)

      const response = await fetch(`/api/pedidos/cliente/${clienteId}`)

      if (!response.ok) {
        throw new Error(`Error fetching pedidos: ${response.status}`)
      }

      const pedidosData = await response.json()
      console.log("[v0] Pedidos received:", pedidosData.length)

      if (pedidosData.length > 0) {
        const primerPedido = pedidosData[0]
        if (primerPedido.cliente) {
          setCliente(primerPedido.cliente)
        } else {
          setCliente({
            nombre: primerPedido.cliente_nombre || "Cliente",
            localidad: primerPedido.cliente_localidad || "",
            cuit: primerPedido.cliente_cuit || "",
          })
        }
      }

      setPedidos(pedidosData)
    } catch (error) {
      console.error("[v0] Error cargando datos:", error)
    } finally {
      setLoading(false)
    }
  }

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

  if (loading) {
    return <div className="text-center py-8">Cargando pedidos...</div>
  }

  if (!cliente) {
    return <div className="text-center py-8">Cliente no encontrado</div>
  }

  return (
    <div className="space-y-6">
      {/* Información del Cliente */}
      <Card>
        <CardHeader>
          <CardTitle>{cliente.nombre || cliente.razon_social || "Cliente"}</CardTitle>
          <CardDescription>
            {cliente.localidad || "Sin localidad"}
            {cliente.cuit && ` - CUIT: ${cliente.cuit}`}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Pedidos */}
      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
        </CardHeader>
        <CardContent>
          {pedidos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No hay pedidos para este cliente</div>
          ) : (
            <div className="space-y-4">
              {pedidos.map((pedido) => (
                <Card key={pedido.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="font-semibold text-lg">Pedido #{pedido.numero_pedido}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(pedido.fecha), "dd/MM/yyyy", { locale: es })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getEstadoBadge(pedido.estado)}
                        <p className="font-bold text-lg">${pedido.total.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        Ver Detalle
                      </Button>
                      {pedido.estado === "pendiente" && (
                        <Button variant="outline" size="sm">
                          <Edit className="h-4 w-4 mr-1" />
                          Modificar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
