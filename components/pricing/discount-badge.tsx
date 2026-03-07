"use client"

import { Badge } from "@/components/ui/badge"
import { TrendingDown } from "lucide-react"

interface DiscountBadgeProps {
  descuento: number
  tipo?: "cliente" | "volumen" | "nivel" | "pronto_pago"
}

export function DiscountBadge({ descuento, tipo = "cliente" }: DiscountBadgeProps) {
  if (descuento <= 0) return null

  const labels = {
    cliente: "Descuento Cliente",
    volumen: "Descuento Volumen",
    nivel: "Descuento Nivel",
    pronto_pago: "Pronto Pago",
  }

  return (
    <Badge variant="outline" className="bg-green-50 text-green-700">
      <TrendingDown className="mr-1 h-3 w-3" />
      {labels[tipo]} {descuento.toFixed(1)}%
    </Badge>
  )
}
