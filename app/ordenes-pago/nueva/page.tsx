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

    // Retenciones
    const [retGanancias, setRetGanancias] = useState(0)
    const [retIibb, setRetIibb] = useState(0)
    const [retIva, setRetIva] = useState(0)
    const [retSuss, setRetSuss] = useState(0)

    // Medios de pago
    const [medios, setMedios] = useState<MedioPago[]>([])

    // Imputaciones (comprobantes/vencimientos a cubrir)
    const [imputaciones, setImputaciones] = useState<Imputacion[]>([])
    const [comprobantesCC, setComprobantesCC] = useState<any[]>([])
    const [vencimientosProv, setVencimientosProv] = useState<any[]>([])

    const [cheques, setCheques] = useState<any[]>([])
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        loadProveedores()
        loadCheques()
    }, [])

    useEffect(() => {
        if (proveedorId) {
            loadComprobantesCC()
            loadVencimientos()
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

    async function handleSubmit() {
        if (!proveedorId) { alert("Seleccioná un proveedor"); return }
        if (medios.length === 0) { alert("Agregá al menos un medio de pago"); return }
        if (totalMedios <= 0) { alert("El total de medios de pago debe ser mayor a 0"); return }

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
                                <Select value={proveedorId} onValueChange={setProveedorId}>
                                    <SelectTrigger><SelectValue placeholder="Seleccionar proveedor" /></SelectTrigger>
                                    <SelectContent>
                                        {proveedores.map(p => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.sigla ? `${p.sigla} - ${p.nombre}` : p.nombre}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
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
                                    <h4 className="font-medium text-sm mb-2">Comprobantes pendientes en Cuenta Corriente</h4>
                                    <div className="space-y-2">
                                        {comprobantesCC.map((c: any) => (
                                            <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer"
                                                onClick={() => toggleImputacionCC(c)}>
                                                <Checkbox checked={!!imputaciones.find(i => i.movimiento_cc_id === c.id)} />
                                                <div className="flex-1">
                                                    <span className="text-sm font-medium">{c.tipo}</span>
                                                    <span className="text-sm text-muted-foreground ml-2">{c.numero}</span>
                                                </div>
                                                <span className="text-sm font-medium">{formatCurrency(c.saldo_pendiente)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {vencimientosProv.length > 0 && (
                                <div>
                                    <h4 className="font-medium text-sm mb-2">Vencimientos pendientes</h4>
                                    <div className="space-y-2">
                                        {vencimientosProv.map((v: any) => (
                                            <div key={v.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer"
                                                onClick={() => toggleImputacionVenc(v)}>
                                                <Checkbox checked={!!imputaciones.find(i => i.vencimiento_id === v.id)} />
                                                <div className="flex-1">
                                                    <span className="text-sm font-medium">{v.concepto}</span>
                                                    <span className="text-sm text-muted-foreground ml-2">
                                                        Vence: {new Date(v.fecha_vencimiento + "T00:00:00").toLocaleDateString("es-AR")}
                                                    </span>
                                                </div>
                                                <span className="text-sm font-medium">{formatCurrency(v.monto)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {imputaciones.length > 0 && (
                                <div className="pt-2 border-t">
                                    <span className="text-sm font-medium">Total imputado: </span>
                                    <span className="text-sm font-bold">{formatCurrency(totalImputado)}</span>
                                </div>
                            )}
                            {comprobantesCC.length === 0 && vencimientosProv.length === 0 && (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                    No hay comprobantes ni vencimientos pendientes para este proveedor.
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

                {/* Retenciones */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Retenciones (opcional)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <Label>Ret. Ganancias</Label>
                                <Input type="number" step="0.01" value={retGanancias}
                                    onChange={e => setRetGanancias(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div>
                                <Label>Ret. IIBB</Label>
                                <Input type="number" step="0.01" value={retIibb}
                                    onChange={e => setRetIibb(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div>
                                <Label>Ret. IVA</Label>
                                <Input type="number" step="0.01" value={retIva}
                                    onChange={e => setRetIva(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div>
                                <Label>Ret. SUSS</Label>
                                <Input type="number" step="0.01" value={retSuss}
                                    onChange={e => setRetSuss(parseFloat(e.target.value) || 0)} />
                            </div>
                        </div>
                        {totalRetenciones > 0 && (
                            <div className="pt-3 mt-3 border-t text-right">
                                <span className="text-sm font-medium">Total retenciones: </span>
                                <span className="text-sm font-bold">{formatCurrency(totalRetenciones)}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Resumen y confirmar */}
                <Card className="border-2 border-primary/20">
                    <CardContent className="p-6">
                        <div className="grid grid-cols-3 gap-6 text-center">
                            <div>
                                <p className="text-sm text-muted-foreground">Total Bruto</p>
                                <p className="text-xl font-bold">{formatCurrency(totalMedios + totalRetenciones)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Retenciones</p>
                                <p className="text-xl font-bold text-orange-600">{formatCurrency(totalRetenciones)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Neto a Pagar</p>
                                <p className="text-2xl font-bold text-green-600">{formatCurrency(totalMedios)}</p>
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
