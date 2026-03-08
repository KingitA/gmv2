"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CheckCircle, XCircle, Loader2, Package } from 'lucide-react'
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle } from 'lucide-react'
import { nowArgentina, todayArgentina } from "@/lib/utils"

export default function RevisionDevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState("")
  const [motivosRechazo, setMotivosRechazo] = useState<Record<string, string>>({})
  const { toast } = useToast()

  useEffect(() => {
    cargarDevoluciones()
  }, [])

  async function cargarDevoluciones() {
    try {
      const response = await fetch("/api/devoluciones?estado=pendiente")
      const data = await response.json()
      setDevoluciones(data || [])
    } catch (error) {
      console.error("[v0] Error cargando devoluciones:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar las devoluciones pendientes",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  async function confirmarDevolucion(devolucionId: string) {
    setProcesando(devolucionId)
    try {
      const response = await fetch(`/api/devoluciones/${devolucionId}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_confirmador: "admin", // TODO: obtener del usuario actual
          accion: "confirmar",
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error)

      toast({ title: "Éxito", description: "Devolución confirmada y stock actualizado" })
      cargarDevoluciones()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setProcesando(null)
    }
  }

  async function rechazarDevolucion(devolucionId: string) {
    const motivo = motivosRechazo[devolucionId]

    if (!motivo || !motivo.trim()) {
      toast({ title: "Error", description: "Debe ingresar un motivo de rechazo", variant: "destructive" })
      return
    }

    setProcesando(devolucionId)
    try {
      const devolucion = devoluciones.find(d => d.id === devolucionId)

      const response = await fetch(`/api/devoluciones/${devolucionId}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_confirmador: "admin", // TODO: obtener del usuario actual
          accion: "rechazar",
          motivo_rechazo: motivo,
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error)

      if (devolucion) {
        await fetch("/api/cuenta-corriente/ajuste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: devolucion.cliente_id,
            tipo_comprobante: "Ajuste",
            numero_comprobante: `AJUSTE-DEV-${devolucionId.slice(0, 8)}`,
            concepto: "Error de devolución",
            descripcion: `Se descontó incorrectamente $${devolucion.monto_total.toFixed(2)} por devolución rechazada. Motivo: ${motivo}`,
            monto: devolucion.monto_total,
            tipo_movimiento: "debe", // Suma a lo que debe el cliente
          }),
        })
      }

      toast({ title: "Éxito", description: "Devolución rechazada y ajuste creado en cuenta corriente" })
      setMotivosRechazo(prev => {
        const nuevo = { ...prev }
        delete nuevo[devolucionId]
        return nuevo
      })
      cargarDevoluciones()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setProcesando(null)
    }
  }

  async function confirmarDevolucionConComprobante(devolucionId: string, tipoComprobante: "NC" | "Reversa") {
    setProcesando(devolucionId)
    try {
      const devolucion = devoluciones.find(d => d.id === devolucionId)

      const response = await fetch(`/api/devoluciones/${devolucionId}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_confirmador: "admin", // TODO: obtener usuario actual
          accion: "confirmar",
          tipo_comprobante: tipoComprobante,
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error)

      if (devolucion) {
        // Generar número de comprobante
        const numeroComprobante = `${tipoComprobante}-${new Date().getFullYear()}-${devolucionId.slice(0, 8)}`

        // Crear comprobante de venta
        await fetch("/api/comprobantes-venta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: devolucion.cliente_id,
            tipo_comprobante: tipoComprobante,
            numero_comprobante: numeroComprobante,
            fecha_emision: todayArgentina(),
            total: devolucion.monto_total,
            estado_pago: "pagado", // La NC/Reversa se descuenta directamente
            observaciones: `Generado por devolución ${devolucionId}`,
            items: devolucion.items.map((item: any) => ({
              articulo_id: item.articulo_id,
              cantidad: item.cantidad,
              precio_unitario: item.precio_venta_original,
              subtotal: item.cantidad * item.precio_venta_original,
            })),
          }),
        })

        // Ajustar cuenta corriente (resta lo que debe el cliente)
        await fetch("/api/cuenta-corriente/ajuste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: devolucion.cliente_id,
            tipo_comprobante: tipoComprobante,
            numero_comprobante: numeroComprobante,
            concepto: "Devolución de mercadería",
            descripcion: `${tipoComprobante} por devolución confirmada`,
            monto: devolucion.monto_total,
            tipo_movimiento: "haber", // Resta lo que debe el cliente
          }),
        })
      }

      toast({ title: "Éxito", description: `Devolución confirmada. ${tipoComprobante} generada y stock actualizado` })
      cargarDevoluciones()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setProcesando(null)
    }
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
        <h1 className="text-3xl font-bold mb-2">REVISIÓN DE DEVOLUCIONES</h1>
        <p className="text-muted-foreground">Confirmar o rechazar devoluciones registradas por vendedores y choferes</p>
      </div>

      {devoluciones.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No hay devoluciones pendientes de revisión</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {devoluciones.map((dev) => (
            <Card key={dev.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{dev.clientes?.nombre || dev.clientes?.razon_social || "Cliente desconocido"}</CardTitle>
                    <CardDescription>
                      Registrado por: {dev.vendedor?.nombre || "Sin vendedor"} • Fecha:{" "}
                      {new Date(dev.created_at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="secondary">Pendiente</Badge>
                    {dev.retira_viajante && <Badge variant="outline">Retiró mercadería</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-2 block">Artículos a devolver</Label>
                  <div className="space-y-2">
                    {dev.items?.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-3 p-3 border rounded-lg">
                        <Package className="h-5 w-5 text-muted-foreground mt-1" />
                        <div className="flex-1">
                          <p className="font-semibold">{item.articulos?.nombre || "Artículo desconocido"}</p>
                          <p className="text-sm text-muted-foreground">Código: {item.articulos?.codigo}</p>
                          <div className="flex gap-4 mt-2 text-sm">
                            <span>Cantidad: {item.cantidad}</span>
                            <span>Precio: ${Number(item.precio_venta_original).toFixed(2)}</span>
                            <span className="font-semibold">
                              Subtotal: ${(item.cantidad * Number(item.precio_venta_original)).toFixed(2)}
                            </span>
                          </div>
                          {item.fecha_venta_original && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Fecha venta original: {new Date(item.fecha_venta_original).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <span className="font-semibold">Monto Total</span>
                  <span className="text-2xl font-bold">${Number(dev.monto_total).toFixed(2)}</span>
                </div>

                {dev.observaciones && (
                  <div>
                    <Label className="text-sm text-muted-foreground">Observaciones</Label>
                    <p className="text-sm mt-1">{dev.observaciones}</p>
                  </div>
                )}

                <div className="flex gap-4 pt-4 border-t">
                  <div className="flex-1">
                    <Label htmlFor={`motivo-${dev.id}`} className="text-sm mb-2 block">
                      Motivo de rechazo (opcional)
                    </Label>
                    <Textarea
                      id={`motivo-${dev.id}`}
                      placeholder="Ej: La mercadería no coincide con lo declarado..."
                      value={motivosRechazo[dev.id] || ""}
                      onChange={(e) => setMotivosRechazo(prev => ({ ...prev, [dev.id]: e.target.value }))}
                      rows={2}
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => confirmarDevolucionConComprobante(dev.id, "NC")}
                    disabled={procesando === dev.id}
                    className="flex-1"
                    variant="default"
                  >
                    {procesando === dev.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Confirmar con Nota de Crédito
                  </Button>

                  <Button
                    onClick={() => confirmarDevolucionConComprobante(dev.id, "Reversa")}
                    disabled={procesando === dev.id}
                    className="flex-1"
                    variant="secondary"
                  >
                    {procesando === dev.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Confirmar con Reversa
                  </Button>

                  <Button
                    onClick={() => rechazarDevolucion(dev.id)}
                    disabled={procesando === dev.id}
                    variant="destructive"
                  >
                    {procesando === dev.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Rechazar
                  </Button>
                </div>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Importante</AlertTitle>
                  <AlertDescription>
                    <strong>Confirmar:</strong> Genera NC o Reversa, devuelve stock y ajusta cuenta corriente.<br />
                    <strong>Rechazar:</strong> Crea un ajuste por "error de devolución" sumando el monto a la deuda del cliente.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}


