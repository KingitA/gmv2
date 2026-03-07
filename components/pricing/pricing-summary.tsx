"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { TrendingDown, Package, Percent, DollarSign, Truck, Receipt } from "lucide-react"
import type { PricingResult } from "@/lib/pricing/pricing-engine"

interface PricingSummaryProps {
  pricing: PricingResult
  showBreakdown?: boolean
}

export function PricingSummary({ pricing, showBreakdown = true }: PricingSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Resumen de Precios
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Subtotal */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Package className="h-4 w-4" />
            <span>Subtotal</span>
          </div>
          <span className="font-medium">${pricing.subtotal.toFixed(2)}</span>
        </div>

        {/* Discount Breakdown */}
        {showBreakdown && pricing.descuento_total > 0 && (
          <div className="space-y-2 rounded-lg bg-green-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700">
              <TrendingDown className="h-4 w-4" />
              <span>Descuentos Aplicados</span>
            </div>

            {pricing.breakdown.descuento_cliente > 0 && (
              <div className="flex justify-between text-xs text-green-600">
                <span>Descuento Cliente ({pricing.breakdown.descuento_cliente}%)</span>
                <Badge variant="outline" className="bg-green-100 text-green-700">
                  Aplicado
                </Badge>
              </div>
            )}

            {pricing.breakdown.descuento_volumen > 0 && (
              <div className="flex justify-between text-xs text-green-600">
                <span>Descuento por Volumen ({pricing.breakdown.descuento_volumen.toFixed(1)}%)</span>
                <Badge variant="outline" className="bg-green-100 text-green-700">
                  Aplicado
                </Badge>
              </div>
            )}

            {pricing.breakdown.descuento_nivel > 0 && (
              <div className="flex justify-between text-xs text-green-600">
                <span>Descuento por Nivel ({pricing.breakdown.descuento_nivel}%)</span>
                <Badge variant="outline" className="bg-green-100 text-green-700">
                  Aplicado
                </Badge>
              </div>
            )}

            {pricing.breakdown.descuento_adicional > 0 && (
              <div className="flex justify-between text-xs text-green-600">
                <span>Descuento Adicional ({pricing.breakdown.descuento_adicional}%)</span>
                <Badge variant="outline" className="bg-green-100 text-green-700">
                  Aplicado
                </Badge>
              </div>
            )}

            <Separator className="bg-green-200" />
            <div className="flex justify-between text-sm font-semibold text-green-700">
              <span>Total Ahorrado</span>
              <span>-${pricing.descuento_total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Early Payment Discount */}
        {pricing.descuento_pronto_pago > 0 && (
          <div className="flex items-center justify-between text-sm text-green-600">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4" />
              <span>Descuento Pronto Pago</span>
            </div>
            <span className="font-medium">-${pricing.descuento_pronto_pago.toFixed(2)}</span>
          </div>
        )}

        {/* Freight */}
        {pricing.flete > 0 && (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Truck className="h-4 w-4" />
              <span>Flete</span>
            </div>
            <span className="font-medium">${pricing.flete.toFixed(2)}</span>
          </div>
        )}

        {pricing.flete === 0 && pricing.subtotal >= 50000 && (
          <div className="flex items-center justify-between text-sm text-green-600">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              <span>Flete</span>
            </div>
            <Badge variant="outline" className="bg-green-100 text-green-700">
              GRATIS
            </Badge>
          </div>
        )}

        {/* IVA */}
        {pricing.iva > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">IVA (21%)</span>
            <span className="font-medium">${pricing.iva.toFixed(2)}</span>
          </div>
        )}

        {/* Percepciones */}
        {pricing.percepciones > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Percepciones (3%)</span>
            <span className="font-medium">${pricing.percepciones.toFixed(2)}</span>
          </div>
        )}

        <Separator />

        {/* Total */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold">Total</span>
          </div>
          <span className="text-2xl font-bold text-primary">${pricing.total.toFixed(2)}</span>
        </div>

        {/* Commission Info (for viajantes) */}
        {pricing.comision_viajante > 0 && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm">
            <div className="flex justify-between text-blue-700">
              <span>Tu Comisión</span>
              <span className="font-semibold">${pricing.comision_viajante.toFixed(2)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
