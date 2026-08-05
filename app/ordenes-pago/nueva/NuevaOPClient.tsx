"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    ArrowLeft, Plus, Trash2, DollarSign, CreditCard,
    Building2, Banknote, FileText
} from "lucide-react"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"

interface MedioPago {
    id: string
    medio: "efectivo" | "cheque" | "cheque_propio" | "transferencia" | "deposito"
    monto: number
    cheque_id?: string
    cheque_banco?: string
    cheque_numero?: string
    cheque_fecha_vencimiento?: string
    banco_destino?: string
    numero_cuenta?: string
    cbu?: string
    numero_transferencia?: string
    fecha_transferencia?: string
    observaciones?: string
    cuenta_origen_tipo?: "CAJA" | "BANCO"
    cuenta_origen_id?: string
}

interface Imputacion {
    movimiento_cc_id?: string
    vencimiento_id?: string
    comprobante_compra_id?: string
    monto_imputado: number
    descripcion: string
}

// ── Etiquetas reales por tipo de comprobante ────────────────────────────────
function etiquetaTipo(tc?: string | null, fallback?: string) {
    if (!tc) return fallback || "COMPROBANTE"
    if (tc === "Adquisicion") return "ADQUISICIÓN"
    if (tc === "Reversa") return "REVERSA"
    if (tc.startsWith("NC")) return `NOTA CRÉDITO ${tc.slice(2)}`.trim()
    if (tc.startsWith("ND")) return `NOTA DÉBITO ${tc.slice(2)}`.trim()
    if (tc.startsWith("F")) return `FACTURA ${tc.slice(1)}`.trim()
    return tc.toUpperCase()
}
function claseTipo(tc?: string | null) {
    if (tc === "Adquisicion") return "bg-slate-800 text-white"
    if (tc === "Reversa") return "bg-slate-200 text-slate-700"
    if (tc?.startsWith("NC")) return "bg-emerald-100 text-emerald-800"
    if (tc?.startsWith("ND")) return "bg-orange-100 text-orange-800"
    if (tc?.startsWith("F")) return "bg-blue-100 text-blue-800"
    return "bg-muted text-muted-foreground"
}

const addDiasISO = (iso: string, dias: number) => {
    const d = new Date(iso + "T00:00:00")
    d.setDate(d.getDate() + dias)
    return d.toISOString().slice(0, 10)
}
const fmtFechaCorta = (iso?: string | null) => {
    if (!iso) return "—"
    const [y, m, d] = String(iso).slice(0, 10).split("-")
    return `${d}/${m}/${y.slice(2)}`
}
const COLOR_CHEQUE: Record<string, { label: string; dot: string }> = {
    BLANCO: { label: "Blanco", dot: "#e2e8f0" },
    NEGRO: { label: "Negro", dot: "#1f2937" },
    ECHEQ: { label: "Echeq", dot: "#8b5cf6" },
}
const colorDeCheque = (ch: any): string => ch.es_echeq ? "ECHEQ" : (ch.color === "NEGRO" ? "NEGRO" : "BLANCO")

export default function NuevaOrdenPagoPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Cargando...</div>}>
            <NuevaOrdenPagoContent />
        </Suspense>
    )
}

function NuevaOrdenPagoContent() {
    const searchParams = useSearchParams()
    const router = useRouter()

    const [proveedores, setProveedores] = useState<any[]>([])
    const [proveedorId, setProveedorId] = useState(searchParams.get("proveedor_id") || "")
    const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0])
    const [observaciones, setObservaciones] = useState("")

    // Retención de Ganancias RG 830 — calculada por el sistema; el ajuste
    // manual requiere motivo y queda auditado. IIBB/IVA/SUSS fuera de alcance
    // (no somos agentes) — las columnas quedan en 0.
    const [retGanancias, setRetGanancias] = useState(0)
    const [calcGanancias, setCalcGanancias] = useState<any>(null)
    const [calcLoading, setCalcLoading] = useState(false)
    const [gananciasManual, setGananciasManual] = useState(false)
    const [gananciasMotivo, setGananciasMotivo] = useState("")
    const retIibb = 0, retIva = 0, retSuss = 0

    // Medios de pago
    const [medios, setMedios] = useState<MedioPago[]>([])

    // Imputaciones (comprobantes/vencimientos a cubrir)
    const [imputaciones, setImputaciones] = useState<Imputacion[]>([])
    const [comprobantesCC, setComprobantesCC] = useState<any[]>([])
    const [creditos, setCreditos] = useState<any[]>([])
    const [vencimientosProv, setVencimientosProv] = useState<any[]>([])

    const [cheques, setCheques] = useState<any[]>([])
    const [submitting, setSubmitting] = useState(false)

    // Origen de fondos y acuerdo de pago de la ficha
    const [cuentasFondos, setCuentasFondos] = useState<any[]>([])
    const [fichaPago, setFichaPago] = useState<any>(null)
    const [chequeColorFiltro, setChequeColorFiltro] = useState<string>("todos")
    const [chequeVerTodos, setChequeVerTodos] = useState(false)
    const [bancoOrigenSel, setBancoOrigenSel] = useState("")
    const [montoTransfer, setMontoTransfer] = useState("")
    const [cajaOrigenSel, setCajaOrigenSel] = useState("")
    const [montoEfectivo, setMontoEfectivo] = useState("")

    useEffect(() => {
        loadProveedores()
        loadCheques()
        fetch("/api/finanzas/cajas").then(r => r.json())
            .then(d => setCuentasFondos(d.cuentas || []))
            .catch(() => setCuentasFondos([]))
    }, [])

    // Recalcular la retención de Ganancias cuando cambian proveedor/imputaciones/fecha
    useEffect(() => {
        if (!proveedorId) { setCalcGanancias(null); if (!gananciasManual) setRetGanancias(0); return }
        let cancel = false
        setCalcLoading(true)
        fetch("/api/ordenes-pago/preview-retencion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                proveedor_id: proveedorId,
                fecha,
                imputaciones: imputaciones.map(i => ({
                    movimiento_cc_id: i.movimiento_cc_id || null,
                    vencimiento_id: i.vencimiento_id || null,
                    comprobante_compra_id: i.comprobante_compra_id || null,
                    monto_imputado: i.monto_imputado,
                })),
            }),
        })
            .then(r => r.json())
            .then(d => {
                if (cancel) return
                if (d.error) { setCalcGanancias({ error: d.error }); return }
                setCalcGanancias(d)
                if (!gananciasManual) setRetGanancias(Number(d.retencion ?? 0))
            })
            .catch(() => { if (!cancel) setCalcGanancias(null) })
            .finally(() => { if (!cancel) setCalcLoading(false) })
        return () => { cancel = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proveedorId, fecha, JSON.stringify(imputaciones), gananciasManual])

    useEffect(() => {
        if (proveedorId) {
            loadComprobantesCC()
            loadVencimientos()
            loadCreditos()
            fetch(`/api/proveedores/${proveedorId}/fiscal`).then(r => r.json())
                .then(d => setFichaPago(d.proveedor || null))
                .catch(() => setFichaPago(null))
        }
    }, [proveedorId])

    // Si viene un vencimiento_id por URL, pre-seleccionarlo
    useEffect(() => {
        const vencId = searchParams.get("vencimiento_id")
        const monto = searchParams.get("monto")
        if (vencId && monto && vencimientosProv.length > 0) {
            const yaImputado = imputaciones.some(i => i.vencimiento_id === vencId)
            if (!yaImputado) {
                const venc = vencimientosProv.find(v => v.id === vencId)
                if (venc) {
                    setImputaciones(prev => [...prev, {
                        vencimiento_id: vencId,
                        monto_imputado: parseFloat(monto),
                        descripcion: venc.concepto
                    }])
                }
            }
        }
    }, [vencimientosProv])

    // Si vienen mov_cc_ids por URL (desde CC proveedor), pre-seleccionarlos
    useEffect(() => {
        const movCcIds = searchParams.get("mov_cc_ids")
        const movMontos = searchParams.get("mov_montos")
        const movDesc = searchParams.get("mov_desc")
        if (movCcIds && movMontos) {
            const ids = movCcIds.split(",")
            const montos = movMontos.split(",")
            const descs = movDesc ? movDesc.split(",").map(d => decodeURIComponent(d)) : ids.map(() => "Comprobante")
            const newImps: Imputacion[] = []
            ids.forEach((ccId, i) => {
                if (!imputaciones.some(imp => imp.movimiento_cc_id === ccId)) {
                    newImps.push({
                        movimiento_cc_id: ccId,
                        monto_imputado: parseFloat(montos[i]) || 0,
                        descripcion: descs[i] || "Comprobante"
                    })
                }
            })
            if (newImps.length > 0) {
                setImputaciones(prev => [...prev, ...newImps])
            }
        }
    }, [])

    async function loadProveedores() {
        const supabase = createClient()
        const { data } = await supabase.from("proveedores").select("id, nombre, sigla, cuit, banco_nombre, banco_cuenta, banco_numero_cuenta, banco_tipo_cuenta, retencion_ganancias, retencion_iibb, percepcion_iva").eq("activo", true).order("nombre")
        setProveedores(data || [])
    }

    async function loadCheques() {
        const supabase = createClient()
        const { data } = await supabase.from("cheques").select("*").eq("estado", "EN_CARTERA").order("fecha_vencimiento")
        setCheques(data || [])
    }

    async function loadComprobantesCC() {
        try {
            const res = await fetch(`/api/proveedores/${proveedorId}/cuenta-corriente`)
            const data = await res.json()
            const pendientes = (data.comprobantes || []).filter((c: any) => c.estado === "pendiente" && c.saldo_pendiente > 0)
            setComprobantesCC(pendientes)
        } catch (e) {
            console.error(e)
        }
    }

    async function loadCreditos() {
        try {
            const res = await fetch(`/api/proveedores/${proveedorId}/creditos`)
            const data = await res.json()
            setCreditos(data.creditos || [])
        } catch (e) {
            console.error(e)
        }
    }

    async function loadVencimientos() {
        try {
            const res = await fetch(`/api/vencimientos?proveedor_id=${proveedorId}&estado=pendiente`)
            const data = await res.json()
            setVencimientosProv(Array.isArray(data) ? data : [])
        } catch (e) {
            console.error(e)
        }
    }

    function agregarMedio(medio: MedioPago["medio"] = "cheque_propio") {
        setMedios(prev => [...prev, {
            id: crypto.randomUUID(),
            medio,
            monto: 0
        }])
    }

    function actualizarMedio(id: string, field: string, value: any) {
        setMedios(medios.map(m => m.id === id ? { ...m, [field]: value } : m))
    }

    function eliminarMedio(id: string) {
        setMedios(medios.filter(m => m.id !== id))
    }

    function toggleImputacionCC(comp: any) {
        const exists = imputaciones.find(i => i.movimiento_cc_id === comp.id)
        if (exists) {
            setImputaciones(imputaciones.filter(i => i.movimiento_cc_id !== comp.id))
        } else {
            setImputaciones([...imputaciones, {
                movimiento_cc_id: comp.id,
                monto_imputado: comp.saldo_pendiente,
                descripcion: comp.numero || comp.tipo
            }])
        }
    }

    function toggleCredito(cred: any) {
        const exists = imputaciones.find(i => i.comprobante_compra_id === cred.id)
        if (exists) {
            setImputaciones(imputaciones.filter(i => i.comprobante_compra_id !== cred.id))
        } else {
            setImputaciones([...imputaciones, {
                comprobante_compra_id: cred.id,
                monto_imputado: -Math.abs(cred.disponible),
                descripcion: `${cred.tipo_comprobante} ${cred.numero_comprobante || ""}`
            }])
        }
    }

    function toggleImputacionVenc(venc: any) {
        const exists = imputaciones.find(i => i.vencimiento_id === venc.id)
        if (exists) {
            setImputaciones(imputaciones.filter(i => i.vencimiento_id !== venc.id))
        } else {
            setImputaciones([...imputaciones, {
                vencimiento_id: venc.id,
                monto_imputado: venc.monto,
                descripcion: venc.concepto
            }])
        }
    }

    const totalMedios = medios.reduce((sum, m) => sum + Number(m.monto || 0), 0)
    const totalRetenciones = retGanancias + retIibb + retIva + retSuss
    const totalImputado = imputaciones.reduce((sum, i) => sum + Number(i.monto_imputado || 0), 0)
    const totalBruto = imputaciones.reduce((sum, i) => sum + Math.max(0, Number(i.monto_imputado || 0)), 0)
    const totalCreditos = imputaciones.reduce((sum, i) => sum + Math.max(0, -Number(i.monto_imputado || 0)), 0)

    // Con imputaciones: los medios deben cubrir el neto (imputado − retenciones)
    const netoObjetivo = totalImputado > 0 ? Math.round((totalImputado - totalRetenciones) * 100) / 100 : null
    const cuadra = netoObjetivo === null || Math.abs(totalMedios - netoObjetivo) <= 0.01
    const restante = netoObjetivo !== null ? Math.round((netoObjetivo - totalMedios) * 100) / 100 : null

    // ── Acuerdo de pago según el canal de lo imputado (Ficha del proveedor) ──
    const selCC = comprobantesCC.filter((c: any) => imputaciones.some(i => i.movimiento_cc_id === c.id))
    const soloNegro = selCC.length > 0 && selCC.every((c: any) => c.tipo_comprobante === "Adquisicion")
    const fp: any = fichaPago || {}
    const hayCfgNegro = fp.pago_negro_medio || fp.pago_negro_dias != null || fp.pago_negro_entrega
    const cfgPago = soloNegro && hayCfgNegro
        ? { medio: fp.pago_negro_medio, plazoCheque: fp.pago_negro_plazo_cheque, entrega: fp.pago_negro_entrega }
        : { medio: fp.pago_blanco_medio, plazoCheque: fp.pago_blanco_plazo_cheque, entrega: fp.pago_blanco_entrega }
    const MEDIO_FICHA: Record<string, string> = {
        transferencia: "Transferencia", cheques: "Cheques", efectivo: "Efectivo",
        cheques_y_efectivo: "Cheques + efectivo",
    }
    const ENTREGA_FICHA: Record<string, string> = {
        transferencia: "por transferencia", deposito_bancario: "lo deposito en su cuenta",
        retira_oficina: "lo retiran por oficina", envio_grimar: "se envía por Grimar",
    }
    const plazoCheque = Number(cfgPago.plazoCheque ?? 0)
    const fichaUsaCheques = cfgPago.medio === "cheques" || cfgPago.medio === "cheques_y_efectivo"

    // ── Cheques de cartera: ventana por fecha + filtro por color ──
    // Al día (plazo 0): solo cheques ya exigibles. A X días: objetivo = fecha
    // OP + X, con umbral de ±5 días.
    const fechaObjetivoCheque = plazoCheque > 0 ? addDiasISO(fecha, plazoCheque) : fecha
    const enVentana = (ch: any) => {
        if (plazoCheque > 0) {
            return ch.fecha_vencimiento >= addDiasISO(fechaObjetivoCheque, -5)
                && ch.fecha_vencimiento <= addDiasISO(fechaObjetivoCheque, 5)
        }
        return ch.fecha_vencimiento <= fecha
    }
    const chequesFiltrados = cheques
        .filter((ch: any) => chequeColorFiltro === "todos" || colorDeCheque(ch) === chequeColorFiltro)
        .filter((ch: any) => chequeVerTodos || enVentana(ch))
        .sort((a: any, b: any) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)) || Number(b.monto) - Number(a.monto))
    const chequesFueraVentana = cheques.filter((ch: any) =>
        (chequeColorFiltro === "todos" || colorDeCheque(ch) === chequeColorFiltro) && !enVentana(ch)).length

    const chequeAMedio = (ch: any): MedioPago => ({
        id: crypto.randomUUID(),
        medio: "cheque",
        monto: Number(ch.monto),
        cheque_id: ch.id,
        cheque_banco: ch.banco,
        cheque_numero: ch.numero,
        cheque_fecha_vencimiento: ch.fecha_vencimiento,
    })
    const toggleCheque = (ch: any) => {
        setMedios(prev => prev.some(m => m.cheque_id === ch.id)
            ? prev.filter(m => m.cheque_id !== ch.id)
            : [...prev, chequeAMedio(ch)])
    }
    // Sugerencia: greedy de mayor a menor sin pasarse del restante
    const sugerirCheques = () => {
        const objetivo = restante ?? 0
        if (objetivo <= 0) return
        const candidatos = chequesFiltrados
            .filter((ch: any) => !medios.some(m => m.cheque_id === ch.id))
            .sort((a: any, b: any) => Number(b.monto) - Number(a.monto))
        let rem = objetivo + 0.009
        const picks: any[] = []
        for (const ch of candidatos) {
            if (Number(ch.monto) <= rem) { picks.push(ch); rem -= Number(ch.monto) }
        }
        if (picks.length === 0) { alert("No hay cheques en la ventana que entren en el monto restante"); return }
        setMedios(prev => [...prev, ...picks.map(chequeAMedio)])
    }

    // ── Bancos y cajas con saldo vivo ──
    const bancosFondos = cuentasFondos.filter((c: any) => c.grupo === "BANCOS")
    const cajasFondos = cuentasFondos.filter((c: any) => c.grupo === "EFECTIVO")
    const saldoTotalDe = (c: any) => Number(c.saldos?.BLANCO ?? 0) + Number(c.saldos?.NEGRO ?? 0)

    const parseMonto = (s: string) => {
        const t = s.trim().replace(",", ".")
        if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null
        return Number(t)
    }
    const agregarTransferencia = () => {
        const cta = bancosFondos.find((b: any) => b.cuenta_id === bancoOrigenSel)
        const m = parseMonto(montoTransfer !== "" ? montoTransfer : String(restante ?? ""))
        if (!cta) { alert("Elegí desde qué banco sale la transferencia"); return }
        if (m === null || m <= 0) { alert("Monto inválido — el punto son centavos: 1000.5 = $1.000,50"); return }
        setMedios(prev => [...prev, {
            id: crypto.randomUUID(),
            medio: "transferencia",
            monto: m,
            cuenta_origen_tipo: "BANCO",
            cuenta_origen_id: cta.cuenta_id,
            banco_destino: proveedorSeleccionado?.banco_nombre || undefined,
            observaciones: `desde ${cta.nombre}`,
        } as any])
        setMontoTransfer("")
    }
    const agregarEfectivo = () => {
        const cta = cajasFondos.find((c: any) => c.cuenta_id === cajaOrigenSel)
        const m = parseMonto(montoEfectivo !== "" ? montoEfectivo : String(restante ?? ""))
        if (!cta) { alert("Elegí de qué caja sale el efectivo"); return }
        if (m === null || m <= 0) { alert("Monto inválido — el punto son centavos: 1000.5 = $1.000,50"); return }
        setMedios(prev => [...prev, {
            id: crypto.randomUUID(),
            medio: "efectivo",
            monto: m,
            cuenta_origen_tipo: "CAJA",
            cuenta_origen_id: cta.cuenta_id,
            observaciones: `desde ${cta.nombre}`,
        } as any])
        setMontoEfectivo("")
    }

    async function handleSubmit() {
        if (!proveedorId) { alert("Seleccioná un proveedor"); return }
        if (medios.length === 0) { alert("Agregá al menos un medio de pago"); return }
        if (totalMedios <= 0) { alert("El total de medios de pago debe ser mayor a 0"); return }
        if (gananciasManual && !gananciasMotivo.trim()) { alert("Indicá el motivo del ajuste manual de la retención"); return }
        if (!cuadra) {
            alert(`No cuadra: imputado ${formatCurrency(totalImputado)} − retenciones ${formatCurrency(totalRetenciones)} = ${formatCurrency(netoObjetivo!)}, pero los medios suman ${formatCurrency(totalMedios)}`)
            return
        }

        setSubmitting(true)
        try {
            const res = await fetch("/api/ordenes-pago", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    proveedor_id: proveedorId,
                    fecha,
                    observaciones,
                    retencion_ganancias: retGanancias,
                    ganancias_manual: gananciasManual,
                    ganancias_motivo: gananciasManual ? gananciasMotivo.trim() : null,
                    retencion_iibb: retIibb,
                    retencion_iva: retIva,
                    retencion_suss: retSuss,
                    medios_pago: medios.map(m => ({
                        medio: m.medio,
                        monto: m.monto,
                        cheque_id: m.cheque_id || null,
                        cheque_banco: m.cheque_banco || null,
                        cheque_numero: m.cheque_numero || null,
                        cheque_fecha_vencimiento: m.cheque_fecha_vencimiento || null,
                        banco_destino: m.banco_destino || null,
                        numero_transferencia: m.numero_transferencia || null,
                        fecha_transferencia: m.fecha_transferencia || null,
                        cbu: m.cbu || null,
                        observaciones: m.observaciones || null,
                        cuenta_origen_tipo: m.cuenta_origen_tipo || null,
                        cuenta_origen_id: m.cuenta_origen_id || null
                    })),
                    imputaciones: imputaciones.map(i => ({
                        movimiento_cc_id: i.movimiento_cc_id || null,
                        vencimiento_id: i.vencimiento_id || null,
                        comprobante_compra_id: i.comprobante_compra_id || null,
                        monto_imputado: i.monto_imputado
                    }))
                })
            })

            if (!res.ok) {
                const err = await res.json()
                alert(err.error || "Error al crear la orden")
                return
            }

            router.push("/ordenes-pago")
        } catch (e: any) {
            alert(e.message || "Error")
        } finally {
            setSubmitting(false)
        }
    }

    const proveedorSeleccionado = proveedores.find(p => p.id === proveedorId)

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/ordenes-pago">
                            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Nueva Orden de Pago</h1>
                            <p className="text-sm text-muted-foreground">Crear pago a proveedor con medios mixtos</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8 space-y-6 max-w-4xl">
                {/* Proveedor y fecha */}
                <Card>
                    <CardHeader><CardTitle className="text-lg">Datos Generales</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Proveedor *</Label>
                                <EntitySearchSelect
                                    entity="proveedores"
                                    placeholder="Seleccionar proveedor..."
                                    value={proveedorId ? ((proveedores.find((p: any) => p.id === proveedorId) as any) ?? null) : null}
                                    onSelect={(p: any) => setProveedorId(p ? p.id : "")}
                                />
                            </div>
                            <div>
                                <Label>Fecha</Label>
                                <Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
                            </div>
                        </div>
                        <div>
                            <Label>Observaciones</Label>
                            <Textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} rows={2} />
                        </div>
                    </CardContent>
                </Card>

                {/* Imputaciones - qué se paga */}
                {proveedorId && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileText className="h-5 w-5" /> ¿Qué se paga? (opcional)
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                Seleccioná los comprobantes o vencimientos que cubre este pago
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {comprobantesCC.length > 0 && (
                                <div>
                                    <h4 className="font-medium text-sm mb-2">Comprobantes pendientes</h4>
                                    <div className="space-y-2">
                                        {comprobantesCC.map((c: any) => (
                                            <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer"
                                                onClick={() => toggleImputacionCC(c)}>
                                                <Checkbox checked={!!imputaciones.find(i => i.movimiento_cc_id === c.id)} />
                                                <div className="flex-1">
                                                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${c.tipo_comprobante ? claseTipo(c.tipo_comprobante) : "bg-muted text-muted-foreground"}`}>
                                                        {etiquetaTipo(c.tipo_comprobante, c.tipo)}
                                                    </span>
                                                    <span className="text-sm text-muted-foreground ml-2">{c.numero}</span>
                                                    {c.vencimiento && (
                                                        <span className="text-xs text-muted-foreground ml-2">
                                                            Vence: {new Date(c.vencimiento + "T00:00:00").toLocaleDateString("es-AR")}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-sm font-medium">{formatCurrency(c.saldo_pendiente)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {creditos.length > 0 && (
                                <div>
                                    <h4 className="font-medium text-sm mb-2 text-emerald-700">Créditos disponibles (NC / Reversas) — restan del pago</h4>
                                    <div className="space-y-2">
                                        {creditos.map((c: any) => (
                                            <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 cursor-pointer"
                                                onClick={() => toggleCredito(c)}>
                                                <Checkbox checked={!!imputaciones.find(i => i.comprobante_compra_id === c.id)} />
                                                <div className="flex-1">
                                                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${claseTipo(c.tipo_comprobante)}`}>
                                                        {etiquetaTipo(c.tipo_comprobante)}
                                                    </span>
                                                    <span className="text-sm text-muted-foreground ml-2">{c.numero_comprobante}</span>
                                                    {!c.es_fiscal && (
                                                        <span className="text-[10px] font-bold text-slate-500 ml-2 uppercase">reversa — no afecta retención</span>
                                                    )}
                                                </div>
                                                <span className="text-sm font-medium text-emerald-700">− {formatCurrency(c.disponible)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {imputaciones.length > 0 && (
                                <div className="pt-2 border-t text-sm space-x-4">
                                    <span>Bruto: <b>{formatCurrency(totalBruto)}</b></span>
                                    {totalCreditos > 0 && <span className="text-emerald-700">Créditos: <b>− {formatCurrency(totalCreditos)}</b></span>}
                                    <span>Imputado neto de NC: <b>{formatCurrency(totalImputado)}</b></span>
                                </div>
                            )}
                            {comprobantesCC.length === 0 && (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                    No hay comprobantes pendientes para este proveedor.
                                    Podés crear la orden sin imputar.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* ¿Cómo se paga? — guiado por el acuerdo de pago de la ficha */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <CreditCard className="h-5 w-5" /> ¿Cómo se paga?
                            </CardTitle>
                            {restante !== null && (
                                <span className={`text-sm font-bold px-3 py-1 rounded-full ${Math.abs(restante) <= 0.01 ? "bg-green-100 text-green-700" : restante > 0 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                                    {Math.abs(restante) <= 0.01 ? "✓ Cubierto" : restante > 0 ? `Faltan ${formatCurrency(restante)}` : `Sobran ${formatCurrency(-restante)}`}
                                </span>
                            )}
                        </div>
                        {proveedorId && (cfgPago.medio || cfgPago.entrega) && (
                            <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-3 py-1.5 mt-1">
                                Según la ficha {soloNegro && hayCfgNegro ? "(canal negro)" : ""}: <b>{MEDIO_FICHA[cfgPago.medio] ?? "sin medio configurado"}</b>
                                {fichaUsaCheques ? (plazoCheque > 0 ? ` a ${plazoCheque} días` : " al día") : ""}
                                {cfgPago.entrega ? ` · ${ENTREGA_FICHA[cfgPago.entrega] ?? cfgPago.entrega}` : ""}
                            </p>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {([
                            fichaUsaCheques ? "cheques" : cfgPago.medio === "transferencia" ? "transferencia" : cfgPago.medio === "efectivo" ? "efectivo" : "cheques",
                        ].concat(["cheques", "transferencia", "efectivo"]).filter((v, i, a) => a.indexOf(v) === i) as string[]).map(panel => {
                            if (panel === "cheques") return (
                                <div key="cheques" className={`border rounded-lg p-3 ${fichaUsaCheques ? "border-indigo-300 bg-indigo-50/30" : ""}`}>
                                    <div className="flex items-center gap-2 flex-wrap mb-2">
                                        <h4 className="text-sm font-bold text-slate-700">CHEQUES DE CARTERA</h4>
                                        {fichaUsaCheques && <Badge className="bg-indigo-600">según ficha</Badge>}
                                        <span className="text-xs text-muted-foreground">
                                            {plazoCheque > 0
                                                ? `objetivo ${fmtFechaCorta(fechaObjetivoCheque)} (±5 días)`
                                                : `al día — vencidos hasta ${fmtFechaCorta(fecha)}`}
                                        </span>
                                        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                                            disabled={restante === null || restante <= 0} onClick={sugerirCheques}>
                                            ⚡ Sugerir cheques por {restante !== null && restante > 0 ? formatCurrency(restante) : "—"}
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                        {["todos", "BLANCO", "NEGRO", "ECHEQ"].map(k => (
                                            <button key={k} onClick={() => setChequeColorFiltro(k)}
                                                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${chequeColorFiltro === k ? "bg-white border-slate-400 shadow-sm" : "border-slate-200 text-slate-400"}`}>
                                                {k !== "todos" && <span className="h-2 w-2 rounded-full border border-slate-300" style={{ background: COLOR_CHEQUE[k]?.dot }} />}
                                                {k === "todos" ? "Todos" : COLOR_CHEQUE[k]?.label}
                                            </button>
                                        ))}
                                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-auto">
                                            <input type="checkbox" className="h-3.5 w-3.5" checked={chequeVerTodos} onChange={e => setChequeVerTodos(e.target.checked)} />
                                            Ver fuera de ventana ({chequesFueraVentana})
                                        </label>
                                    </div>
                                    {chequesFiltrados.length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center py-3">
                                            No hay cheques en cartera {chequeVerTodos ? "" : "dentro de la ventana de fechas"}.
                                        </p>
                                    ) : (
                                        <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                                            {chequesFiltrados.map((ch: any) => {
                                                const sel = medios.some(m => m.cheque_id === ch.id)
                                                const col = colorDeCheque(ch)
                                                return (
                                                    <div key={ch.id} onClick={() => toggleCheque(ch)}
                                                        className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm cursor-pointer transition-colors ${sel ? "border-indigo-400 bg-indigo-50" : "bg-white hover:border-indigo-200"}`}>
                                                        <Checkbox checked={sel} />
                                                        <span className="h-2.5 w-2.5 rounded-full border border-slate-300 shrink-0" style={{ background: COLOR_CHEQUE[col]?.dot }} />
                                                        <span className="font-medium text-slate-700 truncate">{ch.banco} #{ch.numero}</span>
                                                        <span className="text-xs text-muted-foreground shrink-0">vence {fmtFechaCorta(ch.fecha_vencimiento)}</span>
                                                        <span className="ml-auto font-semibold tabular-nums shrink-0">{formatCurrency(Number(ch.monto))}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                            if (panel === "transferencia") return (
                                <div key="transferencia" className={`border rounded-lg p-3 ${cfgPago.medio === "transferencia" ? "border-indigo-300 bg-indigo-50/30" : ""}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <Building2 className="h-4 w-4 text-slate-500" />
                                        <h4 className="text-sm font-bold text-slate-700">TRANSFERENCIA</h4>
                                        {cfgPago.medio === "transferencia" && <Badge className="bg-indigo-600">según ficha</Badge>}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-2">
                                        {bancosFondos.map((b: any) => (
                                            <button key={b.cuenta_id} onClick={() => setBancoOrigenSel(b.cuenta_id === bancoOrigenSel ? "" : b.cuenta_id)}
                                                className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition-colors ${bancoOrigenSel === b.cuenta_id ? "border-indigo-400 bg-indigo-50 font-semibold" : "bg-white hover:border-indigo-200"}`}>
                                                <span>{b.nombre}</span>
                                                <span className="text-xs tabular-nums text-muted-foreground">saldo <b className="text-slate-700">{formatCurrency(saldoTotalDe(b))}</b></span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Input inputMode="decimal" className="w-40 tabular-nums" placeholder={restante !== null && restante > 0 ? String(restante) : "monto"}
                                            value={montoTransfer} onChange={e => setMontoTransfer(e.target.value)} />
                                        <span className="text-[11px] text-muted-foreground">punto = centavos</span>
                                        <Button size="sm" variant="outline" className="ml-auto" disabled={!bancoOrigenSel} onClick={agregarTransferencia}>
                                            <Plus className="h-4 w-4 mr-1" /> Agregar transferencia
                                        </Button>
                                    </div>
                                </div>
                            )
                            return (
                                <div key="efectivo" className={`border rounded-lg p-3 ${cfgPago.medio === "efectivo" ? "border-indigo-300 bg-indigo-50/30" : ""}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <Banknote className="h-4 w-4 text-slate-500" />
                                        <h4 className="text-sm font-bold text-slate-700">EFECTIVO</h4>
                                        {(cfgPago.medio === "efectivo" || cfgPago.medio === "cheques_y_efectivo") && <Badge className="bg-indigo-600">según ficha</Badge>}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-2">
                                        {cajasFondos.map((c: any) => (
                                            <button key={c.cuenta_id} onClick={() => setCajaOrigenSel(c.cuenta_id === cajaOrigenSel ? "" : c.cuenta_id)}
                                                className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition-colors ${cajaOrigenSel === c.cuenta_id ? "border-indigo-400 bg-indigo-50 font-semibold" : "bg-white hover:border-indigo-200"}`}>
                                                <span>{c.nombre}</span>
                                                <span className="text-xs tabular-nums text-muted-foreground">saldo <b className="text-slate-700">{formatCurrency(saldoTotalDe(c))}</b></span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Input inputMode="decimal" className="w-40 tabular-nums" placeholder={restante !== null && restante > 0 ? String(restante) : "monto"}
                                            value={montoEfectivo} onChange={e => setMontoEfectivo(e.target.value)} />
                                        <span className="text-[11px] text-muted-foreground">punto = centavos</span>
                                        <Button size="sm" variant="outline" className="ml-auto" disabled={!cajaOrigenSel} onClick={agregarEfectivo}>
                                            <Plus className="h-4 w-4 mr-1" /> Agregar efectivo
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}

                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={() => agregarMedio("cheque_propio")} className="text-muted-foreground gap-1.5">
                                <Plus className="h-4 w-4" /> Cheque propio
                            </Button>
                            <span className="text-[11px] text-muted-foreground">
                                Si al proveedor se le deposita, la entrega ya lo dice la ficha — el pago se arma igual con cheques/efectivo.
                            </span>
                        </div>

                        {/* Pago armado */}
                        {medios.length > 0 && (
                            <div className="border-t pt-3 space-y-2">
                                <h4 className="text-xs font-bold text-slate-500 tracking-wide">PAGO ARMADO</h4>
                                {medios.map((m) => (
                                    <div key={m.id} className="flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm">
                                        {m.medio === "cheque" ? (
                                            <>
                                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">CHEQUE</Badge>
                                                <span className="text-slate-700 truncate">{m.cheque_banco} #{m.cheque_numero}</span>
                                                <span className="text-xs text-muted-foreground">vence {fmtFechaCorta(m.cheque_fecha_vencimiento)}</span>
                                                <span className="ml-auto font-semibold tabular-nums">{formatCurrency(Number(m.monto))}</span>
                                            </>
                                        ) : m.medio === "cheque_propio" ? (
                                            <>
                                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">CH. PROPIO</Badge>
                                                <Input className="h-7 w-28 text-xs" placeholder="Banco" value={m.cheque_banco || ""} onChange={e => actualizarMedio(m.id, "cheque_banco", e.target.value)} />
                                                <Input className="h-7 w-24 text-xs" placeholder="Número" value={m.cheque_numero || ""} onChange={e => actualizarMedio(m.id, "cheque_numero", e.target.value)} />
                                                <Input className="h-7 w-32 text-xs" type="date" value={m.cheque_fecha_vencimiento || ""} onChange={e => actualizarMedio(m.id, "cheque_fecha_vencimiento", e.target.value)} />
                                                <Input className="h-7 w-28 text-right text-xs tabular-nums ml-auto" type="number" step="0.01" value={m.monto} onChange={e => actualizarMedio(m.id, "monto", parseFloat(e.target.value) || 0)} />
                                            </>
                                        ) : (
                                            <>
                                                <Badge className={m.medio === "efectivo" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-sky-100 text-sky-800 hover:bg-sky-100"}>
                                                    {m.medio === "efectivo" ? "EFECTIVO" : m.medio === "deposito" ? "DEPÓSITO" : "TRANSFERENCIA"}
                                                </Badge>
                                                <span className="text-slate-600 text-xs truncate">{m.observaciones || m.banco_destino || ""}</span>
                                                {m.medio === "deposito" && (
                                                    <Input className="h-7 w-28 text-xs" placeholder="Banco destino" value={m.banco_destino || ""} onChange={e => actualizarMedio(m.id, "banco_destino", e.target.value)} />
                                                )}
                                                <Input className="h-7 w-28 text-right text-xs tabular-nums ml-auto" type="number" step="0.01" value={m.monto} onChange={e => actualizarMedio(m.id, "monto", parseFloat(e.target.value) || 0)} />
                                            </>
                                        )}
                                        <Button variant="ghost" size="sm" onClick={() => eliminarMedio(m.id)} className="text-red-600 hover:bg-red-50 h-7 w-7 p-0 shrink-0">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                                <div className="pt-2 border-t text-right space-x-4">
                                    <span className="text-sm font-medium">Total del pago: </span>
                                    <span className="text-lg font-bold tabular-nums">{formatCurrency(totalMedios)}</span>
                                    {restante !== null && Math.abs(restante) > 0.01 && (
                                        <span className={`text-sm font-bold ${restante > 0 ? "text-amber-700" : "text-red-600"}`}>
                                            {restante > 0 ? `faltan ${formatCurrency(restante)}` : `sobran ${formatCurrency(-restante)}`}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        {medios.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-2">
                                Elegí cheques, o agregá una transferencia o efectivo — se pueden combinar.
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Retención de Ganancias RG 830 — calculada */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">
                            Retención de Ganancias (RG 830) {calcLoading && <span className="text-xs text-muted-foreground font-normal">calculando…</span>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {!proveedorId ? (
                            <p className="text-sm text-muted-foreground">Elegí el proveedor para calcular.</p>
                        ) : calcGanancias?.error ? (
                            <p className="text-sm text-red-600">{calcGanancias.error}</p>
                        ) : !calcGanancias ? (
                            <p className="text-sm text-muted-foreground">Sin datos todavía.</p>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                    <div>
                                        <p className="text-xs text-muted-foreground">Régimen · condición</p>
                                        <p className="font-medium capitalize">{calcGanancias.regimen} · {String(calcGanancias.condicion).replace("_", " ")} ({Number(calcGanancias.alicuota)}%)</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Base de este pago (neto)</p>
                                        <p className="font-medium tabular-nums">{formatCurrency(Number(calcGanancias.base ?? 0))}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Acumulado del mes (c/este pago)</p>
                                        <p className="font-medium tabular-nums">{formatCurrency(Number(calcGanancias.acumulado_total_mes ?? 0))} <span className="text-xs text-muted-foreground">/ mín. {formatCurrency(Number(calcGanancias.minimo_no_sujeto ?? 0))}</span></p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Retenido antes en el mes</p>
                                        <p className="font-medium tabular-nums">{formatCurrency(Number(calcGanancias.retenido_previo_mes ?? 0))}</p>
                                    </div>
                                </div>
                                {(calcGanancias.bases_detalle ?? []).some((b: any) => b.tipo === "estimada") && (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                                        Alguna imputación no tiene factura validada: su base se estimó como monto ÷ 1,21.
                                    </p>
                                )}
                                {calcGanancias.motivo_sin_retencion && Number(retGanancias) === 0 && !gananciasManual && (
                                    <p className="text-xs text-muted-foreground">No se retiene: {calcGanancias.motivo_sin_retencion}.</p>
                                )}
                                <div className="flex items-center gap-3 pt-2 border-t flex-wrap">
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground">Retención a practicar</p>
                                        {gananciasManual ? (
                                            <Input type="number" step="0.01" className="w-36 text-right font-bold" value={retGanancias}
                                                onChange={e => setRetGanancias(parseFloat(e.target.value) || 0)} />
                                        ) : (
                                            <p className="text-xl font-bold text-orange-600 tabular-nums">{formatCurrency(retGanancias)}</p>
                                        )}
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer ml-auto">
                                        <input type="checkbox" className="h-3.5 w-3.5" checked={gananciasManual}
                                            onChange={e => {
                                                setGananciasManual(e.target.checked)
                                                if (!e.target.checked) setRetGanancias(Number(calcGanancias?.retencion ?? 0))
                                            }} />
                                        Ajustar manualmente (queda auditado)
                                    </label>
                                    {gananciasManual && (
                                        <Input className="w-full" placeholder="Motivo del ajuste (obligatorio)"
                                            value={gananciasMotivo} onChange={e => setGananciasMotivo(e.target.value)} />
                                    )}
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Resumen y confirmar */}
                <Card className="border-2 border-primary/20">
                    <CardContent className="p-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                            <div>
                                <p className="text-sm text-muted-foreground">Total Bruto {totalBruto > 0 ? "(imputado)" : ""}</p>
                                <p className="text-xl font-bold">{formatCurrency(totalBruto > 0 ? totalBruto : totalMedios + totalRetenciones)}</p>
                                {totalCreditos > 0 && (
                                    <p className="text-xs font-semibold text-emerald-700">− NC/Reversas {formatCurrency(totalCreditos)}</p>
                                )}
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Retención Ganancias</p>
                                <p className="text-xl font-bold text-orange-600">{formatCurrency(totalRetenciones)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Neto a Pagar</p>
                                <p className="text-2xl font-bold text-green-600">{formatCurrency(netoObjetivo ?? totalMedios)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Medios cargados</p>
                                <p className={`text-xl font-bold ${cuadra ? "text-green-600" : "text-red-600"}`}>{formatCurrency(totalMedios)}</p>
                                {!cuadra && netoObjetivo !== null && (
                                    <p className="text-xs text-red-600 font-semibold">
                                        {totalMedios > netoObjetivo ? "sobran" : "faltan"} {formatCurrency(Math.abs(totalMedios - netoObjetivo))}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6 justify-end">
                            <Link href="/ordenes-pago">
                                <Button variant="outline">Cancelar</Button>
                            </Link>
                            <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
                                <DollarSign className="h-4 w-4" />
                                {submitting ? "Creando..." : "Crear Orden de Pago"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </main>
        </div>
    )
}
