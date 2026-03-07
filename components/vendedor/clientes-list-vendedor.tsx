"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Link from "next/link"
import { Search, MapPin, Phone, Mail } from "lucide-react"
import type { Cliente } from "@/lib/types/database"

interface ClientesListVendedorProps {
  clientes: Cliente[]
}

export function ClientesListVendedor({ clientes }: ClientesListVendedorProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const filteredClientes = clientes.filter((cliente) => {
    const searchLower = searchTerm.toLowerCase()
    return (
      cliente.razon_social?.toLowerCase().includes(searchLower) ||
      cliente.nombre?.toLowerCase().includes(searchLower) ||
      cliente.cuit?.includes(searchLower) ||
      cliente.localidad?.toLowerCase().includes(searchLower)
    )
  })

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Buscar por nombre, CUIT, localidad..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredClientes.map((cliente) => (
          <Card key={cliente.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-lg">{cliente.razon_social || cliente.nombre}</h3>
                  {cliente.cuit && <p className="text-sm text-muted-foreground">CUIT: {cliente.cuit}</p>}
                </div>

                <div className="space-y-1 text-sm">
                  {cliente.localidad && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span>{cliente.localidad}</span>
                    </div>
                  )}
                  {cliente.telefono && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{cliente.telefono}</span>
                    </div>
                  )}
                  {cliente.mail && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <span className="truncate">{cliente.mail}</span>
                    </div>
                  )}
                </div>

                <Button asChild className="w-full">
                  <Link href={`/vendedor/clientes/${cliente.id}/catalogo`}>Ver Catálogo y Crear Pedido</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredClientes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No se encontraron clientes que coincidan con la búsqueda</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
