"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { ERP_CONFIG } from "@/lib/config/erp"

interface ClienteSelectorDevolucionProps {
  vendedorId: string
  onClienteSelect: (cliente: any) => void
}

export function ClienteSelectorDevolucion({ vendedorId, onClienteSelect }: ClienteSelectorDevolucionProps) {
  const [busqueda, setBusqueda] = useState("")
  const [clientes, setClientes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const buscarClientes = async () => {
    if (!busqueda.trim()) return

    setLoading(true)
    try {
      const response = await fetch(
        `${ERP_CONFIG.baseUrl}/api/clientes?vendedor_id=${vendedorId}&search=${encodeURIComponent(busqueda)}`,
      )

      if (response.ok) {
        const data = await response.json()
        setClientes(data.clientes || [])
      }
    } catch (error) {
      console.error("Error buscando clientes:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="busqueda">Buscar Cliente</Label>
          <Input
            id="busqueda"
            placeholder="Nombre, razón social o código..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buscarClientes()}
          />
        </div>
        <Button onClick={buscarClientes} disabled={loading} className="mt-auto">
          <Search className="h-4 w-4 mr-2" />
          Buscar
        </Button>
      </div>

      {clientes.length > 0 && (
        <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
          {clientes.map((cliente) => (
            <button
              key={cliente.id}
              onClick={() => {
                onClienteSelect(cliente)
                setClientes([])
                setBusqueda("")
              }}
              className="w-full p-3 text-left hover:bg-muted transition-colors"
            >
              <p className="font-medium">{cliente.razon_social}</p>
              <p className="text-sm text-muted-foreground">
                {cliente.direccion} - {cliente.localidad}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
