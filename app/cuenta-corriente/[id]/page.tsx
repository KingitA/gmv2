"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, Plus, DollarSign, X } from "lucide-react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { nowArgentina, todayArgentina } from "@/lib/utils"

interface Comprobante {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha_comprobante: string
  fecha_vencimiento: string | null
  total_factura_declarado: number
  saldo_pendiente: number
  estado_pago: string
  orden_compra: {
    numero_orden: string
  }
}

interface Proveedor {
  id: string
  nombre: string
  cuit: string
  email: string
}

interface PagoDetalle {
  tipo_pago: "efectivo" | "cheque" | "transferencia"
  banco: string
  monto: number
  numero_cheque?: string
  fecha_cheque?: string
}

interface PagoAnticipado {
  id: string
  fecha_pago: string
  monto_total: number
  saldo_disponible: number
}

export default function CuentaCorrientePage() {
  const params = useParams()
  const proveedorId = params.id as string
  const [proveedor, setProveedor] = useState<Proveedor | null>(null)
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [comprobantesSeleccionados, setComprobantesSeleccionados] = useState<Set<string>>(new Set())
  const [mostrarModalPago, setMostrarModalPago] = useState(false)
  const [pagosDetalle, setPagosDetalle] = useState<PagoDetalle[]>([])
  const [pagosAnticipados, setPagosAnticipados] = useState<PagoAnticipado[]>([])
  const [pagoAnticipadoSeleccionado, setPagoAnticipadoSeleccionado] = useState<string>("")
  const [montoAnticipadoAUsar, setMontoAnticipadoAUsar] = useState<number>(0)
  const [fechaPago, setFechaPago] = useState(todayArgentina())
  const [observaciones, setObservaciones] = useState("")

  useEffect(() => {
    loadProveedor()
    loadComprobantes()
    loadPagosAnticipados()
  }, [proveedorId])

  async function loadProveedor() {
    const { data } = await supabase.from("proveedores").select("*").eq("id", proveedorId).single()
    if (data) setProveedor(data)
  }

  async function loadComprobantes() {
    const { data } = await supabase
      .from("comprobantes_compra")
      .select(`*, orden_compra:ordenes_compra(numero_orden)`)
      .eq("proveedor_id", proveedorId)
      .order("fecha_comprobante", { ascending: false })

    if (data) setComprobantes(data)
  }

  async function loadPagosAnticipados() {
    const { data } = await supabase
      .from("pagos_proveedores")
      .select("*")
      .eq("proveedor_id", proveedorId)
      .eq("es_pago_anticipado", true)
      .gt("monto_total", 0)
      .order("fecha_pago", { ascending: false })

    if (data) {
      const pagosConSaldo = await Promise.all(
        data.map(async (pago: any) => {
          const { data: imputaciones } = await supabase
            .from("imputaciones")
            .select("monto_imputado")
            .eq("pago_id", pago.id)

          const totalImputado = imputaciones?.reduce((sum: number, imp: any) => sum + imp.monto_imputado, 0) || 0
          const saldoDisponible = pago.monto_total - totalImputado

          return {
            id: pago.id,
            fecha_pago: pago.fecha_pago,
            monto_total: pago.monto_total,
            saldo_disponible: saldoDisponible,
          }
        }),
      )

      setPagosAnticipados(pagosConSaldo.filter((p) => p.saldo_disponible > 0))
    }
  }

  const toggleComprobante = (id: string) => {
    const newSet = new Set(comprobantesSeleccionados)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setComprobantesSeleccionados(newSet)
  }

  const getTotalSeleccionado = () => {
    return comprobantes
      .filter((c) => comprobantesSeleccionados.has(c.id))
      .reduce((sum, c) => sum + (c.saldo_pendiente || c.total_factura_declarado), 0)
  }

  const getTotalPagos = () => {
    const totalDetalle = pagosDetalle.reduce((sum, p) => sum + p.monto, 0)
    return totalDetalle + montoAnticipadoAUsar
  }

  const getSaldoRestante = () => {
    return getTotalSeleccionado() - getTotalPagos()
  }

  const agregarPagoDetalle = () => {
    setPagosDetalle([...pagosDetalle, { tipo_pago: "efectivo", banco: "", monto: 0 }])
  }

  const actualizarPagoDetalle = (index: number, campo: keyof PagoDetalle, valor: any) => {
    const nuevos = [...pagosDetalle]
    nuevos[index] = { ...nuevos[index], [campo]: valor }
    setPagosDetalle(nuevos)
  }

  const eliminarPagoDetalle = (index: number) => {
    setPagosDetalle(pagosDetalle.filter((_, i) => i !== index))
  }

  const abrirModalPago = () => {
    if (comprobantesSeleccionados.size === 0) {
      alert("Seleccioná al menos un comprobante")
      return
    }
    setMostrarModalPago(true)
  }

  const guardarImputacion = async () => {
    if (getTotalPagos() === 0) {
      alert("Ingresá al menos un pago")
      return
    }

    try {
      const { data: pago, error: errorPago } = await supabase
        .from("pagos_proveedores")
        .insert({
          proveedor_id: proveedorId,
          fecha_pago: fechaPago,
          monto_total: getTotalPagos(),
          es_pago_anticipado: false,
          observaciones: observaciones,
        })
        .select()
        .single()

      if (errorPago) throw errorPago

      if (pagosDetalle.length > 0) {
        const detalles = pagosDetalle.map((detalle) => ({
          pago_id: pago.id,
          tipo_pago: detalle.tipo_pago,
          banco: detalle.banco || null,
          monto: detalle.monto,
          numero_cheque: detalle.numero_cheque || null,
          fecha_cheque: detalle.fecha_cheque || null,
        }))

        const { error: errorDetalle } = await supabase.from("pagos_detalle").insert(detalles)
        if (errorDetalle) throw errorDetalle
      }

      if (montoAnticipadoAUsar > 0 && pagoAnticipadoSeleccionado) {
        const { error: errorAnt } = await supabase.from("pagos_detalle").insert({
          pago_id: pago.id,
          tipo_pago: "anticipado",
          banco: null,
          monto: montoAnticipadoAUsar,
        })
        if (errorAnt) throw errorAnt
      }

      const comprobantesArray = comprobantes.filter((c) => comprobantesSeleccionados.has(c.id))
      let montoRestante = getTotalPagos()

      for (const comprobante of comprobantesArray) {
        if (montoRestante <= 0) break

        const saldoComprobante = comprobante.saldo_pendiente || comprobante.total_factura_declarado
        const montoAImputar = Math.min(montoRestante, saldoComprobante)

        // Crear imputación
        const { error: errorImp } = await supabase.from("imputaciones").insert({
          pago_id: pago.id,
          comprobante_id: comprobante.id,
          monto_imputado: montoAImputar,
        })
        if (errorImp) throw errorImp

        // Actualizar saldo del comprobante
        const nuevoSaldo = saldoComprobante - montoAImputar
        const nuevoEstado = nuevoSaldo === 0 ? "pagado" : nuevoSaldo < saldoComprobante ? "parcial" : "pendiente"

        const { error: errorComp } = await supabase
          .from("comprobantes_compra")
          .update({
            saldo_pendiente: nuevoSaldo,
            estado_pago: nuevoEstado,
          })
          .eq("id", comprobante.id)

        if (errorComp) throw errorComp

        montoRestante -= montoAImputar
      }

      alert("Pago imputado exitosamente")
      setMostrarModalPago(false)
      setComprobantesSeleccionados(new Set())
      setPagosDetalle([])
      setMontoAnticipadoAUsar(0)
      setPagoAnticipadoSeleccionado("")
      setObservaciones("")
      loadComprobantes()
      loadPagosAnticipados()
    } catch (error: any) {
      console.error("[v0] Error al guardar imputación:", error)
      alert(`Error: ${error.message}`)
    }
  }

  const totalFacturado = comprobantes.reduce((sum, c) => sum + c.total_factura_declarado, 0)
  const totalPendiente = comprobantes.reduce((sum, c) => sum + (c.saldo_pendiente ?? c.total_factura_declarado), 0)
  const totalPagado = totalFacturado - totalPendiente

  const getEstadoPagoColor = (estado: string) => {
    switch (estado) {
      case "pagado":
        return "bg-green-100 text-green-800"
      case "parcial":
        return "bg-yellow-100 text-yellow-800"
      case "pendiente":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/proveedores">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Cuenta Corriente</h1>
            {proveedor && (
              <p className="text-sm text-muted-foreground">
                {proveedor.nombre} - CUIT: {proveedor.cuit}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:grid-cols-4 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Comprobantes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{comprobantes.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Facturado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalFacturado.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total Pagado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">${totalPagado.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Saldo Pendiente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">${totalPendiente.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Comprobantes</CardTitle>
              <Button onClick={abrirModalPago} disabled={comprobantesSeleccionados.size === 0}>
                <DollarSign className="h-4 w-4 mr-2" />
                Imputar Pago ({comprobantesSeleccionados.size})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Orden</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Saldo Pendiente</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comprobantes.map((comprobante) => {
                  const saldo = comprobante.saldo_pendiente ?? comprobante.total_factura_declarado
                  const estaPago = saldo === 0

                  return (
                    <TableRow key={comprobante.id} className={estaPago ? "opacity-50" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={comprobantesSeleccionados.has(comprobante.id)}
                          onCheckedChange={() => toggleComprobante(comprobante.id)}
                          disabled={estaPago}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{comprobante.orden_compra?.numero_orden}</TableCell>
                      <TableCell>{comprobante.tipo_comprobante}</TableCell>
                      <TableCell>{comprobante.numero_comprobante}</TableCell>
                      <TableCell>{new Date(comprobante.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                      <TableCell>
                        {comprobante.fecha_vencimiento
                          ? new Date(comprobante.fecha_vencimiento).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">${comprobante.total_factura_declarado.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${saldo.toFixed(2)}</TableCell>
                      <TableCell>
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${getEstadoPagoColor(comprobante.estado_pago || "pendiente")}`}
                        >
                          {comprobante.estado_pago || "pendiente"}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>

      <Dialog open={mostrarModalPago} onOpenChange={setMostrarModalPago}>
        <DialogContent className="w-[90vw] max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Imputar Pago</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Comprobantes seleccionados */}
            <div>
              <h3 className="font-semibold mb-2">Comprobantes a Saldar</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Saldo Pendiente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comprobantes
                    .filter((c) => comprobantesSeleccionados.has(c.id))
                    .map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.numero_comprobante}</TableCell>
                        <TableCell>{new Date(c.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                        <TableCell className="text-right">
                          ${(c.saldo_pendiente ?? c.total_factura_declarado).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <div className="flex justify-between mt-2 text-lg font-semibold">
                <span>Total a Saldar:</span>
                <span>${getTotalSeleccionado().toFixed(2)}</span>
              </div>
            </div>

            {/* Fecha de pago */}
            <div>
              <Label>Fecha de Pago</Label>
              <Input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
            </div>

            {/* Pagos anticipados disponibles */}
            {pagosAnticipados.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Pagos Anticipados Disponibles</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Seleccionar Pago Anticipado</Label>
                    <Select value={pagoAnticipadoSeleccionado} onValueChange={setPagoAnticipadoSeleccionado}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pagosAnticipados.map((pa) => (
                          <SelectItem key={pa.id} value={pa.id}>
                            {new Date(pa.fecha_pago).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} - Saldo: ${pa.saldo_disponible.toFixed(2)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Monto a Usar</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={montoAnticipadoAUsar}
                      onChange={(e) => setMontoAnticipadoAUsar(Number.parseFloat(e.target.value) || 0)}
                      disabled={!pagoAnticipadoSeleccionado}
                      max={pagosAnticipados.find((p) => p.id === pagoAnticipadoSeleccionado)?.saldo_disponible || 0}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Agregar pagos */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Pagos</h3>
                <Button variant="outline" size="sm" onClick={agregarPagoDetalle}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Pago
                </Button>
              </div>

              <div className="space-y-3">
                {pagosDetalle.map((pago, index) => (
                  <Card key={`pago-${index}-${pago.tipo_pago}-${pago.monto}`}>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-3">
                          <Label>Tipo de Pago</Label>
                          <Select
                            value={pago.tipo_pago}
                            onValueChange={(v: any) => actualizarPagoDetalle(index, "tipo_pago", v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="efectivo">Efectivo</SelectItem>
                              <SelectItem value="cheque">Cheque</SelectItem>
                              <SelectItem value="transferencia">Transferencia</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {(pago.tipo_pago === "transferencia" || pago.tipo_pago === "cheque") && (
                          <div className="col-span-3">
                            <Label>Banco</Label>
                            <Input
                              value={pago.banco}
                              onChange={(e) => actualizarPagoDetalle(index, "banco", e.target.value)}
                              placeholder="Ej: Nación, Credicoop"
                            />
                          </div>
                        )}

                        <div className="col-span-2">
                          <Label>Monto</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={pago.monto}
                            onChange={(e) =>
                              actualizarPagoDetalle(index, "monto", Number.parseFloat(e.target.value) || 0)
                            }
                          />
                        </div>

                        {pago.tipo_pago === "cheque" && (
                          <>
                            <div className="col-span-2">
                              <Label>Nº Cheque</Label>
                              <Input
                                value={pago.numero_cheque || ""}
                                onChange={(e) => actualizarPagoDetalle(index, "numero_cheque", e.target.value)}
                              />
                            </div>
                            <div className="col-span-2">
                              <Label>Fecha Cheque</Label>
                              <Input
                                type="date"
                                value={pago.fecha_cheque || ""}
                                onChange={(e) => actualizarPagoDetalle(index, "fecha_cheque", e.target.value)}
                              />
                            </div>
                          </>
                        )}

                        <div className="col-span-1 flex items-end">
                          <Button variant="ghost" size="icon" onClick={() => eliminarPagoDetalle(index)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Observaciones */}
            <div>
              <Label>Observaciones</Label>
              <Input
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Observaciones adicionales..."
              />
            </div>

            {/* Resumen */}
            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between">
                <span>Total a Saldar:</span>
                <span className="font-semibold">${getTotalSeleccionado().toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Pagos Ingresados:</span>
                <span className="font-semibold">${getTotalPagos().toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Saldo Restante:</span>
                <span className={getSaldoRestante() < 0 ? "text-red-600" : "text-green-600"}>
                  ${getSaldoRestante().toFixed(2)}
                </span>
              </div>

              {getSaldoRestante() < 0 && (
                <Alert>
                  <AlertDescription>
                    El monto de los pagos supera el total a saldar. El excedente se guardará como pago anticipado.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Botones */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMostrarModalPago(false)}>
                Cancelar
              </Button>
              <Button onClick={guardarImputacion}>Guardar Imputación</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
