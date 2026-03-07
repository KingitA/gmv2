"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createPago } from "@/lib/actions/pagos"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { AlertCircle, DollarSign, CreditCard } from "lucide-react"

export function PagoForm({ clienteId, saldoActual }: { clienteId: string; saldoActual: number }) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [monto, setMonto] = useState("")
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia" | "cheque" | "tarjeta">("efectivo")
  const [referencia, setReferencia] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split("T")[0])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    const montoNum = Number.parseFloat(monto)

    if (!montoNum || montoNum <= 0) {
      setError("El monto debe ser mayor a 0")
      setIsSubmitting(false)
      return
    }

    if (montoNum > saldoActual) {
      setError(`El monto no puede ser mayor al saldo actual ($${saldoActual.toFixed(2)})`)
      setIsSubmitting(false)
      return
    }

    try {
      await createPago({
        cliente_id: clienteId,
        monto: montoNum,
        metodo,
        referencia: referencia || undefined,
        observaciones: observaciones || undefined,
        fecha_pago: fechaPago,
      })

      router.push(`/crm/viajante/clientes/${clienteId}/pagos`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el pago")
      setIsSubmitting(false)
    }
  }

  const nuevoSaldo = saldoActual - (Number.parseFloat(monto) || 0)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Current Balance */}
      <Card>
        <CardHeader>
          <CardTitle>Saldo Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Saldo a pagar:</span>
            <span className="text-2xl font-bold text-destructive">${saldoActual.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Payment Details */}
      <Card>
        <CardHeader>
          <CardTitle>Detalles del Pago</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="monto">
              Monto <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="monto"
                type="number"
                step="0.01"
                min="0"
                max={saldoActual}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                className="pl-10"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="metodo">
              Método de Pago <span className="text-destructive">*</span>
            </Label>
            <Select value={metodo} onValueChange={(value: any) => setMetodo(value)}>
              <SelectTrigger id="metodo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">Efectivo</SelectItem>
                <SelectItem value="transferencia">Transferencia</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="tarjeta">Tarjeta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="referencia">Referencia</Label>
            <Input
              id="referencia"
              type="text"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Número de cheque, transferencia, etc."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fecha">
              Fecha de Pago <span className="text-destructive">*</span>
            </Label>
            <Input id="fecha" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas adicionales sobre el pago..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* New Balance Preview */}
      {monto && Number.parseFloat(monto) > 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="font-medium text-green-700">Nuevo Saldo:</span>
              <span className="text-2xl font-bold text-green-700">${nuevoSaldo.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Registrando...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Registrar Pago
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
          className="flex-1"
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
