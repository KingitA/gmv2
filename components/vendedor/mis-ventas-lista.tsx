"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Search, Eye, Edit } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import Link from "next/link"

interface MisVentasListaProps {
  vendedorId: string
}

interface Pedido {
  id: string
  numero: string
  fecha: string
  cliente_id: string
  cliente_nombre: string
  cliente_localidad: string
  total: number
  estado: string
}

export function MisVentasLista({ vendedorId }: MisVentasListaProps) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState("")

  useEffect(() => {
    cargarPedidos()
  }, [vendedorId])

  const cargarPedidos = async () => {
    setLoading(true)
    try {
      console.log("[v0] Fetching pedidos for vendedor:", vendedorId)
      const response = await fetch(`/api/pedidos/vendedor/${vendedorId}`)

      if (!response.ok) {
        throw new Error("Error al cargar pedidos desde el ERP")
      }

      const data = await response.json()
      console.log("[v0] Pedidos response:", data)

      if (!Array.isArray(data) || data.length === 0) {
        console.log("[v0] No pedidos found")
        setPedidos([])
        return
      }

      const pedidosMapeados = data.map((pedido: any) => ({
        id: pedido.id,
        numero: pedido.numero || "Sin número",
        fecha: pedido.fecha,
        cliente_id: pedido.cliente_id,
        cliente_nombre: pedido.cliente?.nombre || pedido.cliente_nombre || "Sin nombre",
        cliente_localidad: pedido.cliente?.localidad || pedido.cliente_localidad || "Sin localidad",
        total: pedido.total || 0,
        estado: pedido.estado || "pendiente",
      }))

      // Ordenar por fecha más reciente primero
      pedidosMapeados.sort((a: Pedido, b: Pedido) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

      setPedidos(pedidosMapeados)
    } catch (error) {
      console.error("[v0] Error cargando pedidos:", error)
      setPedidos([])
    } finally {
      setLoading(false)
    }
  }

  const pedidosFiltrados = pedidos.filter((pedido) => {
    const searchLower = busqueda.toLowerCase()
    return (
      !busqueda ||
      pedido.cliente_nombre.toLowerCase().includes(searchLower) ||
      pedido.numero.toLowerCase().includes(searchLower) ||
      pedido.cliente_localidad.toLowerCase().includes(searchLower)
    )
  })

  const getEstadoBadge = (estado: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pendiente: "secondary",
      confirmado: "default",
      facturado: "outline",
      entregado: "outline",
    }
    return <Badge variant={variants[estado] || "secondary"}>{estado}</Badge>
  }

  if (loading) {
    return <div className="text-center py-8">Cargando pedidos...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Label htmlFor="busqueda">Buscar Pedido</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="busqueda"
              placeholder="Cliente, número de pedido o localidad..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {pedidosFiltrados.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {busqueda ? "No se encontraron pedidos con los filtros aplicados" : "No tienes pedidos registrados aún"}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Número Pedido</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Localidad</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosFiltrados.map((pedido) => (
                <TableRow key={pedido.id}>
                  <TableCell className="font-medium">{pedido.cliente_nombre}</TableCell>
                  <TableCell className="font-mono text-sm">{pedido.numero}</TableCell>
                  <TableCell>{format(new Date(pedido.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                  <TableCell>{pedido.cliente_localidad}</TableCell>
                  <TableCell className="font-medium">${pedido.total.toFixed(2)}</TableCell>
                  <TableCell>{getEstadoBadge(pedido.estado)}</TableCell>
                  <TableCell>
                    <Link href={`/vendedor/mis-ventas/pedido/${pedido.id}`}>
                      <Button variant="ghost" size="sm">
                        {pedido.estado === "pendiente" ? (
                          <>
                            <Edit className="h-4 w-4 mr-1" />
                            Editar
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-1" />
                            Ver
                          </>
                        )}
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Pedidos</p>
            <p className="text-2xl font-bold">{pedidosFiltrados.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Pedidos Pendientes</p>
            <p className="text-2xl font-bold">{pedidosFiltrados.filter((p) => p.estado === "pendiente").length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Vendido</p>
            <p className="text-2xl font-bold">${pedidosFiltrados.reduce((sum, p) => sum + p.total, 0).toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
