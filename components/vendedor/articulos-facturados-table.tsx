"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus } from "lucide-react"
import { ERP_CONFIG } from "@/lib/config/erp"
import { format } from "date-fns"
import { es } from "date-fns/locale"

interface ArticulosFacturadosTableProps {
  clienteId: string
  onAgregarArticulo: (articulo: any) => void
}

export function ArticulosFacturadosTable({ clienteId, onAgregarArticulo }: ArticulosFacturadosTableProps) {
  const [busqueda, setBusqueda] = useState("")
  const [articulos, setArticulos] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [cantidades, setCantidades] = useState<Record<string, number>>({})

  const buscarArticulos = async () => {
    if (!busqueda.trim()) return

    setLoading(true)
    try {
      const response = await fetch(
        `${ERP_CONFIG.baseUrl}/api/clientes/${clienteId}/articulos-facturados?search=${encodeURIComponent(busqueda)}`,
      )

      if (response.ok) {
        const data = await response.json()
        setArticulos(data.articulos || [])
      }
    } catch (error) {
      console.error("Error buscando artículos:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleAgregar = (articulo: any) => {
    const cantidad = cantidades[articulo.id] || 0
    if (cantidad <= 0) return

    onAgregarArticulo({
      ...articulo,
      cantidad_devolucion: cantidad,
    })

    setCantidades((prev) => ({ ...prev, [articulo.id]: 0 }))
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="busqueda-articulo">Buscar Artículo Facturado</Label>
          <Input
            id="busqueda-articulo"
            placeholder="Código o descripción del artículo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buscarArticulos()}
          />
        </div>
        <Button onClick={buscarArticulos} disabled={loading} className="mt-auto">
          <Search className="h-4 w-4 mr-2" />
          Buscar
        </Button>
      </div>

      {articulos.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead>Fecha Factura</TableHead>
                <TableHead>Cantidad Facturada</TableHead>
                <TableHead>Precio</TableHead>
                <TableHead>Cantidad a Devolver</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articulos.map((articulo) => (
                <TableRow key={articulo.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{articulo.descripcion}</p>
                      <p className="text-sm text-muted-foreground">Cód: {articulo.codigo}</p>
                    </div>
                  </TableCell>
                  <TableCell>{format(new Date(articulo.fecha_factura), "dd/MM/yyyy", { locale: es })}</TableCell>
                  <TableCell>{articulo.cantidad}</TableCell>
                  <TableCell>${articulo.precio_unitario.toFixed(2)}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      max={articulo.cantidad}
                      value={cantidades[articulo.id] || ""}
                      onChange={(e) =>
                        setCantidades((prev) => ({
                          ...prev,
                          [articulo.id]: Number.parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => handleAgregar(articulo)}
                      disabled={!cantidades[articulo.id] || cantidades[articulo.id] <= 0}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Agregar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
