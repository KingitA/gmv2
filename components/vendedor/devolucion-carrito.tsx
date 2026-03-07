"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Trash2, Package, Truck } from "lucide-react"
import { ERP_CONFIG } from "@/lib/config/erp"
import { useToast } from "@/hooks/use-toast"

interface DevolucionCarritoProps {
  items: any[]
  clienteId: string
  onRemoverItem: (index: number) => void
  onLimpiar: () => void
}

export function DevolucionCarrito({ items, clienteId, onRemoverItem, onLimpiar }: DevolucionCarritoProps) {
  const [retiroPor, setRetiroPor] = useState<"vendedor" | "transporte">("vendedor")
  const [observaciones, setObservaciones] = useState("")
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const handleConfirmar = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${ERP_CONFIG.baseUrl}/api/devoluciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          items: items.map((item) => ({
            articulo_id: item.articulo_id,
            cantidad: item.cantidad_devolucion,
            precio_unitario: item.precio_unitario,
            factura_id: item.factura_id,
          })),
          retiro_por: retiroPor,
          observaciones,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        toast({
          title: "Devolución creada",
          description: `Orden de devolución #${data.numero} generada exitosamente`,
        })
        onLimpiar()
        setObservaciones("")
      } else {
        throw new Error("Error al crear devolución")
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo crear la orden de devolución",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const total = items.reduce((sum, item) => sum + item.cantidad_devolucion * item.precio_unitario, 0)

  return (
    <div className="space-y-6">
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artículo</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead>Precio Unit.</TableHead>
              <TableHead>Subtotal</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={index}>
                <TableCell>
                  <div>
                    <p className="font-medium">{item.descripcion}</p>
                    <p className="text-sm text-muted-foreground">Cód: {item.codigo}</p>
                  </div>
                </TableCell>
                <TableCell>{item.cantidad_devolucion}</TableCell>
                <TableCell>${item.precio_unitario.toFixed(2)}</TableCell>
                <TableCell className="font-medium">
                  ${(item.cantidad_devolucion * item.precio_unitario).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => onRemoverItem(index)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Total de la devolución</p>
          <p className="text-2xl font-bold">${total.toFixed(2)}</p>
        </div>
      </div>

      <div className="space-y-4 border-t pt-4">
        <div>
          <Label>Retiro de Mercadería</Label>
          <RadioGroup value={retiroPor} onValueChange={(v) => setRetiroPor(v as any)}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="vendedor" id="vendedor" />
              <Label htmlFor="vendedor" className="flex items-center gap-2 cursor-pointer">
                <Package className="h-4 w-4" />
                Retiro por vendedor (ahora)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="transporte" id="transporte" />
              <Label htmlFor="transporte" className="flex items-center gap-2 cursor-pointer">
                <Truck className="h-4 w-4" />
                Retiro por transporte (próximo viaje)
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div>
          <Label htmlFor="observaciones">Observaciones</Label>
          <Textarea
            id="observaciones"
            placeholder="Motivo de la devolución, estado de la mercadería, etc."
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onLimpiar}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmar} disabled={loading || items.length === 0}>
            Confirmar Devolución
          </Button>
        </div>
      </div>
    </div>
  )
}
