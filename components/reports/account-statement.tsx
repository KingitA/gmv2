"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Download, Calendar, TrendingUp, TrendingDown } from "lucide-react"

interface Movement {
  id: string
  tipo: "debe" | "haber"
  concepto: string
  importe: number
  saldo_resultante: number
  fecha: string
  referencia?: string
}

interface AccountStatementProps {
  cliente: {
    razon_social: string
    cuit: string
    direccion: string
    zona: string
  }
  movimientos: Movement[]
  saldoActual: number
  limiteCredito: number
}

export function AccountStatement({ cliente, movimientos, saldoActual, limiteCredito }: AccountStatementProps) {
  const handleExport = () => {
    // Generate CSV export
    const headers = ["Fecha", "Tipo", "Concepto", "Debe", "Haber", "Saldo"]
    const rows = movimientos.map((m) => [
      new Date(m.fecha).toLocaleDateString("es-AR"),
      m.tipo.toUpperCase(),
      m.concepto,
      m.tipo === "debe" ? m.importe.toFixed(2) : "",
      m.tipo === "haber" ? m.importe.toFixed(2) : "",
      m.saldo_resultante.toFixed(2),
    ])

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `estado-cuenta-${cliente.razon_social.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Estado de Cuenta</CardTitle>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Client Info */}
        <div className="space-y-2">
          <h3 className="font-semibold">{cliente.razon_social}</h3>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <p>CUIT: {cliente.cuit}</p>
            <p>Dirección: {cliente.direccion}</p>
            <p>Zona: {cliente.zona}</p>
          </div>
        </div>

        <Separator />

        {/* Balance Summary */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Saldo Actual</p>
            <p className={`text-2xl font-bold ${saldoActual > 0 ? "text-destructive" : "text-green-600"}`}>
              ${Math.abs(saldoActual).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">{saldoActual > 0 ? "Debe" : "A favor"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Crédito Disponible</p>
            <p className="text-2xl font-bold text-green-600">${Math.max(0, limiteCredito - saldoActual).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Límite: ${limiteCredito.toFixed(2)}</p>
          </div>
        </div>

        <Separator />

        {/* Movements */}
        <div className="space-y-3">
          <h4 className="font-semibold">Movimientos</h4>
          {movimientos.map((mov) => (
            <div key={mov.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  {mov.tipo === "debe" ? (
                    <TrendingUp className="h-4 w-4 text-destructive" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-green-600" />
                  )}
                  <p className="font-medium">{mov.concepto}</p>
                  <Badge variant={mov.tipo === "debe" ? "destructive" : "default"}>{mov.tipo.toUpperCase()}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {new Date(mov.fecha).toLocaleDateString("es-AR")}
                  {mov.referencia && <span>• Ref: {mov.referencia}</span>}
                </div>
              </div>
              <div className="text-right">
                <p className={`text-lg font-bold ${mov.tipo === "debe" ? "text-destructive" : "text-green-600"}`}>
                  {mov.tipo === "debe" ? "+" : "-"}${mov.importe.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">Saldo: ${mov.saldo_resultante.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
