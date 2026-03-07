"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Eye, FileText } from "lucide-react"
import Link from "next/link"
import type { Cliente } from "@/lib/types/database"

interface ClientesTableProps {
  clientes: Cliente[]
  vendedorId: string
}

export function ClientesTable({ clientes }: ClientesTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [zonaFilter, setZonaFilter] = useState<string>("all")
  const [estadoFilter, setEstadoFilter] = useState<string>("all")

  // Get unique zonas for filter
  const zonas = useMemo(() => {
    const uniqueZonas = new Set(clientes.map((c) => c.localidad).filter(Boolean))
    return Array.from(uniqueZonas).sort()
  }, [clientes])

  // Filter clientes
  const filteredClientes = useMemo(() => {
    return clientes.filter((cliente) => {
      const matchesSearch =
        searchTerm === "" ||
        cliente.razon_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cliente.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cliente.direccion?.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesZona = zonaFilter === "all" || cliente.localidad === zonaFilter

      // TODO: Implement estado logic based on cuenta corriente
      const matchesEstado = estadoFilter === "all"

      return matchesSearch && matchesZona && matchesEstado
    })
  }, [clientes, searchTerm, zonaFilter, estadoFilter])

  // Mock function to get estado - will be replaced with real data
  const getEstadoCuenta = (_clienteId: string) => {
    // TODO: Fetch from cuenta corriente
    return "libre"
  }

  const getEstadoBadge = (estado: string) => {
    switch (estado) {
      case "libre":
        return (
          <Badge variant="default" className="bg-green-500">
            Libre de Deuda
          </Badge>
        )
      case "pendiente":
        return <Badge variant="secondary">Pago Pendiente</Badge>
      case "vencido":
        return <Badge variant="destructive">Pago Vencido</Badge>
      default:
        return <Badge variant="outline">Desconocido</Badge>
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, razón social o dirección..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={zonaFilter} onValueChange={setZonaFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filtrar por zona" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las zonas</SelectItem>
            {zonas.map((zona) => (
              <SelectItem key={zona} value={zona || "none"}>
                {zona}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Estado de cuenta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="libre">Libre de Deuda</SelectItem>
            <SelectItem value="pendiente">Pago Pendiente</SelectItem>
            <SelectItem value="vencido">Pago Vencido</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Dirección</TableHead>
              <TableHead>Zona</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClientes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No se encontraron clientes
                </TableCell>
              </TableRow>
            ) : (
              filteredClientes.map((cliente) => (
                <TableRow key={cliente.id}>
                  <TableCell className="font-medium">
                    <div>
                      <p>{cliente.razon_social || cliente.nombre}</p>
                      {cliente.cuit && <p className="text-sm text-muted-foreground">CUIT: {cliente.cuit}</p>}
                    </div>
                  </TableCell>
                  <TableCell>{cliente.direccion || "-"}</TableCell>
                  <TableCell>{cliente.localidad || "-"}</TableCell>
                  <TableCell>{getEstadoBadge(getEstadoCuenta(cliente.id))}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/vendedor/clientes/${cliente.id}/cuenta-corriente`}>
                          <FileText className="mr-2 h-4 w-4" />
                          Cuenta Corriente
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/vendedor/clientes/${cliente.id}/catalogo`}>
                          <Eye className="mr-2 h-4 w-4" />
                          Ver Catálogo
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        Mostrando {filteredClientes.length} de {clientes.length} clientes
      </p>
    </div>
  )
}
