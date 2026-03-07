"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, Loader2, Search } from "lucide-react"

interface MercaderiaVendidaDialogProps {
  clienteId: string
}

export function MercaderiaVendidaDialog({ clienteId }: MercaderiaVendidaDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ventas, setVentas] = useState<any[]>([])
  const [filters, setFilters] = useState({
    fecha_desde: "",
    fecha_hasta: "",
    articulo: "",
  })

  const handleSearch = async () => {
    setLoading(true)
    try {
      const erpUrl = process.env.NEXT_PUBLIC_ERP_URL
      const params = new URLSearchParams({ cliente_id: clienteId })
      if (filters.fecha_desde) params.append("fecha_desde", filters.fecha_desde)
      if (filters.fecha_hasta) params.append("fecha_hasta", filters.fecha_hasta)

      const response = await fetch(`${erpUrl}/api/mercaderia-vendida?${params}`)
      if (response.ok) {
        const data = await response.json()
        setVentas(data.ventas || [])
      }
    } catch (error) {
      console.error("Error fetching mercadería vendida:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileText className="mr-2 h-4 w-4" />
          Mercadería Vendida
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mercadería Vendida</DialogTitle>
          <DialogDescription>Consulta el historial de mercadería vendida a este cliente</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="fecha_desde">Desde</Label>
              <Input
                id="fecha_desde"
                type="date"
                value={filters.fecha_desde}
                onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fecha_hasta">Hasta</Label>
              <Input
                id="fecha_hasta"
                type="date"
                value={filters.fecha_hasta}
                onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleSearch} disabled={loading} className="w-full">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Artículo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio Unit.</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {loading ? "Cargando..." : "No hay resultados. Realiza una búsqueda."}
                    </TableCell>
                  </TableRow>
                ) : (
                  ventas.map((venta) => (
                    <TableRow key={venta.id}>
                      <TableCell>{new Date(venta.fecha).toLocaleDateString("es-AR")}</TableCell>
                      <TableCell className="font-mono text-sm">{venta.pedido_numero}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{venta.articulo.descripcion}</p>
                          <p className="text-sm text-muted-foreground">SKU: {venta.articulo.sku}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{venta.cantidad}</TableCell>
                      <TableCell className="text-right">
                        ${venta.precio_unitario.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${venta.subtotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
