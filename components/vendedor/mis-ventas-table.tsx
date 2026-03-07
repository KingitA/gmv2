"use client"

import { CardContent } from "@/components/ui/card"

import { Card } from "@/components/ui/card"

import { useState, useEffect } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Eye, Search } from "lucide-react"
import { ERP_CONFIG } from "@/lib/config/erp"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import Link from "next/link"

interface MisVentasTableProps {
  vendedorId: string
}

export function MisVentasTable({ vendedorId }: MisVentasTableProps) {
  const [pedidos, setPedidos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState("")
  const [estadoFiltro, setEstadoFiltro] = useState<string>("todos")

  useEffect(() => {
    cargarPedidos()
  }, [vendedorId])

  const cargarPedidos = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${ERP_CONFIG.baseUrl}/api/pedidos?vendedor_id=${vendedorId}`)

      if (response.ok) {
        const data = await response.json()
        setPedidos(data.pedidos || [])
      }
    } catch (error) {
      console.error("Error cargando pedidos:", error)
    } finally {
      setLoading(false)
    }
  }

  const pedidosFiltrados = pedidos.filter((pedido) => {
    const matchBusqueda =
      !busqueda ||
      pedido.numero.toString().includes(busqueda) ||
      pedido.cliente_razon_social.toLowerCase().includes(busqueda.toLowerCase())

    const matchEstado = estadoFiltro === "todos" || pedido.estado === estadoFiltro

    return matchBusqueda && matchEstado
  })

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
    return <div className="text-center py-8">Cargando ventas...</div>
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Label htmlFor="busqueda">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="busqueda"
              placeholder="Número de pedido o cliente..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="w-48">
          <Label htmlFor="estado">Estado</Label>
          <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
            <SelectTrigger id="estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="en_preparacion">En Preparación</SelectItem>
              <SelectItem value="enviado">Enviado</SelectItem>
              <SelectItem value="entregado">Entregado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla de Pedidos */}
      {pedidosFiltrados.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {busqueda || estadoFiltro !== "todos"
            ? "No se encontraron pedidos con los filtros aplicados"
            : "No tienes pedidos registrados aún"}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosFiltrados.map((pedido) => (
                <TableRow key={pedido.id}>
                  <TableCell className="font-medium">#{pedido.numero}</TableCell>
                  <TableCell>{format(new Date(pedido.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{pedido.cliente_razon_social}</p>
                      <p className="text-sm text-muted-foreground">{pedido.cliente_localidad}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">${pedido.total.toFixed(2)}</TableCell>
                  <TableCell>{getEstadoBadge(pedido.estado)}</TableCell>
                  <TableCell>
                    <Link href={`/vendedor/mis-ventas/${pedido.id}`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        Ver
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Pedidos</p>
            <p className="text-2xl font-bold">{pedidosFiltrados.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Pendientes</p>
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
