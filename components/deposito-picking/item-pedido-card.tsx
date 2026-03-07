"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertCircle, XCircle, CheckCircle2 } from 'lucide-react'

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

interface ItemPedidoCardProps {
  item: ItemPedido
  onMarcarFaltante: (itemId: string) => void
  onCerrarParcial: (itemId: string) => void
}

export function ItemPedidoCard({ item, onMarcarFaltante, onCerrarParcial }: ItemPedidoCardProps) {
  const getEstadoBadge = () => {
    switch (item.estado_item) {
      case "COMPLETO":
        return <Badge className="bg-green-500">COMPLETO</Badge>
      case "PARCIAL":
        return <Badge className="bg-orange-500">PARCIAL</Badge>
      case "FALTANTE":
        return <Badge variant="destructive">FALTANTE</Badge>
      case "PENDIENTE":
      default:
        return <Badge variant="secondary">PENDIENTE</Badge>
    }
  }

  const porcentaje = (item.cantidad_preparada / item.cantidad) * 100

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-muted-foreground">{item.articulo.sku}</span>
              {getEstadoBadge()}
            </div>
            <h3 className="font-semibold leading-tight">{item.articulo.descripcion}</h3>
            {item.articulo.ean13 && (
              <p className="text-xs text-muted-foreground mt-1">EAN: {item.articulo.ean13}</p>
            )}
          </div>
        </div>

        {/* Progreso */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Preparado:</span>
            <span className="font-bold">
              {item.cantidad_preparada} / {item.cantidad}
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(porcentaje, 100)}%` }}
            />
          </div>
        </div>

        {/* Acciones */}
        {item.estado_item === "PENDIENTE" && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onMarcarFaltante(item.id)}>
              <XCircle className="mr-2 h-4 w-4" />
              Faltante
            </Button>
            {item.cantidad_preparada > 0 && (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onCerrarParcial(item.id)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Cerrar
              </Button>
            )}
          </div>
        )}

        {item.estado_item === "PARCIAL" && (
          <div className="flex items-center gap-2 text-sm text-orange-600">
            <AlertCircle className="h-4 w-4" />
            <span>Cantidad parcial preparada</span>
          </div>
        )}

        {item.estado_item === "FALTANTE" && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4" />
            <span>Artículo faltante</span>
          </div>
        )}

        {item.estado_item === "COMPLETO" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>Preparación completa</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
