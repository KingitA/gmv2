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
import { Loader2, FileText, RotateCcw, Upload, ExternalLink, AlertCircle, Ban, Plus, X } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
  const [dtosHechos, setDtosHechos] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const [ocrProcesando, setOcrProcesando] = useState(false)
  const [aplicarContado, setAplicarContado] = useState(false)
  const [activeTab, setActiveTab] = useState("nuevo")

  // ── Multi-cliente (caso "Tandil"): clientes adicionales en la misma cobranza ──
  const [clientesExtra, setClientesExtra] = useState<Array<{ cliente: Cliente; seleccionados: Record<string, number> }>>([])
  const [mostrarBuscarExtra, setMostrarBuscarExtra] = useState(false)
  const esMulti = clientesExtra.length > 0

  // ── Historial ──
  const [historial, setHistorial] = useState<PagoHistorial[]>([])
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [historialCargado, setHistorialCargado] = useState(false)

  // ── Post-guardado ──
  const [reciboGenerado, setReciboGenerado] = useState<{ pagoId: string; numero: string } | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [lastPagoId, setLastPagoId] = useState<string | null>(null)

  const [anulando, setAnulando] = useState<string | null>(null)   // pagoId que se está anulando
  const [motivoAnulacion, setMotivoAnulacion] = useState("")
  const [confirmAnularId, setConfirmAnularId] = useState<string | null>(null)

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
  // Total combinado (incluye clientes adicionales en cobranza conjunta)
  const totalExtra = clientesExtra.reduce((s, c) => s + Object.values(c.seleccionados).reduce((a, v) => a + v, 0), 0)
  const totalSeleccionadoUI = totalComprobantes + totalExtra
  // Solo efectivo → se confirma en el acto (mostrador). Cheque/transferencia/depósito → pendiente de verificación.
  const soloEfectivo = metodos.length > 0 && metodos.every((m) => m.tipo === "efectivo")

  const resetForm = () => {
    setCliente(null)
    setSeleccionados({})
    setMetodos([])
    setRetenciones([])
    setPagoACuenta(false)
    setReciboGenerado(null)
    setAplicarContado(false)
    setComprobantesData([])
    setDtosHechos(new Set())
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

  // Cobranza multi-cliente: arma una cobranza (/api/cobranzas) repartiendo los
  // métodos por la porción de cada cliente (cheque único = compartido).
  const handleGuardarMulti = async (confirmar: boolean) => {
    if (!cliente) { toast.error("Seleccioná el cliente principal"); return }
    if (metodos.length === 0) { toast.error("Agregá al menos un método de pago"); return }

    const clientes = [
      { cliente_id: cliente.id, seleccionados },
      ...clientesExtra.map((c) => ({ cliente_id: c.cliente.id, seleccionados: c.seleccionados })),
    ]
      .map((c) => ({
        cliente_id: c.cliente_id,
        imputaciones: Object.entries(c.seleccionados).map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado })),
        portion: Object.values(c.seleccionados).reduce((a, v) => a + v, 0),
      }))
      .filter((c) => c.portion > 0)

    if (clientes.length === 0) { toast.error("Seleccioná comprobantes a afectar"); return }
    if (metodos.filter((m) => m.tipo === "cheque").length > 1) {
      toast.error("En cobranza multi-cliente usá un solo cheque (compartido)"); return
    }

    const montoMetodo = (m: any) => m.tipo === "deposito"
      ? (m.items || []).reduce((a: number, it: any) => a + Number(it.monto), 0) : Number(m.monto)
    const totalSel = clientes.reduce((s, c) => s + c.portion, 0)
    const totalMet = metodos.reduce((s, m) => s + montoMetodo(m), 0)
    if (Math.abs(totalSel - totalMet) > 0.5) {
      toast.error(`El total de métodos ($${totalMet.toLocaleString("es-AR")}) debe igualar lo seleccionado ($${totalSel.toLocaleString("es-AR")})`); return
    }

    const chequeMetodo = metodos.find((m) => m.tipo === "cheque") as any
    const cheque_compartido = chequeMetodo ? {
      banco: chequeMetodo.banco_emisor, numero: chequeMetodo.numero_cheque,
      fecha_cheque: chequeMetodo.fecha_cheque, monto: Number(chequeMetodo.monto),
      color: chequeMetodo.color_cheque || "BLANCO",
    } : null

    // Distribución greedy de cada método entre los clientes según su porción
    const restante: Record<string, number> = {}
    const metodosPorCliente: Record<string, any[]> = {}
    clientes.forEach((c) => { restante[c.cliente_id] = c.portion; metodosPorCliente[c.cliente_id] = [] })
    for (const m of metodos as any[]) {
      let amount = montoMetodo(m)
      for (const c of clientes) {
        if (amount <= 0.0001) break
        const take = Math.min(amount, restante[c.cliente_id])
        if (take <= 0) continue
        const met: any = { tipo: m.tipo, monto: take }
        if (m.tipo === "cheque") met.usa_cheque_compartido = true
        if (m.tipo === "transferencia") { met.numero_comprobante = m.numero_comprobante; met.cuenta_bancaria_id = m.cuenta_bancaria_id; met.fecha_transferencia = m.fecha_transferencia }
        if (m.tipo === "efectivo") met.caja_id = m.caja_id
        metodosPorCliente[c.cliente_id].push(met)
        restante[c.cliente_id] -= take
        amount -= take
      }
    }

    const asignaciones = clientes.map((c) => ({ cliente_id: c.cliente_id, imputaciones: c.imputaciones, metodos: metodosPorCliente[c.cliente_id] }))

    setGuardando(true)
    try {
      const res = await fetch("/api/cobranzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origen: "ERP", confirmar, cheque_compartido, asignaciones }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(confirmar
        ? `Cobranza confirmada: ${data.clientes?.length || 0} cliente(s), recibos generados.`
        : "Cobranza registrada como PENDIENTE de verificación.")
      setCliente(null); setClientesExtra([]); setSeleccionados({}); setMetodos([]); setRetenciones([]); setPagoACuenta(false)
      setHistorialCargado(false)
    } catch (err: any) {
      toast.error("Error: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const handleGuardar = async (confirmar: boolean = true) => {
    if (esMulti) return handleGuardarMulti(confirmar)
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
          confirmar,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const pagoId: string = data.pago.id
      const numeroRecibo: string = data.numero_recibo

      // Si quedó PENDIENTE de verificación: no hay recibo ni bonificación todavía
      if (!confirmar) {
        setLastPagoId(pagoId)
        toast.success("Pago registrado como PENDIENTE de verificación. Impactará el saldo al confirmarse.")
        setHistorialCargado(false)
        // Reset del formulario
        setMetodos([]); setSeleccionados({}); setRetenciones([]); setPagoACuenta(false)
        return
      }

      // Bonificación pago contado 10%
      if (aplicarContado && Object.keys(seleccionados).length > 0) {
        try {
          // Excluir comprobantes que ya tienen el 10% aplicado
          const comprobanteIds = Object.keys(seleccionados).filter(id => !dtosHechos.has(id))
          if (comprobanteIds.length === 0) { /* todos ya tienen dto, no hacer nada */ }
          else await fetch("/api/pagos/generar-bonificacion", {
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
      setHistorial(Array.isArray(data) ? data : [])
      setHistorialCargado(true)
    } catch {
      toast.error("Error cargando historial")
    } finally {
      setCargandoHistorial(false)
    }
  }

  const handleAnular = async () => {
    if (!confirmAnularId) return
    setAnulando(confirmAnularId)
    setConfirmAnularId(null)
    try {
      const res = await fetch(`/api/pagos-clientes/${confirmAnularId}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivoAnulacion }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Recibo anulado. Los comprobantes volvieron a estado pendiente.")
      setMotivoAnulacion("")
      // Actualizar el estado en el historial local sin recargar todo
      setHistorial(prev => prev.map(p => p.id === confirmAnularId ? { ...p, estado: "anulado" } : p))
    } catch (err: any) {
      toast.error("Error anulando: " + err.message)
    } finally {
      setAnulando(null)
    }
  }

  const calcBonificacion = (): number => {
    if (!aplicarContado) return 0
    return comprobantesData
      .filter(c => seleccionados[c.id] !== undefined && !dtosHechos.has(c.id))
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

                {/* Clientes adicionales (cobro conjunto — caso "Tandil") */}
                {cliente && !pagoACuenta && (
                  <div className="mt-3 space-y-2">
                    {clientesExtra.map((ce, idx) => (
                      <div key={ce.cliente.id} className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-semibold text-sm">{ce.cliente.razon_social || ce.cliente.nombre}</p>
                          <p className="text-xs text-muted-foreground">CUIT: {ce.cliente.cuit || "—"}</p>
                        </div>
                        <button onClick={() => setClientesExtra((prev) => prev.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {mostrarBuscarExtra ? (
                      <ClienteSearchCombobox
                        onSelect={(c) => {
                          if (!c) return
                          if (c.id === cliente.id || clientesExtra.some((e) => e.cliente.id === c.id)) {
                            toast.error("Ese cliente ya está en la cobranza"); return
                          }
                          setClientesExtra((prev) => [...prev, { cliente: c, seleccionados: {} }])
                          setMostrarBuscarExtra(false)
                        }}
                      />
                    ) : (
                      <button onClick={() => setMostrarBuscarExtra(true)} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        <Plus className="h-4 w-4" /> Agregar cliente (cobro conjunto)
                      </button>
                    )}
                  </div>
                )}
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
                    onDtosHechosLoaded={setDtosHechos}
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

              {/* 2b. Clientes adicionales (cobranza conjunta — caso "Tandil") */}
              {cliente && !pagoACuenta && (
                <>
                  {clientesExtra.map((ce, idx) => (
                    <section key={ce.cliente.id} className="border rounded-xl p-4 bg-white">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                          Cliente adicional — {ce.cliente.razon_social || ce.cliente.nombre}
                        </h2>
                        <button
                          onClick={() => setClientesExtra((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Quitar
                        </button>
                      </div>
                      <ComprobantesSelector
                        clienteId={ce.cliente.id}
                        seleccionados={ce.seleccionados}
                        onChange={(sel) => setClientesExtra((prev) => prev.map((c, i) => (i === idx ? { ...c, seleccionados: sel } : c)))}
                      />
                    </section>
                  ))}
                  {esMulti && (
                    <p className="text-xs text-amber-700 px-1">
                      Cobranza conjunta: los métodos de pago se reparten entre los clientes según lo seleccionado.
                      Si pagan con cheque, usá un solo cheque (se registra compartido).
                    </p>
                  )}
                </>
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
                totalComprobantes={totalSeleccionadoUI}
                metodos={metodos}
                retenciones={retenciones}
                bonificacion={calcBonificacion()}
              />

              {/* 10% bonificación pago contado (solo cliente único) */}
              {!esMulti && Object.keys(seleccionados).length > 0 && (
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
                onClick={() => handleGuardar(soloEfectivo)}
                disabled={guardando || !cliente || metodos.length === 0}
              >
                {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                {guardando
                  ? "Guardando..."
                  : soloEfectivo
                    ? "Cobrar (efectivo) y generar recibo"
                    : "Registrar pago (queda pendiente de verificación)"}
              </Button>

              {metodos.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  {soloEfectivo
                    ? "Pago en efectivo: se confirma en el acto e impacta el saldo."
                    : "Incluye cheque o transferencia: queda pendiente de verificación (se confirma en Historial cuando se acredite/reciba)."}
                </p>
              )}

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
                        const esAnulado = p.estado === "anulado"
                        return (
                          <tr key={p.id} className={`border-t ${esAnulado ? "bg-red-50/50 opacity-60" : "hover:bg-muted/20"}`}>
                            <td className={`p-3 ${esAnulado ? "line-through text-muted-foreground" : ""}`}>{fmtFecha(p.fecha_pago)}</td>
                            <td className={`p-3 font-mono text-xs ${esAnulado ? "line-through text-muted-foreground" : ""}`}>{recibo?.numero_recibo || "—"}</td>
                            <td className="p-3">{p.clientes?.razon_social || p.clientes?.nombre || "—"}</td>
                            <td className="p-3">
                              <div className="flex gap-1 flex-wrap">
                                {[...new Set((p.pagos_detalle || []).map((d: any) => d.tipo_pago))].map((tipo: any) => (
                                  <span key={tipo} title={tipo} className="text-lg leading-none">{tiposBadge[tipo] || "💳"}</span>
                                ))}
                              </div>
                            </td>
                            <td className={`p-3 text-right font-mono font-semibold ${esAnulado ? "line-through text-muted-foreground" : ""}`}>${fmtARS(Number(p.monto))}</td>
                            <td className="p-3 text-center">
                              <Badge
                                className={
                                  esAnulado
                                    ? "bg-red-100 text-red-700 border-0"
                                    : p.estado === "confirmado"
                                    ? "bg-green-100 text-green-700 border-0"
                                    : "bg-yellow-100 text-yellow-700 border-0"
                                }
                              >
                                {esAnulado ? "Anulado" : p.estado}
                              </Badge>
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.open(`/api/pagos-clientes/${p.id}/recibo`, "_blank")}
                                  disabled={!recibo}
                                  className="h-7"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Recibo
                                </Button>
                                {!esAnulado && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    disabled={anulando === p.id}
                                    onClick={() => { setConfirmAnularId(p.id); setMotivoAnulacion("") }}
                                  >
                                    {anulando === p.id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <Ban className="h-3.5 w-3.5 mr-1" />}
                                    Anular
                                  </Button>
                                )}
                              </div>
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

      {/* ── Confirmación anulación ── */}
      <AlertDialog open={!!confirmAnularId} onOpenChange={(open) => { if (!open) setConfirmAnularId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular recibo</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción revertirá las imputaciones y dejará los comprobantes sin saldar nuevamente.
              El recibo quedará registrado como anulado en el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-1.5">
            <Label htmlFor="motivo-anulacion" className="text-sm">Motivo (opcional)</Label>
            <Textarea
              id="motivo-anulacion"
              placeholder="Ej: Error en el monto, cheque rechazado, etc."
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              className="resize-none h-20 text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleAnular}
            >
              Anular recibo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
