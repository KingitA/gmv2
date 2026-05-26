"use client"

import { useRef, useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2, FileText, RotateCcw, Upload, ExternalLink, AlertCircle } from "lucide-react"
import { ClienteSearchCombobox } from "@/components/pagos/ClienteSearchCombobox"
import { ComprobantesSelector, type Comprobante } from "@/components/pagos/ComprobantesSelector"
import { MetodoPagoForm, type MetodoPago } from "@/components/pagos/MetodoPagoForm"
import { RetencionForm, type Retencion } from "@/components/pagos/RetencionForm"
import { ResumenPago } from "@/components/pagos/ResumenPago"

interface Cliente {
  id: string
  nombre: string
  razon_social: string | null
  cuit: string | null
  codigo_cliente: string | null
}

interface PagoHistorial {
  id: string
  fecha_pago: string
  monto: number
  estado: string
  recibos: { numero_recibo: string; pdf_url: string | null } | null
  clientes: { nombre: string; razon_social: string | null } | null
  pagos_detalle: any[]
  imputaciones: any[]
  retenciones: any[]
}

function genId() { return Math.random().toString(36).slice(2) }
const fmtARS = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2 })
const fmtFecha = (d: string) => new Date(d).toLocaleDateString("es-AR")

function PagosClientesContent() {
  // ── Formulario ──
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [seleccionados, setSeleccionados] = useState<Record<string, number>>({})
  const [metodos, setMetodos] = useState<MetodoPago[]>([])
  const [retenciones, setRetenciones] = useState<Retencion[]>([])
  const [pagoACuenta, setPagoACuenta] = useState(false)
  const [comprobantesData, setComprobantesData] = useState<Comprobante[]>([])
  const [guardando, setGuardando] = useState(false)
  const [ocrProcesando, setOcrProcesando] = useState(false)
  const [aplicarContado, setAplicarContado] = useState(false)
  const [activeTab, setActiveTab] = useState("nuevo")

  // ── Historial ──
  const [historial, setHistorial] = useState<PagoHistorial[]>([])
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [historialCargado, setHistorialCargado] = useState(false)

  // ── Post-guardado ──
  const [reciboGenerado, setReciboGenerado] = useState<{ pagoId: string; numero: string } | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [lastPagoId, setLastPagoId] = useState<string | null>(null)

  const ocrFileRef = useRef<HTMLInputElement>(null)
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Pre-load client from URL param (e.g. coming from cuenta-corriente)
  useEffect(() => {
    const id = searchParams.get("cliente_id")
    if (!id || cliente) return
    supabase
      .from("clientes")
      .select("id, nombre, razon_social, cuit, codigo_cliente")
      .eq("id", id)
      .single()
      .then(({ data }) => { if (data) setCliente(data) })
  }, [searchParams])

  const totalComprobantes = Object.values(seleccionados).reduce((s, v) => s + v, 0)

  const resetForm = () => {
    setCliente(null)
    setSeleccionados({})
    setMetodos([])
    setRetenciones([])
    setPagoACuenta(false)
    setReciboGenerado(null)
    setAplicarContado(false)
    setComprobantesData([])
  }

  const handleOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setOcrProcesando(true)
    try {
      const formData = new FormData()
      files.forEach((f) => formData.append("files", f))
      const res = await fetch("/api/pagos-clientes/ocr", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const resultados: any[] = data.resultados || []
      if (resultados.length === 0) {
        toast.warning("No se detectaron comprobantes en las imágenes")
        return
      }

      const nuevosMetodos: MetodoPago[] = resultados.map((r: any) => {
        const base = { id: genId(), tipo: r.tipo, monto: r.monto || 0 }
        if (r.tipo === "cheque") return {
          ...base,
          numero_cheque: r.numero_cheque || "",
          banco_emisor: r.banco_emisor || "",
          fecha_emision: r.fecha_emision || "",
          fecha_cheque: r.fecha_cheque || "",
          cuit_emisor: r.cuit_emisor || "",
          localidad: r.localidad || "",
          color_cheque: r.color_cheque || "BLANCO",
        }
        if (r.tipo === "transferencia") return {
          ...base,
          cuenta_bancaria_id: r.cuenta_bancaria_id || "",
          fecha_transferencia: r.fecha_transferencia || "",
          numero_comprobante: r.numero_comprobante || "",
        }
        if (r.tipo === "deposito") return {
          ...base,
          cuenta_bancaria_id: r.cuenta_bancaria_id || "",
          fecha_deposito: r.fecha_deposito || "",
          items: (r.items || []).map((it: any) => ({ ...it, id: genId() })),
        }
        return base
      })

      setMetodos((prev) => [...prev, ...nuevosMetodos])
      toast.success(`${resultados.length} comprobante(s) detectado(s) y agregado(s) al formulario`)
    } catch (err: any) {
      toast.error("Error procesando OCR: " + err.message)
    } finally {
      setOcrProcesando(false)
      e.target.value = ""
    }
  }

  const handleGuardar = async () => {
    if (!cliente) { toast.error("Seleccioná un cliente"); return }
    if (metodos.length === 0) { toast.error("Agregá al menos un método de pago"); return }

    const imputaciones = pagoACuenta ? [] : Object.entries(seleccionados).map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado }))

    setGuardando(true)
    try {
      const res = await fetch("/api/pagos-clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: cliente.id,
          fecha_pago: new Date().toISOString().slice(0, 10),
          metodos: metodos.map((m) => ({
            tipo: m.tipo,
            monto: m.monto,
            caja_id: m.caja_id,
            cuenta_bancaria_id: m.cuenta_bancaria_id,
            fecha_transferencia: m.fecha_transferencia,
            numero_comprobante: m.numero_comprobante,
            numero_cheque: m.numero_cheque,
            banco_emisor: m.banco_emisor,
            fecha_emision: m.fecha_emision,
            fecha_cheque: m.fecha_cheque,
            localidad: m.localidad,
            cuit_emisor: m.cuit_emisor,
            color_cheque: m.color_cheque,
            fecha_deposito: m.fecha_deposito,
            items: m.items,
          })),
          imputaciones,
          retenciones: retenciones.map((r) => ({
            tipo: r.tipo,
            fecha: r.fecha,
            numero_comprobante: r.numero_comprobante,
            monto: r.monto,
            origen: r.origen,
          })),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const pagoId: string = data.pago.id
      const numeroRecibo: string = data.numero_recibo

      // Bonificación pago contado 10%
      if (aplicarContado && Object.keys(seleccionados).length > 0) {
        try {
          const comprobanteIds = Object.keys(seleccionados)
          await fetch("/api/pagos/generar-bonificacion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cliente_id: cliente!.id, comprobante_ids: comprobanteIds, pago_id: pagoId }),
          })
        } catch { /* no bloqueamos el flujo */ }
      }

      setReciboGenerado({ pagoId, numero: numeroRecibo })
      setLastPagoId(pagoId)
      setShowSuccess(true)
      toast.success(`Recibo ${numeroRecibo} generado correctamente`)
      setHistorialCargado(false)
    } catch (err: any) {
      toast.error("Error guardando pago: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const loadHistorial = async () => {
    setCargandoHistorial(true)
    try {
      const res = await fetch("/api/pagos-clientes")
      const data = await res.json()
      setHistorial(data || [])
      setHistorialCargado(true)
    } catch {
      toast.error("Error cargando historial")
    } finally {
      setCargandoHistorial(false)
    }
  }

  const calcBonificacion = (): number => {
    if (!aplicarContado) return 0
    return comprobantesData
      .filter(c => seleccionados[c.id] !== undefined)
      .reduce((sum, c) => {
        if (c.tipo_comprobante === "PRES") {
          return sum + Math.abs(Number(c.total_factura)) * 0.1
        }
        if (["FA", "FB", "FC"].includes(c.tipo_comprobante)) {
          const neto = Math.abs(Number(c.total_neto) || 0)
          const bonif = neto * 0.1
          return sum + bonif + bonif * 0.21
        }
        return sum
      }, 0)
  }

  const tiposBadge: Record<string, string> = {
    efectivo: "💵",
    transferencia: "🏦",
    cheque: "📄",
    deposito: "🏧",
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pagos de Clientes</h1>
        <p className="text-sm text-muted-foreground">Registrá cobros, imputá comprobantes y generá recibos</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="nuevo">Nuevo Pago</TabsTrigger>
          <TabsTrigger value="historial" onClick={() => !historialCargado && loadHistorial()}>
            Historial
          </TabsTrigger>
        </TabsList>

        {/* ════ TAB NUEVO PAGO ════ */}
        <TabsContent value="nuevo">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna principal */}
            <div className="lg:col-span-2 space-y-6">

              {/* 1. Cliente */}
              <section className="border rounded-xl p-4 bg-white">
                <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">1. Cliente</h2>
                <ClienteSearchCombobox value={cliente} onSelect={setCliente} />
              </section>

              {/* 2. Comprobantes */}
              {cliente && !pagoACuenta && (
                <section className="border rounded-xl p-4 bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">2. Comprobantes a afectar</h2>
                    <button
                      onClick={() => { setPagoACuenta(true); setSeleccionados({}) }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Pago a cuenta (sin imputar)
                    </button>
                  </div>
                  <ComprobantesSelector
                    clienteId={cliente.id}
                    seleccionados={seleccionados}
                    onChange={setSeleccionados}
                    onComprobantesLoaded={setComprobantesData}
                  />
                </section>
              )}

              {cliente && pagoACuenta && (
                <section className="border rounded-xl p-4 bg-amber-50 border-amber-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm font-medium">Pago a cuenta — no se imputará a ningún comprobante</span>
                    </div>
                    <button onClick={() => setPagoACuenta(false)} className="text-xs text-blue-600 hover:underline">
                      Imputar a comprobantes
                    </button>
                  </div>
                </section>
              )}

              {/* 3. Métodos de pago */}
              <section className="border rounded-xl p-4 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">3. Métodos de pago</h2>
                  <div className="flex items-center gap-2">
                    <input
                      ref={ocrFileRef}
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      className="hidden"
                      onChange={handleOCR}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => ocrFileRef.current?.click()}
                      disabled={ocrProcesando}
                    >
                      {ocrProcesando
                        ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        : <Upload className="h-4 w-4 mr-1" />}
                      {ocrProcesando ? "Procesando..." : "Subir foto / comprobante"}
                    </Button>
                  </div>
                </div>
                <MetodoPagoForm metodos={metodos} onChange={setMetodos} />
              </section>

              {/* 4. Retenciones */}
              <section className="border rounded-xl p-4 bg-white">
                <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">4. Retenciones (opcional)</h2>
                <RetencionForm retenciones={retenciones} onChange={setRetenciones} />
              </section>
            </div>

            {/* Columna derecha: resumen */}
            <div className="space-y-4">
              <ResumenPago
                totalComprobantes={totalComprobantes}
                metodos={metodos}
                retenciones={retenciones}
                bonificacion={calcBonificacion()}
              />

              {/* 10% bonificación pago contado */}
              {Object.keys(seleccionados).length > 0 && (
                <div
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${aplicarContado ? "bg-amber-50 border-amber-300" : "bg-muted/30 border-border"}`}
                  onClick={() => setAplicarContado((v) => !v)}
                >
                  <Checkbox checked={aplicarContado} onCheckedChange={(v) => setAplicarContado(!!v)} className="mt-0.5" />
                  <div className="flex-1 select-none">
                    <p className="text-sm font-medium">10% descuento pago contado</p>
                    <p className="text-xs text-muted-foreground">Genera NC automática por cada comprobante seleccionado</p>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleGuardar}
                disabled={guardando || !cliente || metodos.length === 0}
              >
                {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                {guardando ? "Guardando..." : "Cerrar Pago y Generar Recibo"}
              </Button>

              {(Object.keys(seleccionados).length === 0 && !pagoACuenta && cliente) && (
                <p className="text-xs text-muted-foreground text-center">
                  No seleccionaste comprobantes. El pago quedará como pago a cuenta.
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ════ TAB HISTORIAL ════ */}
        <TabsContent value="historial">
          {cargandoHistorial ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">{historial.length} pagos registrados</p>
                <Button variant="ghost" size="sm" onClick={loadHistorial}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Actualizar
                </Button>
              </div>

              {historial.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No hay pagos registrados</div>
              ) : (
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left">Fecha</th>
                        <th className="p-3 text-left">Recibo</th>
                        <th className="p-3 text-left">Cliente</th>
                        <th className="p-3 text-left">Métodos</th>
                        <th className="p-3 text-right">Monto</th>
                        <th className="p-3 text-center">Estado</th>
                        <th className="p-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((p) => {
                        const recibo = Array.isArray(p.recibos) ? p.recibos[0] : p.recibos
                        return (
                          <tr key={p.id} className="border-t hover:bg-muted/20">
                            <td className="p-3">{fmtFecha(p.fecha_pago)}</td>
                            <td className="p-3 font-mono text-xs">{recibo?.numero_recibo || "—"}</td>
                            <td className="p-3">{p.clientes?.razon_social || p.clientes?.nombre || "—"}</td>
                            <td className="p-3">
                              <div className="flex gap-1 flex-wrap">
                                {[...new Set((p.pagos_detalle || []).map((d: any) => d.tipo_pago))].map((tipo: any) => (
                                  <span key={tipo} title={tipo} className="text-lg leading-none">{tiposBadge[tipo] || "💳"}</span>
                                ))}
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono font-semibold">${fmtARS(Number(p.monto))}</td>
                            <td className="p-3 text-center">
                              <Badge
                                className={p.estado === "confirmado"
                                  ? "bg-green-100 text-green-700 border-0"
                                  : "bg-yellow-100 text-yellow-700 border-0"}
                              >
                                {p.estado}
                              </Badge>
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open(`/api/pagos-clientes/${p.id}/recibo`, "_blank")}
                                disabled={!recibo}
                                className="h-7"
                              >
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Recibo
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Modal éxito ── */}
      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pago registrado</DialogTitle>
          </DialogHeader>
          <div className="text-center py-4 space-y-4">
            <div className="text-5xl">✅</div>
            <div>
              <p className="font-semibold text-lg">{reciboGenerado?.numero}</p>
              <p className="text-sm text-muted-foreground">Recibo generado correctamente</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => window.open(`/api/pagos-clientes/${reciboGenerado?.pagoId}/recibo`, "_blank")}
                className="w-full"
              >
                <FileText className="h-4 w-4 mr-2" /> Ver / Imprimir Recibo
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setShowSuccess(false)
                  resetForm()
                  setActiveTab("historial")
                  if (!historialCargado) loadHistorial()
                }}
              >
                Ver Historial
              </Button>
              <Button
                variant="ghost"
                className="w-full text-sm"
                onClick={() => { setShowSuccess(false); resetForm() }}
              >
                Nuevo Pago
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function PagosClientesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Cargando...</div>}>
      <PagosClientesContent />
    </Suspense>
  )
}
