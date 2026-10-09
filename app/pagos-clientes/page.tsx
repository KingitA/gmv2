"use client"
import { formatDateAR } from "@/lib/utils"

import { useRef, useState, useEffect, Suspense, type ReactNode, type ComponentType } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useUrlParams } from "@/lib/hooks/use-url-state"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2, FileText, RotateCcw, Upload, ExternalLink, AlertCircle, Ban, Plus, X, CheckCircle, Banknote, Landmark, Building2, CreditCard, Paperclip, Camera } from "lucide-react"
import { CargaProgreso } from "@/components/ui/carga-progreso"
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
import { ComprobantesSelector, type Comprobante, type ModoPedidos, type ResumenCuenta } from "@/components/pagos/ComprobantesSelector"
import { MARCA_CONTADO } from "@/lib/constants"
import { MetodoPagoForm, type MetodoPago } from "@/components/pagos/MetodoPagoForm"
import { DialogoFalta, DialogoSobra } from "@/components/pagos/DialogoDiferencia"
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
const fmtFecha = (d: string) => formatDateAR(d)

function PagosClientesContent() {
  // ── Formulario ──
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [seleccionados, setSeleccionados] = useState<Record<string, number>>({})
  const [metodos, setMetodos] = useState<MetodoPago[]>([])
  const [retenciones, setRetenciones] = useState<Retencion[]>([])
  const [pagoACuenta, setPagoACuenta] = useState(false)
  const [comprobantesData, setComprobantesData] = useState<Comprobante[]>([])
  const [modoPedidos, setModoPedidos] = useState<ModoPedidos>("todos")
  const [resumenCuenta, setResumenCuenta] = useState<ResumenCuenta | null>(null)
  const [dtosHechos, setDtosHechos] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  // Clave de idempotencia: estable ante doble click/reintento, rota al éxito
  const idemKeyRef = useRef<string>(crypto.randomUUID())
  const [ocrProcesando, setOcrProcesando] = useState(false)
  const [aplicarContado, setAplicarContado] = useState(false)
  // Pestaña en la URL (?tab=historial): "atrás" vuelve a la misma pestaña
  const urlTab = useUrlParams()
  const tabParam = urlTab.get("tab", "nuevo")
  const activeTab = ["nuevo", "historial"].includes(tabParam) ? tabParam : "nuevo"
  const setActiveTab = (t: string) => urlTab.set({ tab: t }, "push", { tab: "nuevo" })

  // ── Multi-cliente (caso "Tandil"): clientes adicionales en la misma cobranza ──
  const [clientesExtra, setClientesExtra] = useState<Array<{ cliente: Cliente; seleccionados: Record<string, number> }>>([])
  const [mostrarBuscarExtra, setMostrarBuscarExtra] = useState(false)
  const [contadoPedidos, setContadoPedidos] = useState<Set<string>>(new Set())  // anticipos con 10% contado (cliente principal)
  // "A cuenta (extra)" por cliente en cobro conjunto: plata que entrega de más
  // y queda a favor (permite también cobrarle a un cliente sin comprobantes).
  const [aCuentaExtra, setACuentaExtra] = useState<Record<string, number>>({})
  const [comprobanteArchivos, setComprobanteArchivos] = useState<{ url: string; nombre: string }[]>([])  // fotos de comprobantes (OCR)
  const esMulti = clientesExtra.length > 0

  // ── Historial ──
  const [historial, setHistorial] = useState<PagoHistorial[]>([])
  // Carteles de diferencia (compartidos con la barra de Caja)
  const [dialogoFalta, setDialogoFalta] = useState<number | null>(null)
  const [dialogoSobra, setDialogoSobra] = useState<number | null>(null)
  const [filtroCliente, setFiltroCliente] = useState("")
  const [filtroDesde, setFiltroDesde] = useState("")
  const [filtroHasta, setFiltroHasta] = useState("")
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [historialCargado, setHistorialCargado] = useState(false)

  // ── Historial unificado: rendiciones + viajes y vendedores por rendir ──
  const [rendicionesU, setRendicionesU] = useState<any[]>([])
  const [viajesPendU, setViajesPendU] = useState<any[]>([])
  const [vendedoresPendU, setVendedoresPendU] = useState<any[]>([])
  const [cajasFondos, setCajasFondos] = useState<any[]>([])
  const [rendicionSel, setRendicionSel] = useState<any | null>(null)
  const [cajaSel, setCajaSel] = useState("")
  const [confirmandoRend, setConfirmandoRend] = useState(false)

  // ── Rendición de viajes ──

  // ── Post-guardado ──
  const [reciboGenerado, setReciboGenerado] = useState<{ pagoId: string; numero: string } | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [lastPagoId, setLastPagoId] = useState<string | null>(null)

  const [anulando, setAnulando] = useState<string | null>(null)   // pagoId que se está anulando
  const [motivoAnulacion, setMotivoAnulacion] = useState("")
  const [confirmAnularId, setConfirmAnularId] = useState<string | null>(null)

  const ocrFileRef = useRef<HTMLInputElement>(null)
  const ocrCamRef = useRef<HTMLInputElement>(null)
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

  // Si se llegó desde "Registrar pago" del pedido, ofrecer volver a ese pedido
  const pedidoOrigen = searchParams.get("pedido_id")

  const totalComprobantes = Object.values(seleccionados).reduce((s, v) => s + v, 0)
  // Total combinado (incluye clientes adicionales y a cuenta extra en cobranza conjunta)
  const totalExtra = clientesExtra.reduce((s, c) => s + Object.values(c.seleccionados).reduce((a, v) => a + v, 0), 0)
  // Solo los clientes presentes en la cobranza (si quitaron uno, su extra no suma)
  const totalACuentaExtra = esMulti
    ? [cliente?.id, ...clientesExtra.map((c) => c.cliente.id)].reduce((s, id) => s + (id ? aCuentaExtra[id] || 0 : 0), 0)
    : 0
  const totalSeleccionadoUI = totalComprobantes + totalExtra + totalACuentaExtra
  // Regla del dueño (08/10): TODO lo que se ingresa en Cobros queda pendiente
  // de verificación — incluido el efectivo. Finanzas cuenta la plata y confirma
  // en /caja (ahí sale el recibo). Antes el efectivo se confirmaba en el acto.

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
    setClientesExtra([])
    setContadoPedidos(new Set())
    setComprobanteArchivos([])
  }

  const handleOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ""
    return procesarArchivosOCR(files)
  }

  // Pegar una captura con Ctrl+V en cualquier parte de la pantalla (igual que
  // la barra de Caja): la imagen va al mismo OCR que el botón de subir.
  const onPasteCaptura = (e: React.ClipboardEvent) => {
    const files: File[] = []
    for (const item of Array.from(e.clipboardData?.items || [])) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile()
        if (f) files.push(new File([f], `captura-${Date.now()}.png`, { type: f.type }))
      }
    }
    if (files.length) {
      e.preventDefault()
      procesarArchivosOCR(files)
    }
  }

  const procesarArchivosOCR = async (files: File[]) => {
    if (!files.length) return
    setOcrProcesando(true)
    try {
      const formData = new FormData()
      files.forEach((f) => formData.append("files", f))
      const res = await fetch("/api/pagos-clientes/ocr", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Guardar las fotos subidas (para adjuntarlas al pago)
      if (Array.isArray(data.archivos) && data.archivos.length) {
        setComprobanteArchivos((prev) => [...prev, ...data.archivos])
      }

      const resultados: any[] = data.resultados || []
      if (resultados.length === 0) {
        toast.warning("No se detectaron comprobantes en las imágenes (la foto igual quedó adjunta)")
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
          cuits_titulares: Array.isArray(r.cuits_titulares) ? r.cuits_titulares : [],
          localidad: r.localidad || "",
          // El OCR solo detecta ECHEQ; el color BLANCO/NEGRO lo deriva el
          // backend según la imputación (o queda PENDIENTE si es a cuenta).
          color_cheque: r.color_cheque === "ECHEQ" ? "ECHEQ" : undefined,
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
        imputaciones: Object.entries(c.seleccionados)
          .filter(([k]) => !k.startsWith("pedido:"))
          .map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado })),
        // Porción del cliente = lo tildado + su "a cuenta (extra)". Con extra
        // solo (sin comprobantes) también participa: todo queda a su favor.
        portion: Object.values(c.seleccionados).reduce((a, v) => a + v, 0) + (aCuentaExtra[c.cliente_id] || 0),
      }))
      .filter((c) => c.portion > 0)

    if (clientes.length === 0) { toast.error("Seleccioná comprobantes o cargá un a cuenta (extra)"); return }
    if (metodos.filter((m) => m.tipo === "cheque").length > 1) {
      toast.error("En cobranza multi-cliente usá un solo cheque (compartido)"); return
    }
    // El depósito con ítems no se reparte entre clientes: cada ítem-cheque crea
    // SU fila en cheques y partirlo duplicaría el papel (antes además entraba
    // en $0: el server suma los items y el reparto los perdía).
    if (metodos.some((m) => m.tipo === "deposito")) {
      toast.error("El depósito con varios ítems no se puede repartir entre clientes: cobralo por cliente individual"); return
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
      color: chequeMetodo.color_cheque,
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
        body: JSON.stringify({ origen: "ERP", confirmar, cheque_compartido, asignaciones, idempotency_key: idemKeyRef.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      idemKeyRef.current = crypto.randomUUID()
      toast.success(confirmar
        ? `Cobranza confirmada: ${data.clientes?.length || 0} cliente(s), recibos generados.`
        : "Cobranza registrada como PENDIENTE de verificación.")
      setCliente(null); setClientesExtra([]); setSeleccionados({}); setMetodos([]); setRetenciones([]); setPagoACuenta(false); setACuentaExtra({})
      setHistorialCargado(false)
    } catch (err: any) {
      toast.error("Error: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const handleGuardar = async (
    confirmar: boolean = false,
    modoDiferencia?: "ajuste" | "saldo" | "sobra_ajuste" | "sobra_cuenta",
  ) => {
    if (esMulti) return handleGuardarMulti(confirmar)
    if (!cliente) { toast.error("Seleccioná un cliente"); return }
    if (metodos.length === 0) { toast.error("Agregá al menos un método de pago"); return }

    // Imputaciones = solo comprobantes reales. Las claves "pedido:<id>" son anticipos
    // a pedidos sin facturar → quedan como pago a cuenta (saldo a favor) y se anotan.
    let imputaciones = pagoACuenta ? [] : Object.entries(seleccionados)
      .filter(([k]) => !k.startsWith("pedido:"))
      .map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado }))
    const anticipos = pagoACuenta ? [] : Object.keys(seleccionados).filter((k) => k.startsWith("pedido:"))

    // ── Diferencia entre lo entregado y lo seleccionado (misma regla y carteles
    // que la barra de Caja): falta → ajuste por redondeo (tope 1%) o saldo;
    // sobra → ajuste (débito) o a cuenta. El ajuste viaja como ajuste_redondeo.
    const r2 = (n: number) => Math.round(n * 100) / 100
    const montoMetodo = (m: any) => m.tipo === "deposito"
      ? (m.items || []).reduce((a: number, it: any) => a + Number(it.monto || 0), 0)
      : Number(m.monto || 0)
    const totalMetodos = metodos.reduce((s, m) => s + montoMetodo(m), 0)
    const bonifEstimada = calcBonificacion()
    const cubierto = r2(totalMetodos + (aplicarContado ? bonifEstimada : 0))
    const totalSeleccionado = r2(Object.values(seleccionados).reduce((s, v) => s + (Number(v) || 0), 0))
    const falta = r2(totalSeleccionado - cubierto)
    const totalImputable = imputaciones.reduce((s, i) => s + Number(i.monto_imputado || 0), 0)

    if (!pagoACuenta && falta > 0.01) {
      if (falta > totalImputable + 0.01) {
        toast.error(`Entre métodos${aplicarContado ? " + NC 10%" : ""} cubrís $${fmtARS(cubierto)} y seleccionaste $${fmtARS(totalSeleccionado)}. Bajá la selección o agregá un método.`)
        return
      }
      if (!modoDiferencia) { setDialogoFalta(falta); return }
      if (modoDiferencia === "saldo") {
        let excedente = falta
        for (let i = imputaciones.length - 1; i >= 0 && excedente > 0.005; i--) {
          const rebaja = Math.min(Number(imputaciones[i].monto_imputado), excedente)
          imputaciones[i].monto_imputado = r2(Number(imputaciones[i].monto_imputado) - rebaja)
          excedente = r2(excedente - rebaja)
        }
        imputaciones = imputaciones.filter((i) => Number(i.monto_imputado) > 0.009)
      }
    }
    const sobra = r2(-falta)
    if (!pagoACuenta && sobra > 0.01 && imputaciones.length && !modoDiferencia) {
      setDialogoSobra(sobra)
      return
    }
    const ajusteRedondeo =
      modoDiferencia === "ajuste" && falta > 0.01
        ? falta
        : modoDiferencia === "sobra_ajuste" && sobra > 0.01
          ? -sobra
          : 0
    setDialogoFalta(null); setDialogoSobra(null)
    const obsAnticipo = anticipos.length
      ? `Anticipo a pedido(s) sin facturar: ${anticipos.map((k) => k.replace("pedido:", "")).join(", ")}`
      : null
    // 10% tildado: la intención viaja SIEMPRE con el pago (MARCA_CONTADO) y la
    // NC/REV la emite el servidor en la confirmación (en el acto o diferida).
    // Un solo camino idempotente: no se saltea ni se duplica.
    const obsFinal = aplicarContado
      ? [obsAnticipo, MARCA_CONTADO].filter(Boolean).join(" ")
      : obsAnticipo

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
          observaciones: obsFinal,
          // Anticipos con su monto: entran a la BASE del tope de ajuste
          pedidos_anticipo: Object.entries(seleccionados)
            .filter(([k, v]) => k.startsWith("pedido:") && Number(v) > 0)
            .map(([k, v]) => ({ pedido_id: k.replace("pedido:", ""), monto: Number(v) })),
          // Ajuste por redondeo: positivo = falta (crédito) · negativo = sobrante (débito)
          ajuste_redondeo: ajusteRedondeo,
          pedidos_contado: [...contadoPedidos],
          comprobante_urls: comprobanteArchivos,
          retenciones: retenciones.map((r) => ({
            tipo: r.tipo,
            fecha: r.fecha,
            numero_comprobante: r.numero_comprobante,
            monto: r.monto,
            origen: r.origen,
          })),
          confirmar,
          idempotency_key: idemKeyRef.current,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      idemKeyRef.current = crypto.randomUUID()

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

      // Bonificación pago contado 10%: la resolvió el servidor en la
      // confirmación (viajó como MARCA_CONTADO) — nada que hacer acá.
      if (data.bonificacion_error) {
        toast.error(`⚠ La bonificación 10% falló: ${data.bonificacion_error}`)
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
      const [res, resumenRes, cajasRes] = await Promise.all([
        fetch("/api/pagos-clientes"),
        fetch("/api/pagos-clientes/rendiciones-resumen"),
        fetch("/api/finanzas/cajas"),
      ])
      const data = await res.json()
      setHistorial(Array.isArray(data) ? data : [])
      const resumen = await resumenRes.json()
      if (!resumen.error) {
        setRendicionesU(resumen.rendiciones || [])
        setViajesPendU(resumen.viajes_pendientes || [])
        setVendedoresPendU(resumen.vendedores_pendientes || [])
      }
      const cajas = await cajasRes.json()
      if (!cajas.error) {
        setCajasFondos(
          (cajas.cuentas || []).filter((c: any) => c.cuenta_tipo === "CAJA" || c.cuenta_tipo === "BANCO")
        )
      }
      setHistorialCargado(true)
    } catch {
      toast.error("Error cargando historial")
    } finally {
      setCargandoHistorial(false)
    }
  }

  // Al entrar a una pestaña (click o link con ?tab=), se carga una vez
  useEffect(() => {
    if (activeTab === "historial" && !historialCargado && !cargandoHistorial) loadHistorial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Confirmar una rendición completa (todos sus pagos de una) desde el historial
  const confirmarRendicion = async (forzar = false) => {
    if (!rendicionSel || !cajaSel || confirmandoRend) return
    const caja = cajasFondos.find((c) => c.cuenta_id === cajaSel)
    setConfirmandoRend(true)
    try {
      const res = await fetch(`/api/finanzas/rendiciones/${rendicionSel.id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_destino_tipo: caja?.cuenta_tipo || "CAJA",
          caja_destino_id: cajaSel,
          forzar_diferencia: forzar,
        }),
      })
      const d = await res.json()
      if (res.status === 409 && d.requiere_forzar) {
        setConfirmandoRend(false)
        if (confirm(`${d.error}\n\n¿Confirmar igual documentando la diferencia?`)) {
          return confirmarRendicion(true)
        }
        return
      }
      if (!res.ok || d.error) {
        toast.error(d.error || "Error al confirmar la rendición")
        return
      }
      toast.success("Rendición confirmada: todos los pagos quedaron aprobados")
      setRendicionSel(null)
      setCajaSel("")
      loadHistorial()
    } catch {
      toast.error("Error de conexión al confirmar")
    } finally {
      setConfirmandoRend(false)
    }
  }

  // Fila de un pago suelto en el historial unificado
  const renderFilaPago = (p: PagoHistorial) => {
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
              (() => {
                const m = ICONO_METODO[tipo]
                const Icono = m?.Icono ?? CreditCard
                return (
                  <span key={tipo} title={m?.texto ?? tipo} className="grid size-7 place-items-center rounded-md bg-neutro-100 text-neutro-600">
                    <Icono className="h-4 w-4" />
                  </span>
                )
              })()
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
            <Button variant="ghost" size="sm" className="h-7" onClick={() => verComprobantes(p.id)}>
              <Paperclip className="h-3.5 w-3.5 mr-1" /> Fotos
            </Button>
            {(p.estado === "pendiente" || p.estado === "pendiente_rendicion") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-green-700 hover:text-green-800 hover:bg-green-50"
                disabled={confirmandoPago === p.id}
                onClick={() => confirmarPagoHistorial(p.id)}
              >
                {confirmandoPago === p.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCircle className="h-3.5 w-3.5 mr-1" />}
                Confirmar
              </Button>
            )}
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
  }

  const [fotosPago, setFotosPago] = useState<{ url: string; nombre: string | null }[] | null>(null)
  const [cargandoFotos, setCargandoFotos] = useState(false)
  const verComprobantes = async (pagoId: string) => {
    setCargandoFotos(true)
    setFotosPago([])
    try {
      const { data } = await supabase
        .from("pago_comprobantes")
        .select("url, nombre")
        .eq("pago_id", pagoId)
        .order("created_at", { ascending: true })
      setFotosPago(data || [])
    } finally {
      setCargandoFotos(false)
    }
  }

  const [confirmandoPago, setConfirmandoPago] = useState<string | null>(null)
  const confirmarPagoHistorial = async (pagoId: string) => {
    setConfirmandoPago(pagoId)
    try {
      const res = await fetch(`/api/pagos/${pagoId}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_confirmador: "historial", accion: "confirmar" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Pago confirmado" + (data.numero_recibo ? ` — Recibo ${data.numero_recibo}` : ""))
      loadHistorial()
    } catch (e: any) {
      toast.error("Error: " + e.message)
    } finally {
      setConfirmandoPago(null)
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

  // Preview del 10% contado — misma regla que la barra de Caja (dueño 07/10):
  // por comprobante, el menor entre lo imputado en ESTE cobro y el 10% de su
  // total (la NC es 10% del total, una sola vez, nunca más que lo que se paga hoy).
  const calcBonificacion = (): number => {
    if (!aplicarContado) return 0
    const total = comprobantesData
      .filter(c => seleccionados[c.id] !== undefined && !dtosHechos.has(c.id))
      .reduce((sum, c) => {
        if (["PRES", "FA", "FB", "FC"].includes(c.tipo_comprobante)) {
          const imputado = Math.max(0, Number(seleccionados[c.id]) || 0)
          return sum + Math.min(imputado, Math.abs(Number(c.total_factura)) * 0.1)
        }
        return sum
      }, 0)
    return Math.round(total * 100) / 100
  }


  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto" onPaste={onPasteCaptura}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Cobros</h1>
          <p className="text-sm text-neutro-500">Cobrale a un cliente en la oficina: el pedido que retira o los anteriores. Queda pendiente hasta que Finanzas lo verifica en Caja.</p>
        </div>
        {pedidoOrigen && (
          <Link
            href={`/clientes-pedidos?pedido=${pedidoOrigen}`}
            className="shrink-0 rounded-lg border border-neutro-200 bg-white px-3 py-2 text-sm font-semibold text-azul-600 hover:bg-azul-50"
          >
            ← Volver al pedido
          </Link>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="nuevo">Nuevo cobro</TabsTrigger>
          <TabsTrigger value="historial">
            Historial
          </TabsTrigger>
        </TabsList>

        {/* ════ TAB NUEVO PAGO ════ */}
        <TabsContent value="nuevo">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna principal */}
            <div className="lg:col-span-2 space-y-6">

              {/* 1. Cliente */}
              <Paso n="1" titulo="Cliente" ayuda="Quién paga. Si pagan varios juntos, agregalos abajo.">
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
                      <button onClick={() => setMostrarBuscarExtra(true)} className="text-sm font-semibold text-azul-600 hover:underline flex items-center gap-1">
                        <Plus className="h-4 w-4" /> Agregar cliente (cobro conjunto)
                      </button>
                    )}
                  </div>
                )}
              </Paso>

              {/* 2. Comprobantes */}
              {cliente && !pagoACuenta && (
                <Paso
                  n="2"
                  titulo="Qué paga"
                  ayuda="Tildá los pedidos o comprobantes que cancela con este cobro."
                  accion={
                    <button
                      onClick={() => { setPagoACuenta(true); setSeleccionados({}) }}
                      className="text-xs font-semibold text-azul-600 hover:underline"
                    >
                      Pago a cuenta (sin imputar)
                    </button>
                  }
                >
                  {/* Switch Facturados/Todos + línea de saldos (traído de la barra de Caja) */}
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <div className="inline-flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Pedidos a mostrar">
                      {([{ key: "facturados", label: "Facturados" }, { key: "todos", label: "Todos" }] as { key: ModoPedidos; label: string }[]).map((m) => (
                        <button
                          key={m.key}
                          role="tab"
                          aria-selected={modoPedidos === m.key}
                          onClick={() => setModoPedidos(m.key)}
                          className={`rounded-md px-3 py-1 text-xs font-semibold transition ${modoPedidos === m.key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {resumenCuenta && (
                      <span className="text-xs text-muted-foreground">
                        Saldo a cobrar <b className="text-foreground">$ {fmtARS(resumenCuenta.saldoACobrar)}</b>
                        {" · "}{resumenCuenta.pedidosFacturados} facturado{resumenCuenta.pedidosFacturados === 1 ? "" : "s"}
                        {resumenCuenta.otrosComprobantes > 0 && ` + ${resumenCuenta.otrosComprobantes} sin pedido`}
                        {" · "}{resumenCuenta.pedidosSinFacturar} sin facturar
                        {resumenCuenta.pedidosSaldados > 0 && ` · ${resumenCuenta.pedidosSaldados} saldado${resumenCuenta.pedidosSaldados === 1 ? "" : "s"}`}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {totalComprobantes > 0 ? "Se imputa a lo tildado" : "Sin tildar nada, queda pendiente de imputación"}
                    </span>
                  </div>
                  <ComprobantesSelector
                    clienteId={cliente.id}
                    seleccionados={seleccionados}
                    onChange={setSeleccionados}
                    onComprobantesLoaded={setComprobantesData}
                    onDtosHechosLoaded={setDtosHechos}
                    onContadoPedidosChange={setContadoPedidos}
                    modo={modoPedidos}
                    onResumenLoaded={setResumenCuenta}
                  />
                  {esMulti && (
                    <ACuentaExtraInput
                      valor={aCuentaExtra[cliente.id] || 0}
                      onChange={(v) => setACuentaExtra((prev) => ({ ...prev, [cliente.id]: v }))}
                    />
                  )}
                </Paso>
              )}

              {cliente && pagoACuenta && (
                <section className="rounded-xl border border-ambar-200 bg-ambar-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm font-medium">Pago a cuenta — no se imputará a ningún comprobante</span>
                    </div>
                    <button onClick={() => setPagoACuenta(false)} className="text-xs font-semibold text-azul-600 hover:underline">
                      Imputar a comprobantes
                    </button>
                  </div>
                </section>
              )}

              {/* 2b. Clientes adicionales (cobranza conjunta — caso "Tandil") */}
              {cliente && !pagoACuenta && (
                <>
                  {clientesExtra.map((ce, idx) => (
                    <Paso
                      key={ce.cliente.id}
                      n={`2.${idx + 2}`}
                      titulo={<>Qué paga {ce.cliente.razon_social || ce.cliente.nombre}</>}
                      ayuda="Cliente adicional del cobro conjunto."
                      accion={
                        <button
                          onClick={() => setClientesExtra((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-xs font-semibold text-error-600 hover:underline"
                        >
                          Quitar
                        </button>
                      }
                    >
                      <ComprobantesSelector
                        clienteId={ce.cliente.id}
                        seleccionados={ce.seleccionados}
                        onChange={(sel) => setClientesExtra((prev) => prev.map((c, i) => (i === idx ? { ...c, seleccionados: sel } : c)))}
                      />
                      <ACuentaExtraInput
                        valor={aCuentaExtra[ce.cliente.id] || 0}
                        onChange={(v) => setACuentaExtra((prev) => ({ ...prev, [ce.cliente.id]: v }))}
                      />
                    </Paso>
                  ))}
                  {esMulti && (
                    <p className="text-xs text-amber-700 px-1">
                      Cobranza conjunta: los métodos de pago se reparten entre los clientes según lo seleccionado
                      más su a cuenta (extra). Un cliente puede ir solo con a cuenta, sin comprobantes.
                      Si pagan con cheque, usá un solo cheque (se registra compartido).
                    </p>
                  )}
                </>
              )}

              {/* 3. Métodos de pago */}
              <Paso
                n="3"
                titulo="Cómo paga"
                ayuda="Efectivo, transferencia, cheque o depósito. Con una foto o captura se completan solos."
                accion={
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={ocrFileRef}
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      className="hidden"
                      onChange={handleOCR}
                    />
                    <input
                      ref={ocrCamRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => ocrCamRef.current?.click()}
                      disabled={ocrProcesando}
                    >
                      <Camera className="h-4 w-4 mr-1" /> Sacar foto
                    </Button>
                    <span className="text-[11px] text-neutro-500 hidden lg:inline">o pegá una captura (Ctrl+V)</span>
                  </div>
                }
              >
                <MetodoPagoForm metodos={metodos} onChange={setMetodos} />
              </Paso>

              {/* 4. Retenciones */}
              <Paso n="4" titulo="Retenciones" ayuda="Solo si el cliente te entrega certificados de retención (opcional).">
                <RetencionForm retenciones={retenciones} onChange={setRetenciones} />
              </Paso>
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
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${aplicarContado ? "bg-ambar-50 border-ambar-300" : "bg-white border-neutro-200"}`}
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
                onClick={() => handleGuardar(false)}
                disabled={guardando || !cliente || metodos.length === 0}
              >
                {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                {guardando ? "Guardando..." : "Registrar cobro (queda pendiente de verificación)"}
              </Button>

              {metodos.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Todo cobro ingresado acá queda pendiente: Finanzas lo cuenta y lo confirma en Caja, y ahí sale el recibo.
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
            <div className="rounded-xl border border-neutro-200 bg-white py-8">
              <CargaProgreso compacto mensajes={["Buscando cobros…", "Trayendo recibos…", "Sumando rendiciones…", "Ya casi está…"]} className="mx-auto max-w-sm" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                  {historial.length} pagos · {rendicionesU.length + viajesPendU.length + vendedoresPendU.length}{" "}
                  rendiciones
                </p>
                <Button variant="ghost" size="sm" onClick={loadHistorial}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Actualizar
                </Button>
              </div>

              {/* Filtros del administrativo: por cliente y por rango de fechas.
                  Con un filtro activo se ocultan las filas de rendiciones/viajes
                  (son otra cosa: acá se busca un pago puntual). */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={filtroCliente}
                  onChange={(e) => setFiltroCliente(e.target.value)}
                  placeholder="Filtrar por cliente…"
                  className="h-10 w-full rounded-lg border border-neutro-200 bg-white px-3 text-sm outline-none focus:border-azul-400 sm:w-64"
                />
                <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} className="h-10 rounded-lg border border-neutro-200 bg-white px-2 text-sm" />
                <span className="text-xs text-muted-foreground">a</span>
                <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} className="h-10 rounded-lg border border-neutro-200 bg-white px-2 text-sm" />
                {(filtroCliente || filtroDesde || filtroHasta) && (
                  <button
                    onClick={() => { setFiltroCliente(""); setFiltroDesde(""); setFiltroHasta("") }}
                    className="text-xs font-semibold text-azul-600 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>

              {historial.length === 0 && rendicionesU.length === 0 && viajesPendU.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No hay pagos registrados</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-neutro-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-neutro-50 text-xs font-semibold text-neutro-600">
                      <tr>
                        <th className="p-3 text-left">Fecha</th>
                        <th className="p-3 text-left">Recibo</th>
                        <th className="p-3 text-left">Cliente / Rendición</th>
                        <th className="p-3 text-left">Métodos</th>
                        <th className="p-3 text-right">Monto</th>
                        <th className="p-3 text-center">Estado</th>
                        <th className="p-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Filas unificadas: rendiciones + viajes por rendir + pagos sueltos.
                          Los pagos dentro de una rendición o de un viaje pendiente no se
                          listan sueltos: se aprueban desde su rendición. */}
                      {(() => {
                        const enRendicion = new Set<string>(rendicionesU.flatMap((r: any) => r.pago_ids || []))
                        const enViajePend = new Set<string>(viajesPendU.flatMap((v: any) => v.pago_ids || []))
                        const enVendPend = new Set<string>(vendedoresPendU.flatMap((v: any) => v.pago_ids || []))
                        const hayFiltro = Boolean(filtroCliente || filtroDesde || filtroHasta)
                        const pasaFiltros = (p: PagoHistorial) => {
                          if (filtroCliente) {
                            const nombre = `${p.clientes?.nombre || ""} ${p.clientes?.razon_social || ""}`.toLowerCase()
                            if (!nombre.includes(filtroCliente.toLowerCase())) return false
                          }
                          const f = (p.fecha_pago || "").slice(0, 10)
                          if (filtroDesde && f < filtroDesde) return false
                          if (filtroHasta && f > filtroHasta) return false
                          return true
                        }
                        const filas: Array<{ key: string; orden: string; tipo: string; data: any }> = [
                          ...historial
                            .filter((p) => !enRendicion.has(p.id) && !enViajePend.has(p.id) && !enVendPend.has(p.id))
                            .filter(pasaFiltros)
                            .map((p) => ({ key: `p-${p.id}`, orden: p.fecha_pago || "", tipo: "pago", data: p })),
                          ...(hayFiltro ? [] : [
                            ...rendicionesU.map((r: any) => ({
                              key: `r-${r.id}`,
                              orden: r.created_at || r.fecha || "",
                              tipo: "rendicion",
                              data: r,
                            })),
                            ...viajesPendU.map((v: any) => ({
                              key: `v-${v.viaje_id}`,
                              orden: v.ultima_fecha || "",
                              tipo: "viaje",
                              data: v,
                            })),
                            ...vendedoresPendU.map((v: any) => ({
                              key: `vp-${v.cobrador_id}`,
                              orden: v.ultima_fecha || "",
                              tipo: "vendedor_pendiente",
                              data: v,
                            })),
                          ]),
                        ].sort((a, b) => b.orden.localeCompare(a.orden))

                        return filas.map((fila) => {
                          if (fila.tipo === "rendicion") {
                            const r = fila.data
                            const abierta = r.estado === "abierta"
                            return (
                              <tr
                                key={fila.key}
                                onClick={() => { setRendicionSel(r); setCajaSel("") }}
                                className={`border-t cursor-pointer ${
                                  abierta ? "bg-amber-50 hover:bg-amber-100" : "bg-emerald-50/50 hover:bg-emerald-50"
                                }`}
                              >
                                <td className="p-3">{fmtFecha(r.created_at || r.fecha)}</td>
                                <td className="p-3 font-mono text-xs">—</td>
                                <td className="p-3 font-semibold">
                                  🧾 RENDICIÓN — {r.titulo}
                                  <span className="text-muted-foreground font-normal"> · {r.cantidad_pagos} pagos</span>
                                </td>
                                <td className="p-3 text-muted-foreground text-xs">
                                  ef. {fmtARS(r.efectivo_declarado)}
                                </td>
                                <td className="p-3 text-right font-mono font-semibold">${fmtARS(r.total)}</td>
                                <td className="p-3 text-center">
                                  <Badge className={abierta ? "bg-amber-100 text-amber-700 border-0" : "bg-green-100 text-green-700 border-0"}>
                                    {abierta ? "🚚 En viaje" : "Confirmada"}
                                  </Badge>
                                </td>
                                <td className="p-3 text-center">
                                  <Button variant="ghost" size="sm" className="h-7">
                                    Ver detalle {abierta ? "· Confirmar" : ""}
                                  </Button>
                                </td>
                              </tr>
                            )
                          }
                          if (fila.tipo === "viaje") {
                            const v = fila.data
                            return (
                              <tr
                                key={fila.key}
                                onClick={() => window.open(`/viajes/${v.viaje_id}/rendicion`, "_self")}
                                className="border-t bg-purple-50/60 hover:bg-purple-50 cursor-pointer"
                              >
                                <td className="p-3">{fmtFecha(v.ultima_fecha)}</td>
                                <td className="p-3 font-mono text-xs">—</td>
                                <td className="p-3 font-semibold">
                                  🚚 RENDICIÓN — {v.nombre}
                                  <span className="text-muted-foreground font-normal"> · {v.cantidad_pagos} pagos</span>
                                </td>
                                <td className="p-3 text-muted-foreground text-xs">
                                  💵 ${fmtARS(v.desglose?.efectivo || 0)}
                                  {v.desglose?.cheques_cantidad ? ` · 🧾 ${v.desglose.cheques_cantidad}` : ""}
                                </td>
                                <td className="p-3 text-right font-mono font-semibold">${fmtARS(v.total)}</td>
                                <td className="p-3 text-center">
                                  <Badge className="bg-purple-100 text-purple-700 border-0">Por rendir</Badge>
                                </td>
                                <td className="p-3 text-center">
                                  <Button variant="ghost" size="sm" className="h-7">
                                    Abrir detalle del viaje →
                                  </Button>
                                </td>
                              </tr>
                            )
                          }
                          if (fila.tipo === "vendedor_pendiente") {
                            const v = fila.data
                            return (
                              <tr
                                key={fila.key}
                                onClick={() => { setRendicionSel({ ...v, tipo: "pendiente_vendedor" }); setCajaSel("") }}
                                className="border-t bg-sky-50/70 hover:bg-sky-50 cursor-pointer"
                              >
                                <td className="p-3">{fmtFecha(v.ultima_fecha)}</td>
                                <td className="p-3 font-mono text-xs">—</td>
                                <td className="p-3 font-semibold">
                                  🧾 RENDICIÓN — {v.titulo}
                                  <span className="text-muted-foreground font-normal"> · {v.cantidad_pagos} cobros</span>
                                </td>
                                <td className="p-3 text-muted-foreground text-xs">
                                  💵 ${fmtARS(v.desglose?.efectivo || 0)}
                                  {v.desglose?.cheques_cantidad ? ` · 🧾 ${v.desglose.cheques_cantidad}` : ""}
                                </td>
                                <td className="p-3 text-right font-mono font-semibold">${fmtARS(v.total)}</td>
                                <td className="p-3 text-center">
                                  <Badge className="bg-sky-100 text-sky-700 border-0">Sin declarar</Badge>
                                </td>
                                <td className="p-3 text-center">
                                  <Button variant="ghost" size="sm" className="h-7">
                                    Ver detalle
                                  </Button>
                                </td>
                              </tr>
                            )
                          }
                          const p = fila.data
                          return renderFilaPago(p)
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ════ TAB RENDICIÓN DE VIAJES ════ */}
        {/* La pestaña "Rendición de viajes" se mudó a /caja → sección "Por rendir" (dueño 08/10) */}
      </Tabs>

      {/* ── Modal: ver comprobantes (fotos) ── */}
      {fotosPago !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setFotosPago(null)}>
          <div className="bg-white rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold tracking-tight text-azul-900">Fotos del cobro</h3>
              <button onClick={() => setFotosPago(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>
            {cargandoFotos ? (
              <CargaProgreso compacto mensajes={["Buscando las fotos…", "Descargando imágenes…", "Ya casi está…"]} className="mx-auto max-w-sm py-10" />
            ) : fotosPago.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">Este pago no tiene comprobantes adjuntos.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fotosPago.map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="block border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                    <img src={f.url} alt={f.nombre || `Comprobante ${i + 1}`} className="w-full h-48 object-contain bg-gray-50" />
                    <p className="text-xs text-muted-foreground p-2 truncate">{f.nombre || `Comprobante ${i + 1}`}</p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detalle de rendición: desglose completo + confirmar todo de una ── */}
      <Dialog open={!!rendicionSel} onOpenChange={(open) => { if (!open) setRendicionSel(null) }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {rendicionSel && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  🧾 RENDICIÓN — {rendicionSel.titulo}
                  <Badge
                    className={
                      rendicionSel.tipo === "pendiente_vendedor"
                        ? "bg-sky-100 text-sky-700 border-0"
                        : rendicionSel.estado === "abierta"
                        ? "bg-amber-100 text-amber-700 border-0"
                        : "bg-green-100 text-green-700 border-0"
                    }
                  >
                    {rendicionSel.tipo === "pendiente_vendedor"
                      ? "Sin declarar"
                      : rendicionSel.estado === "abierta"
                      ? "🚚 En viaje"
                      : "Confirmada"}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                {/* Qué tiene que entregar: efectivo y cheques */}
                {rendicionSel.desglose && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                      <p className="text-[10px] text-emerald-600 uppercase font-bold">💵 Efectivo a recibir</p>
                      <p className="font-mono font-semibold">${fmtARS(rendicionSel.desglose.efectivo)}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">🧾 Cheques</p>
                      <p className="font-mono font-semibold">
                        {rendicionSel.desglose.cheques_cantidad} × ${fmtARS(rendicionSel.desglose.cheques_monto)}
                      </p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">🏦 Transferencias</p>
                      <p className="font-mono font-semibold">${fmtARS(rendicionSel.desglose.transferencias)}</p>
                    </div>
                  </div>
                )}
                {/* Pagos incluidos */}
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-2">
                    Pagos incluidos ({rendicionSel.cantidad_pagos})
                  </p>
                  <div className="border rounded-lg divide-y">
                    {rendicionSel.pagos.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{p.cliente_nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtFecha(p.fecha_pago)} · {p.metodos}
                          </p>
                        </div>
                        <p className="font-mono font-semibold shrink-0 ml-2">${fmtARS(p.monto)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Efectivo declarado vs registrado (solo rendiciones declaradas) */}
                {rendicionSel.tipo !== "pendiente_vendedor" && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/40 rounded-lg p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Efectivo declarado</p>
                      <p className="font-mono font-semibold">${fmtARS(rendicionSel.efectivo_declarado)}</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Efectivo registrado</p>
                      <p className="font-mono font-semibold">${fmtARS(rendicionSel.efectivo_registrado)}</p>
                    </div>
                    <div className={`rounded-lg p-2 ${Math.abs(rendicionSel.diferencia) > 0.01 ? "bg-red-50" : "bg-muted/40"}`}>
                      <p className="text-[10px] text-muted-foreground uppercase">Diferencia</p>
                      <p className={`font-mono font-semibold ${Math.abs(rendicionSel.diferencia) > 0.01 ? "text-red-600" : ""}`}>
                        ${fmtARS(rendicionSel.diferencia)}
                      </p>
                    </div>
                  </div>
                )}

                {rendicionSel.tipo === "pendiente_vendedor" && (
                  <p className="text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">
                    El vendedor todavía no rindió este dinero desde su app. Los montos de arriba son lo que
                    debería entregar cuando cierre la rendición.
                  </p>
                )}

                {/* Gastos y fondos del viaje */}
                {(rendicionSel.gastos?.length > 0 || rendicionSel.fondos?.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {rendicionSel.gastos?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase mb-1">Gastos del viaje</p>
                        <div className="border rounded-lg divide-y">
                          {rendicionSel.gastos.map((g: any, i: number) => (
                            <div key={i} className="flex justify-between px-3 py-1.5 text-xs">
                              <span className="truncate">{g.concepto || "Gasto"}</span>
                              <span className="font-mono text-red-600 shrink-0 ml-2">${fmtARS(Math.abs(g.monto))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {rendicionSel.fondos?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase mb-1">Efectivo entregado al chofer</p>
                        <div className="border rounded-lg divide-y">
                          {rendicionSel.fondos.map((g: any, i: number) => (
                            <div key={i} className="flex justify-between px-3 py-1.5 text-xs">
                              <span className="truncate">{g.concepto || "Fondo"}</span>
                              <span className="font-mono shrink-0 ml-2">${fmtARS(g.monto)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Retiros del viajante en el período */}
                {rendicionSel.retiros?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase mb-1">Retiros de comisión del período</p>
                    <div className="border rounded-lg divide-y">
                      {rendicionSel.retiros.map((g: any, i: number) => (
                        <div key={i} className="flex justify-between px-3 py-1.5 text-xs">
                          <span className="truncate">{fmtFecha(g.fecha)} · {g.concepto || "Retiro"}</span>
                          <span className="font-mono text-red-600 shrink-0 ml-2">${fmtARS(Math.abs(g.monto))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rendicionSel.observaciones && (
                  <p className="text-xs text-muted-foreground">Obs: {rendicionSel.observaciones}</p>
                )}
                {rendicionSel.confirmado_at && (
                  <p className="text-xs text-muted-foreground">
                    Confirmada el {new Date(rendicionSel.confirmado_at).toLocaleString("es-AR")}
                  </p>
                )}

                {/* Confirmación en lote */}
                {rendicionSel.estado === "abierta" && (
                  <div className="border-t pt-3 space-y-2">
                    <Label className="text-xs">Caja destino del efectivo</Label>
                    <div className="flex gap-2">
                      <select
                        value={cajaSel}
                        onChange={(e) => setCajaSel(e.target.value)}
                        className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white"
                      >
                        <option value="">Elegir caja/banco...</option>
                        {cajasFondos.map((c: any) => (
                          <option key={c.cuenta_id} value={c.cuenta_id}>
                            {c.cuenta_tipo === "BANCO" ? "🏦" : "💵"} {c.nombre}
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={() => confirmarRendicion(false)}
                        disabled={!cajaSel || confirmandoRend}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {confirmandoRend ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle className="h-4 w-4 mr-1.5" />
                            Confirmar todo ({rendicionSel.cantidad_pagos})
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Aprueba todos los pagos de la rendición de una sola vez: el efectivo entra a la caja
                      elegida y las transferencias pasan a conciliación bancaria.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-exito-50 text-exito-600">
              <CheckCircle className="h-8 w-8" />
            </div>
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
                  setActiveTab("historial") // la pestaña carga el historial al abrirse
                }}
              >
                Ver Historial
              </Button>
              <Button
                variant="ghost"
                className="w-full text-sm"
                onClick={() => { setShowSuccess(false); resetForm() }}
              >
                Nuevo cobro
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Carteles de diferencia (misma pieza que la barra de Caja) */}
      {dialogoSobra != null && (
        <DialogoSobra
          monto={dialogoSobra}
          baseTope={totalComprobantes}
          conContado={aplicarContado}
          onAjustar={() => handleGuardar(false, "sobra_ajuste")}
          onACuenta={() => handleGuardar(false, "sobra_cuenta")}
          onCancelar={() => setDialogoSobra(null)}
        />
      )}
      {dialogoFalta != null && (
        <DialogoFalta
          monto={dialogoFalta}
          baseTope={totalComprobantes}
          conContado={aplicarContado}
          onAjustar={() => handleGuardar(false, "ajuste")}
          onSaldo={() => handleGuardar(false, "saldo")}
          onCancelar={() => setDialogoFalta(null)}
        />
      )}
    </div>
  )
}

// "A cuenta (extra)" de un cliente en cobro conjunto: plata que entrega por
// encima de lo tildado (o sin tildar nada) y queda a su favor al confirmarse.
function ACuentaExtraInput({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <label className="text-sm text-muted-foreground whitespace-nowrap">A cuenta (extra):</label>
      <div className="relative w-40">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={valor || ""}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="h-10 w-full rounded-lg border border-neutro-200 bg-white px-2 pl-5 text-sm"
          placeholder="0"
        />
      </div>
      {valor > 0 && <span className="text-xs text-amber-700">queda a favor del cliente</span>}
    </div>
  )
}

// Un paso del cobro: número, título y para qué sirve (mismo lenguaje visual que las fichas)
function Paso({ n, titulo, ayuda, accion, children, className = "" }: {
  n: string; titulo: ReactNode; ayuda?: ReactNode; accion?: ReactNode; children?: ReactNode; className?: string
}) {
  return (
    <section className={`rounded-xl border border-neutro-200 bg-white p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-azul-50 text-sm font-bold text-azul-600">{n}</span>
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-azul-900">{titulo}</h2>
            {ayuda && <p className="text-[13px] text-neutro-500">{ayuda}</p>}
          </div>
        </div>
        {accion}
      </div>
      {children}
    </section>
  )
}

// Ícono de cada forma de pago (en lugar de emojis)
const ICONO_METODO: Record<string, { Icono: ComponentType<{ className?: string }>; texto: string }> = {
  efectivo: { Icono: Banknote, texto: "Efectivo" },
  transferencia: { Icono: Landmark, texto: "Transferencia" },
  cheque: { Icono: FileText, texto: "Cheque" },
  deposito: { Icono: Building2, texto: "Depósito" },
}

export default function PagosClientesPage() {
  return (
    <Suspense fallback={<CargaProgreso titulo="Abriendo Cobros" />}>
      <PagosClientesContent />
    </Suspense>
  )
}
