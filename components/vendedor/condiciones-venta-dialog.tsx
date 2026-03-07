"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Settings } from "lucide-react"
import type { Cliente } from "@/lib/types/database"

interface CondicionesVentaDialogProps {
  cliente: Cliente
  condicionesActuales: any
  onGuardar: (condiciones: any) => void
}

export function CondicionesVentaDialog({ cliente, condicionesActuales, onGuardar }: CondicionesVentaDialogProps) {
  const [open, setOpen] = useState(false)
  const [guardarPermanente, setGuardarPermanente] = useState(false)
  const [formData, setFormData] = useState({
    direccion_entrega: condicionesActuales?.direccion_entrega || cliente.direccion || "",
    razon_social_factura: condicionesActuales?.razon_social_factura || cliente.razon_social || "",
    forma_facturacion: condicionesActuales?.forma_facturacion || cliente.metodo_facturacion || "factura",
  })

  const handleGuardar = async () => {
    if (guardarPermanente) {
      // TODO: Implement permanent save via PATCH /api/clientes/{id}
      alert("Guardado permanente no implementado aún")
    } else {
      onGuardar(formData)
    }
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="mr-2 h-4 w-4" />
          Condiciones de Venta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Condiciones de Venta</DialogTitle>
          <DialogDescription>Modifica las condiciones para este pedido o guárdalas permanentemente</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="direccion">Dirección de Entrega</Label>
            <Input
              id="direccion"
              value={formData.direccion_entrega}
              onChange={(e) => setFormData({ ...formData, direccion_entrega: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="razon_social">Razón Social para Factura</Label>
            <Input
              id="razon_social"
              value={formData.razon_social_factura}
              onChange={(e) => setFormData({ ...formData, razon_social_factura: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="forma_facturacion">Forma de Facturación</Label>
            <Select
              value={formData.forma_facturacion}
              onValueChange={(value) => setFormData({ ...formData, forma_facturacion: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="factura">Factura A/B</SelectItem>
                <SelectItem value="final">Factura C / Consumidor Final</SelectItem>
                <SelectItem value="remito">Solo Remito</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2">
            <Switch id="permanente" checked={guardarPermanente} onCheckedChange={setGuardarPermanente} />
            <Label htmlFor="permanente">Guardar cambios permanentemente</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleGuardar}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
