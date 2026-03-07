"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Search, Package } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import Link from "next/link"

interface MisVentasClientesProps {
  vendedorId: string
}

interface ClienteConVentas {
  cliente_id: string
  cliente_nombre: string
  cliente_localidad: string
  ultimo_pedido: string
  total_pedidos: number
  total_monto: number
}

export function MisVentasClientes({ vendedorId }: MisVentasClientesProps) {
  const [clientes, setClientes] = useState<ClienteConVentas[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState("")

  useEffect(() => {
    cargarClientes()
  }, [vendedorId])

  const cargarClientes = async () => {
    setLoading(true)
    try {
      console.log("[v0] Fetching pedidos for vendedor:", vendedorId)
      const response = await fetch(`/api/pedidos/vendedor/${vendedorId}`)

      if (!response.ok) {
        throw new Error("Error al cargar pedidos desde el ERP")
      }

      const pedidos = await response.json()
      console.log("[v0] Pedidos response:", pedidos)
      console.log("[v0] Is array?", Array.isArray(pedidos))

      if (!Array.isArray(pedidos) || pedidos.length === 0) {
        console.log("[v0] No pedidos found or invalid response format")
        setClientes([])
        return
      }

      // Agrupar por cliente
      const clientesMap = new Map<string, ClienteConVentas>()

      pedidos.forEach((pedido: any) => {
        const clienteId = pedido.cliente_id

        if (!clientesMap.has(clienteId)) {
          clientesMap.set(clienteId, {
            cliente_id: clienteId,
            cliente_nombre: pedido.cliente?.nombre || pedido.cliente_nombre || "Sin nombre",
            cliente_localidad: pedido.cliente?.localidad || pedido.cliente_localidad || "Sin localidad",
            ultimo_pedido: pedido.fecha,
            total_pedidos: 1,
            total_monto: pedido.total || 0,
          })
        } else {
          const cliente = clientesMap.get(clienteId)!
          cliente.total_pedidos += 1
          cliente.total_monto += pedido.total || 0
          // Actualizar último pedido si es más reciente
          if (new Date(pedido.fecha) > new Date(cliente.ultimo_pedido)) {
            cliente.ultimo_pedido = pedido.fecha
          }
        }
      })

      const clientesArray = Array.from(clientesMap.values()).sort(
        (a, b) => new Date(b.ultimo_pedido).getTime() - new Date(a.ultimo_pedido).getTime(),
      )

      setClientes(clientesArray)
    } catch (error) {
      console.error("[v0] Error cargando clientes:", error)
      setClientes([])
    } finally {
      setLoading(false)
    }
  }

  const clientesFiltrados = clientes.filter((cliente) => {
    return (
      !busqueda ||
      cliente.cliente_nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      cliente.cliente_localidad.toLowerCase().includes(busqueda.toLowerCase())
    )
  })

  if (loading) {
    return <div className="text-center py-8">Cargando clientes...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Label htmlFor="busqueda">Buscar Cliente</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="busqueda"
              placeholder="Nombre o localidad..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {clientesFiltrados.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {busqueda ? "No se encontraron clientes con los filtros aplicados" : "No tienes ventas registradas aún"}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Localidad</TableHead>
                <TableHead>Último Pedido</TableHead>
                <TableHead>Total Pedidos</TableHead>
                <TableHead>Total Vendido</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientesFiltrados.map((cliente) => (
                <TableRow key={cliente.cliente_id}>
                  <TableCell className="font-medium">{cliente.cliente_nombre}</TableCell>
                  <TableCell>{cliente.cliente_localidad}</TableCell>
                  <TableCell>{format(new Date(cliente.ultimo_pedido), "dd/MM/yyyy", { locale: es })}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{cliente.total_pedidos}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">${cliente.total_monto.toFixed(2)}</TableCell>
                  <TableCell>
                    <Link href={`/vendedor/mis-ventas/${cliente.cliente_id}`}>
                      <Button variant="ghost" size="sm">
                        <Package className="h-4 w-4 mr-1" />
                        Ver Pedidos
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
            <p className="text-sm text-muted-foreground">Total Clientes</p>
            <p className="text-2xl font-bold">{clientesFiltrados.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Pedidos</p>
            <p className="text-2xl font-bold">{clientesFiltrados.reduce((sum, c) => sum + c.total_pedidos, 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Vendido</p>
            <p className="text-2xl font-bold">
              ${clientesFiltrados.reduce((sum, c) => sum + c.total_monto, 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
