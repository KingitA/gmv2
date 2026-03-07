"use client"

import { useState } from "react"
import type { Cliente } from "@/lib/types/database"
import { searchClientes } from "@/lib/actions/clientes"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { Search, MapPin, Phone, Mail, ChevronRight } from "lucide-react"

export function ClientesList({
  initialClientes,
}: {
  initialClientes: Cliente[]
}) {
  const [clientes, setClientes] = useState<Cliente[]>(initialClientes)
  const [searchTerm, setSearchTerm] = useState("")
  const [isSearching, setIsSearching] = useState(false)

  const handleSearch = async (term: string) => {
    setSearchTerm(term)
    if (term.length < 2) {
      setClientes(initialClientes)
      return
    }

    setIsSearching(true)
    try {
      const results = await searchClientes(term)
      setClientes(results)
    } catch (error) {
      console.error("Error searching:", error)
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Buscar por nombre, zona, dirección o CUIT..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          className="h-12 pl-10"
        />
      </div>

      {/* Results */}
      {isSearching ? (
        <div className="py-12 text-center text-muted-foreground">Buscando...</div>
      ) : clientes.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">No se encontraron clientes</div>
      ) : (
        <div className="grid gap-3">
          {clientes.map((cliente) => (
            <Card key={cliente.id} className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <Link href={`/crm/viajante/clientes/${cliente.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">{cliente.razon_social}</h3>
                          {cliente.cuit && <p className="text-sm text-muted-foreground">CUIT: {cliente.cuit}</p>}
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>

                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span>{cliente.zona}</span>
                        </div>
                        {cliente.telefono && (
                          <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span>{cliente.telefono}</span>
                          </div>
                        )}
                        {cliente.email && (
                          <div className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            <span>{cliente.email}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">Crédito: {cliente.dias_credito} días</Badge>
                        <Badge variant="outline">Límite: ${cliente.limite_credito?.toFixed(2) ?? "0.00"}</Badge>
                        {(cliente.descuento_especial ?? 0) > 0 && (
                          <Badge variant="outline" className="bg-accent/10">
                            Dto: {cliente.descuento_especial}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
