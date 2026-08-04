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
}

interface Imputacion {
    movimiento_cc_id?: string
    vencimiento_id?: string
    comprobante_compra_id?: string
    monto_imputado: number
    descripcion: string
}

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

    useEffect(() => {
        loadProveedores()
        loadCheques()
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

    function agregarMedio() {
        setMedios([...medios, {
            id: crypto.randomUUID(),
            medio: "transferencia",
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
                        observaciones: m.observaciones || null
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
                                                    <span className="text-sm font-medium">{c.tipo}</span>
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
                                                    <span className="text-sm font-medium">{c.tipo_comprobante}</span>
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

                {/* Medios de pago */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <CreditCard className="h-5 w-5" /> Medios de Pago
                            </CardTitle>
                            <Button variant="outline" size="sm" onClick={agregarMedio} className="gap-2">
                                <Plus className="h-4 w-4" /> Agregar
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {medios.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                Agregá al menos un medio de pago
                            </p>
                        )}
                        {medios.map((m, idx) => (
                            <div key={m.id} className="border rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <Badge variant="outline">Medio #{idx + 1}</Badge>
                                    <Button variant="ghost" size="sm" onClick={() => eliminarMedio(m.id)}
                                        className="text-red-600 hover:bg-red-50">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Tipo *</Label>
                                        <Select value={m.medio} onValueChange={v => actualizarMedio(m.id, "medio", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="efectivo">Efectivo</SelectItem>
                                                <SelectItem value="cheque">Cheque (de cartera)</SelectItem>
                                                <SelectItem value="cheque_propio">Cheque Propio</SelectItem>
                                                <SelectItem value="transferencia">Transferencia</SelectItem>
                                                <SelectItem value="deposito">Depósito</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label>Monto *</Label>
                                        <Input type="number" step="0.01" value={m.monto}
                                            onChange={e => actualizarMedio(m.id, "monto", parseFloat(e.target.value) || 0)} />
                                    </div>
                                </div>

                                {/* Campos específicos por tipo */}
                                {m.medio === "cheque" && (
                                    <div>
                                        <Label>Cheque de cartera</Label>
                                        <Select value={m.cheque_id || ""} onValueChange={v => {
                                            const ch = cheques.find(c => c.id === v)
                                            actualizarMedio(m.id, "cheque_id", v)
                                            if (ch) actualizarMedio(m.id, "monto", ch.monto)
                                        }}>
                                            <SelectTrigger><SelectValue placeholder="Seleccionar cheque" /></SelectTrigger>
                                            <SelectContent>
                                                {cheques.map(ch => (
                                                    <SelectItem key={ch.id} value={ch.id}>
                                                        {ch.banco} #{ch.numero} - {formatCurrency(ch.monto)} - Vence: {ch.fecha_vencimiento}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {m.medio === "cheque_propio" && (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <Label>Banco</Label>
                                            <Input value={m.cheque_banco || ""}
                                                onChange={e => actualizarMedio(m.id, "cheque_banco", e.target.value)} />
                                        </div>
                                        <div>
                                            <Label>Número</Label>
                                            <Input value={m.cheque_numero || ""}
                                                onChange={e => actualizarMedio(m.id, "cheque_numero", e.target.value)} />
                                        </div>
                                        <div>
                                            <Label>Vencimiento</Label>
                                            <Input type="date" value={m.cheque_fecha_vencimiento || ""}
                                                onChange={e => actualizarMedio(m.id, "cheque_fecha_vencimiento", e.target.value)} />
                                        </div>
                                    </div>
                                )}

                                {(m.medio === "transferencia" || m.medio === "deposito") && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <Label>Banco destino</Label>
                                            <Input value={m.banco_destino || proveedorSeleccionado?.banco_nombre || ""}
                                                onChange={e => actualizarMedio(m.id, "banco_destino", e.target.value)} />
                                        </div>
                                        <div>
                                            <Label>N° Transferencia / Comprobante</Label>
                                            <Input value={m.numero_transferencia || ""}
                                                onChange={e => actualizarMedio(m.id, "numero_transferencia", e.target.value)} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {medios.length > 0 && (
                            <div className="pt-3 border-t text-right">
                                <span className="text-sm font-medium">Total medios: </span>
                                <span className="text-lg font-bold">{formatCurrency(totalMedios)}</span>
                            </div>
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
