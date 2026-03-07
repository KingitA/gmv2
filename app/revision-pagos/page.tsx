export const dynamic = 'force-dynamic'
"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { CheckCircle, XCircle, Loader2, DollarSign } from 'lucide-react'
import { useToast } from "@/hooks/use-toast"

export default function RevisionPagosPage() {
  const [pagos, setPagos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState("")
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [imputaciones, setImputaciones] = useState<Record<string, number>>({})
  const { toast } = useToast()

  useEffect(() => {
    cargarPagos()
  }, [])

  async function cargarPagos() {
    try {
      const response = await fetch("/api/pagos?estado=pendiente")
      const data = await response.json()
      setPagos(data || [])
    } catch (error) {
      console.error("[v0] Error cargando pagos:", error)
      toast({ title: "Error", description: "No se pudieron cargar los pagos pendientes", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  async function cargarComprobantes(clienteId: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from("comprobantes_venta")
      .select("*")
      .eq("cliente_id", clienteId)
      .in("estado_pago", ["pendiente", "parcial"])
      .order("fecha_emision", { ascending: true })

    setComprobantes(data || [])
  }

  async function confirmarPago(pagoId: string) {
    setProcesando(pagoId)
    try {
      // Preparar imputaciones seleccionadas
      const imputacionesArray = Object.entries(imputaciones)
        .filter(([compId, monto]) => monto > 0)
        .map(([compId, monto]) => ({
          comprobante_id: compId,
          monto_imputado: monto,
        }))

      const response = await fetch(`/api/pagos/${pagoId}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_confirmador: "admin", // TODO: obtener del usuario actual
          accion: "confirmar",
          imputaciones: imputacionesArray.length > 0 ? imputacionesArray : undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error)

      toast({ title: "Éxito", description: "Pago confirmado e imputado correctamente" })
      setImputaciones({})
      setComprobantes([])
      cargarPagos()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setProcesando(null)
    }
  }

  async function rechazarPago(pagoId: string) {
    if (!motivoRechazo.trim()) {
      toast({ title: "Error", description: "Debe ingresar un motivo de rechazo", variant: "destructive" })
      return
    }

    setProcesando(pagoId)
    try {
      const response = await fetch(`/api/pagos/${pagoId}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_confirmador: "admin", // TODO: obtener del usuario actual
          accion: "rechazar",
          motivo_rechazo: motivoRechazo,
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error)

      toast({ title: "Éxito", description: "Pago rechazado correctamente" })
      setMotivoRechazo("")
      cargarPagos()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setProcesando(null)
    }
  }

  const getTotalImputado = () => {
    return Object.values(imputaciones).reduce((sum, monto) => sum + (monto || 0), 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">REVISIÓN DE PAGOS</h1>
        <p className="text-muted-foreground">Confirmar o rechazar pagos registrados por vendedores y choferes</p>
      </div>

      {pagos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No hay pagos pendientes de revisión</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {pagos.map((pago) => (
            <Card key={pago.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>
                      {pago.clientes?.nombre || pago.clientes?.razon_social || "Cliente desconocido"}
                    </CardTitle>
                    <CardDescription>
                      Registrado por: {pago.vendedor?.nombre || "Sin vendedor"} • Fecha:{" "}
                      {new Date(pago.fecha_pago).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">Pendiente</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm text-muted-foreground">Monto Total</Label>
                    <p className="text-2xl font-bold">${Number(pago.monto).toFixed(2)}</p>
                  </div>
                  <div>
                    <Label className="text-sm text-muted-foreground">Formas de Pago</Label>
                    <div className="space-y-1 mt-1">
                      {pago.detalles?.map((det: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <DollarSign className="h-4 w-4 text-green-600" />
                          <span className="capitalize">{det.tipo_pago}</span>
                          <span className="font-semibold">${Number(det.monto).toFixed(2)}</span>
                          {det.numero_cheque && <span className="text-muted-foreground">• Ch. {det.numero_cheque}</span>}
                          {det.banco && <span className="text-muted-foreground">• {det.banco}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {pago.observaciones && (
                  <div>
                    <Label className="text-sm text-muted-foreground">Observaciones</Label>
                    <p className="text-sm mt-1">{pago.observaciones}</p>
                  </div>
                )}

                <div className="border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cargarComprobantes(pago.cliente_id)}
                    className="mb-3"
                  >
                    Imputar a Comprobantes
                  </Button>

                  {comprobantes.length > 0 && (
                    <div className="space-y-2 bg-muted p-4 rounded-lg">
                      <Label className="font-semibold">Comprobantes Pendientes</Label>
                      {comprobantes.map((comp) => (
                        <div key={comp.id} className="flex items-center gap-4 p-2 bg-background rounded">
                          <div className="flex-1">
                            <p className="text-sm font-semibold">{comp.numero_comprobante}</p>
                            <p className="text-xs text-muted-foreground">
                              Saldo: ${Number(comp.saldo_pendiente).toFixed(2)}
                            </p>
                          </div>
                          <Input
                            type="number"
                            placeholder="Monto a imputar"
                            className="w-32"
                            value={imputaciones[comp.id] || ""}
                            onChange={(e) =>
                              setImputaciones({ ...imputaciones, [comp.id]: Number(e.target.value) || 0 })
                            }
                            max={comp.saldo_pendiente}
                          />
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="text-sm font-semibold">Total Imputado:</span>
                        <span className="text-lg font-bold">${getTotalImputado().toFixed(2)}</span>
                      </div>
                      {getTotalImputado() > Number(pago.monto) && (
                        <p className="text-sm text-red-600">El monto imputado supera el total del pago</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-4 pt-4 border-t">
                  <div className="flex-1">
                    <Label htmlFor={`motivo-${pago.id}`} className="text-sm mb-2 block">
                      Motivo de rechazo (opcional)
                    </Label>
                    <Textarea
                      id={`motivo-${pago.id}`}
                      placeholder="Ej: El cheque no coincide con el registrado..."
                      value={motivoRechazo}
                      onChange={(e) => setMotivoRechazo(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => confirmarPago(pago.id)}
                    disabled={procesando === pago.id || getTotalImputado() > Number(pago.monto)}
                    className="flex-1"
                  >
                    {procesando === pago.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Confirmar Pago
                  </Button>
                  <Button onClick={() => rechazarPago(pago.id)} disabled={procesando === pago.id} variant="destructive">
                    {procesando === pago.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Rechazar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

