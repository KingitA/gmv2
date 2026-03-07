"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Search, Plus, ShoppingCart } from "lucide-react"
import Link from "next/link"
import type { Cliente } from "@/lib/types/database"

interface ClienteSelectorProps {
  clientes: Cliente[]
  vendedorId: string
}

export function ClienteSelector({ clientes }: ClienteSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const filteredClientes = useMemo(() => {
    if (!searchTerm) return clientes

    const term = searchTerm.toLowerCase()
    return clientes.filter(
      (cliente) =>
        cliente.razon_social?.toLowerCase().includes(term) ||
        cliente.nombre?.toLowerCase().includes(term) ||
        cliente.cuit?.includes(term) ||
        cliente.direccion?.toLowerCase().includes(term),
    )
  }, [clientes, searchTerm])

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente por nombre, CUIT o dirección..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button asChild variant="outline">
          <Link href="/vendedor/clientes/nuevo">
            <Plus className="mr-2 h-4 w-4" />
            Cliente Nuevo
          </Link>
        </Button>
      </div>

      <div className="grid gap-3">
        {filteredClientes.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No se encontraron clientes</p>
        ) : (
          filteredClientes.map((cliente) => (
            <Card key={cliente.id} className="p-4 hover:bg-accent transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold">{cliente.razon_social || cliente.nombre}</h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {cliente.cuit && <p>CUIT: {cliente.cuit}</p>}
                    {cliente.direccion && <p>{cliente.direccion}</p>}
                    {cliente.localidad && <p>{cliente.localidad}</p>}
                  </div>
                </div>
                <Button asChild>
                  <Link href={`/vendedor/pedidos/nuevo/${cliente.id}`}>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Seleccionar
                  </Link>
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Mostrando {filteredClientes.length} de {clientes.length} clientes
      </p>
    </div>
  )
}
