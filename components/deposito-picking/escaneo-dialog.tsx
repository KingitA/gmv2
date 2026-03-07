"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Scan, Plus, Minus } from 'lucide-react'

interface ItemPedido {
  id: string
  cantidad: number
  cantidad_preparada: number
  estado_item: string
  articulo: {
    id: string
    sku: string
    descripcion: string
    ean13: string
  }
}

interface EscaneoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pedidoId: string
  items: ItemPedido[]
  sesionId: string | null
  onSuccess: () => void
}

export function EscaneoDialog({ open, onOpenChange, pedidoId, items, sesionId, onSuccess }: EscaneoDialogProps) {
  const [ean, setEan] = useState("")
  const [articuloEncontrado, setArticuloEncontrado] = useState<ItemPedido | null>(null)
  const [cantidadASumar, setCantidadASumar] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)
  const { toast } = useToast()

  const handleBuscarEan = async () => {
    if (!ean) {
      toast({
        title: "Campo vacío",
        description: "Por favor ingresa un código EAN",
        variant: "destructive",
      })
      return
    }

    setIsProcessing(true)

    // Buscar el artículo en los items del pedido
    const itemEncontrado = items.find((item) => item.articulo.ean13 === ean)

    if (!itemEncontrado) {
      toast({
        title: "Artículo no encontrado",
        description: "Este artículo no forma parte del pedido",
        variant: "destructive",
      })
      setIsProcessing(false)
      return
    }

    setArticuloEncontrado(itemEncontrado)
    setCantidadASumar(1)
    setIsProcessing(false)
  }

  const handleConfirmar = async () => {
    if (!articuloEncontrado) return

    setIsProcessing(true)
    const supabase = createClient()

    try {
      const nuevaCantidadPreparada = articuloEncontrado.cantidad_preparada + cantidadASumar
      let nuevoEstado = "PENDIENTE"

      if (nuevaCantidadPreparada >= articuloEncontrado.cantidad) {
        nuevoEstado = "COMPLETO"
      } else if (nuevaCantidadPreparada > 0) {
        nuevoEstado = "PARCIAL"
      }

      // Actualizar cantidad preparada
      const { error: updateError } = await supabase
        .from("pedidos_detalle")
        .update({
          cantidad_preparada: nuevaCantidadPreparada,
          estado_item: nuevoEstado,
        })
        .eq("id", articuloEncontrado.id)

      if (updateError) throw updateError

      // Registrar escaneo en log (si existe sesión)
      if (sesionId) {
        await supabase.from("picking_scans_log").insert({
          picking_sesion_id: sesionId,
          pedido_item_id: articuloEncontrado.id,
          articulo_id: articuloEncontrado.articulo.id,
          ean_leido: ean,
          cantidad_sumada: cantidadASumar,
        })
      }

      toast({
        title: "Cantidad sumada",
        description: `${cantidadASumar} unidad(es) agregada(s) a ${articuloEncontrado.articulo.descripcion}`,
      })

      // Limpiar y cerrar
      resetForm()
      onSuccess()
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo registrar el escaneo",
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const resetForm = () => {
    setEan("")
    setArticuloEncontrado(null)
    setCantidadASumar(1)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Escanear Código de Barras
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!articuloEncontrado ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="ean">Código EAN</Label>
                <div className="flex gap-2">
                  <Input
                    id="ean"
                    value={ean}
                    onChange={(e) => setEan(e.target.value)}
                    placeholder="Escanea o ingresa el código"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleBuscarEan()
                      }
                    }}
                    autoFocus
                  />
                  <Button onClick={handleBuscarEan} disabled={isProcessing}>
                    Buscar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Puedes usar un lector de código de barras o ingresar manualmente
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Artículo encontrado:</p>
                  <p className="font-semibold">{articuloEncontrado.articulo.descripcion}</p>
                  <p className="text-xs text-muted-foreground mt-1">SKU: {articuloEncontrado.articulo.sku}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Cantidad pedida:</p>
                    <p className="font-bold text-lg">{articuloEncontrado.cantidad}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Ya preparado:</p>
                    <p className="font-bold text-lg">{articuloEncontrado.cantidad_preparada}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Cantidad a sumar</Label>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setCantidadASumar(Math.max(1, cantidadASumar - 1))}
                    disabled={cantidadASumar <= 1}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min="1"
                    value={cantidadASumar}
                    onChange={(e) => setCantidadASumar(Math.max(1, Number.parseInt(e.target.value) || 1))}
                    className="text-center font-bold text-lg"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setCantidadASumar(cantidadASumar + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetForm}>
            Cancelar
          </Button>
          {articuloEncontrado && (
            <Button onClick={handleConfirmar} disabled={isProcessing}>
              Confirmar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
