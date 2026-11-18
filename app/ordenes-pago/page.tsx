"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Plus, DollarSign, CheckCircle2, FileText, Receipt, Trash2, Undo2 } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useMisRoles } from "@/lib/hooks/useMisRoles"
import { formatCurrency } from "@/lib/utils"
import { fecha, hoyISO, moneda, sumarDiasISO } from "@/lib/formato"
import { useRealtime } from "@/lib/hooks/use-realtime"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"

export default function OrdenesPagoPage() {
    const [ordenes, setOrdenes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [filtroEstado, setFiltroEstado] = useState("todos")
    const [mesExport, setMesExport] = useState(hoyISO().slice(0, 7))
    const [eligeCuenta, setEligeCuenta] = useState<{ opId: string; bancos: any[] } | null>(null)
    // Confirmar / anular / eliminar piden confirmación con un diálogo del sistema (no confirm() nativo)
    const [dialogo, setDialogo] = useState<{ tipo: "confirmar" | "anular" | "eliminar"; op: any } | null>(null)
    const [motivoAnular, setMotivoAnular] = useState("")
    // E-57: qué retención corresponde HOY para la orden que se está por confirmar
    const [retHoy, setRetHoy] = useState<any>(null)
    const [retCargando, setRetCargando] = useState(false)
    const [trabajando, setTrabajando] = useState(false)
    // Si el usuario ya vio y aceptó la retención nueva (se conserva si hay que elegir la cuenta bancaria)
    const aceptaRetRef = useRef(false)
    // E-61: hasta qué día están presentadas ante ARCA las retenciones (cierra el período)
    const [presentadoHasta, setPresentadoHasta] = useState<string | null>(null)
    const [puedePresentar, setPuedePresentar] = useState(false)
    const [confirmaPresentar, setConfirmaPresentar] = useState(false)
    const cargarPresentado = () => fetch("/api/retenciones/export?formato=estado&desde=2000-01-01&hasta=2000-01-01")
        .then(r => r.json()).then(d => { setPresentadoHasta(d?.presentado_hasta ?? null); setPuedePresentar(d?.disponible === true) }).catch(() => {})
    useEffect(() => { cargarPresentado() }, [])
    async function marcarPresentado() {
        setConfirmaPresentar(false)
        try {
            const res = await fetch("/api/retenciones/export", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ desde: `${mesExport}-01`, hasta: finDeMes(mesExport) }),
            })
            const d = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(d.error || "No se pudo marcar el período", { duration: 10000 }); return }
            toast.success(d.ya_estaba ? "Ese período ya estaba marcado como presentado." : "Período marcado como presentado ante ARCA.")
            cargarPresentado()
        } catch (e: any) { toast.error(e?.message || "No se pudo marcar el período") }
    }
    // Lo que mueve plata (confirmar, anular, eliminar una pagada) es solo de admin; el servidor lo vuelve a controlar
    const { esAdmin } = useMisRoles()

    const finDeMes = (ym: string) => {
        const [y, m] = ym.split("-").map(Number)
        const primeroSiguiente = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
        return sumarDiasISO(primeroSiguiente, -1)
    }
    // Últimos 24 meses para el selector (se muestran mm/aaaa; el valor es "AAAA-MM")
    const mesesExport = (() => {
        const [y0, m0] = hoyISO().slice(0, 7).split("-").map(Number)
        return Array.from({ length: 24 }, (_, i) => {
            const t = y0 * 12 + (m0 - 1) - i
            const y = Math.floor(t / 12), m = (t % 12) + 1
            return { v: `${y}-${String(m).padStart(2, "0")}`, l: `${String(m).padStart(2, "0")}/${y}` }
        })
    })()

    useEffect(() => { loadOrdenes() }, [filtroEstado])
    // En vivo: OPs creadas/confirmadas desde otra PC
    useRealtime(["ordenes_pago"], () => loadOrdenes(true))

    async function loadOrdenes(silencioso = false) {
        if (!silencioso) setLoading(true)
        try {
            const res = await fetch(`/api/ordenes-pago?estado=${filtroEstado}`)
            const data = await res.json()
            if (!res.ok && !silencioso) toast.error(data?.error || "No se pudieron cargar las órdenes de pago")
            setOrdenes(Array.isArray(data) ? data : [])
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    async function confirmarOP(id: string, cuentaBancariaId?: string, aceptarRetencion = aceptaRetRef.current) {
        if (trabajando) return
        setTrabajando(true)
        aceptaRetRef.current = aceptarRetencion
        try {
            const res = await fetch(`/api/ordenes-pago/${id}/confirmar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...(cuentaBancariaId ? { cuenta_bancaria_id: cuentaBancariaId } : {}), ...(aceptarRetencion ? { aceptar_retencion: true } : {}) }),
            })
            const d = await res.json()
            if (!res.ok) {
                // La OP incluye transferencias: pedir la cuenta de origen y reintentar
                if (String(d.error || "").includes("cuenta bancaria")) {
                    const r = await fetch("/api/finanzas/cajas")
                    const cj = await r.json()
                    const bancos = (cj.cuentas || []).filter((c: any) => c.cuenta_tipo === "BANCO")
                    setEligeCuenta({ opId: id, bancos })
                    return
                }
                toast.error(d.error || "No se pudo confirmar la orden de pago", { duration: 12000 })
                return
            }
            if (d.numero_certificado) {
                toast.success(`Orden de pago confirmada. Se emitió el certificado de retención N° ${d.numero_certificado}: se baja con el botón naranja.`, { duration: 10000 })
            } else {
                toast.success("Orden de pago confirmada.")
            }
            loadOrdenes()
        } catch (e: any) {
            console.error(e)
            toast.error(e?.message || "No se pudo confirmar la orden de pago")
        } finally {
            setTrabajando(false)
        }
    }

    async function anularOP(op: any, motivo: string) {
        if (trabajando) return
        setTrabajando(true)
        try {
            const res = await fetch(`/api/ordenes-pago/${op.id}/anular`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ motivo }),
            })
            const d = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(d.error || "No se pudo anular la orden de pago", { duration: 12000 }); return }
            toast.success(`Orden de pago ${op.numero_op} anulada. Se revirtió todo y queda en el listado como Anulada.`)
            loadOrdenes()
        } catch (e: any) {
            console.error(e)
            toast.error(e?.message || "No se pudo anular la orden de pago")
        } finally {
            setTrabajando(false)
        }
    }

    async function eliminarOP(op: any) {
        if (trabajando) return
        setTrabajando(true)
        try {
            const res = await fetch(`/api/ordenes-pago/${op.id}/eliminar`, { method: "POST" })
            const d = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(d.error || "No se pudo eliminar la orden de pago", { duration: 12000 }); return }
            const libs = [
                d.numero_op_liberado ? `N° de OP ${op.numero_op} liberado` : null,
                d.certificado_liberado ? `N° de certificado liberado` : null,
            ].filter(Boolean)
            toast.success(`Orden de pago eliminada.${libs.length ? " " + libs.join(" · ") + "." : ""}`)
            loadOrdenes()
        } catch (e: any) {
            console.error(e)
            toast.error(e?.message || "No se pudo eliminar la orden de pago")
        } finally {
            setTrabajando(false)
        }
    }

    function abrirDialogo(tipo: "confirmar" | "anular" | "eliminar", op: any) {
        setMotivoAnular("")
        setDialogo({ tipo, op })
        setRetHoy(null)
        aceptaRetRef.current = false
        if (tipo === "confirmar") {
            setRetCargando(true)
            fetch(`/api/ordenes-pago/${op.id}/confirmar`).then(r => r.json())
                .then(d => setRetHoy(d?.error ? null : d)).catch(() => setRetHoy(null))
                .finally(() => setRetCargando(false))
        }
    }
    function aceptarDialogo() {
        const d = dialogo
        if (!d) return
        if (d.tipo === "anular" && !motivoAnular.trim()) { toast.warning("Escribí el motivo de la anulación."); return }
        setDialogo(null)
        if (d.tipo === "confirmar") confirmarOP(d.op.id, undefined, retHoy?.cambia === true)
        else if (d.tipo === "anular") anularOP(d.op, motivoAnular.trim())
        else eliminarOP(d.op)
    }

    function getBadgeEstado(estado: string) {
        switch (estado) {
            case "pagada": return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Pagada</Badge>
            case "pendiente": return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pendiente</Badge>
            case "borrador": return <Badge variant="secondary">Borrador</Badge>
            case "cancelada": return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Cancelada</Badge>
            case "anulada": return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Anulada</Badge>
            default: return <Badge variant="outline">{estado}</Badge>
        }
    }

    function getMediosResumen(detalle: any[]) {
        if (!detalle || detalle.length === 0) return "—"
        const medios = detalle.map((d: any) => {
            switch (d.medio) {
                case "efectivo": return "Efectivo"
                case "cheque": return "Cheque"
                case "cheque_propio": return "Ch. Propio"
                case "transferencia": return "Transf."
                case "deposito": return "Depósito"
                default: return d.medio
            }
        })
        return [...new Set(medios)].join(" + ")
    }

    const totalPendiente = ordenes
        .filter(o => o.estado === "pendiente")
        .reduce((sum, o) => sum + Number(o.neto_a_pagar || 0), 0)

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/proveedores">
                            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Órdenes de Pago</h1>
                            <p className="text-sm text-muted-foreground">Gestión de pagos a proveedores</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="border-l-4 border-l-yellow-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Pendientes de Pago</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-yellow-600">{formatCurrency(totalPendiente)}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-l-4 border-l-green-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Pagadas</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-green-600">
                                {ordenes.filter(o => o.estado === "pagada").length}
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-l-4 border-l-blue-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Total Órdenes</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{ordenes.length}</div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader className="border-b bg-muted/30">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <DollarSign className="h-5 w-5" /> Órdenes de Pago
                            </CardTitle>
                            <div className="flex flex-wrap gap-2">
                                <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="todos">Todos</SelectItem>
                                        <SelectItem value="pendiente">Pendientes</SelectItem>
                                        <SelectItem value="pagada">Pagadas</SelectItem>
                                        <SelectItem value="anulada">Anuladas</SelectItem>
                                        <SelectItem value="cancelada">Canceladas</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Link href="/ordenes-pago/nueva">
                                    <Button className="gap-2"><Plus className="h-4 w-4" /> Nueva Orden de Pago</Button>
                                </Link>
                            </div>
                        </div>
                        {/* Paquete mensual del contador: planilla PDF + TXT SICORE */}
                        <div className="flex items-center gap-2 mt-3 flex-wrap text-sm">
                            <span className="text-muted-foreground">Retenciones para el contador:</span>
                            <select
                                className="rounded-md border px-2 py-1 text-sm"
                                value={mesExport}
                                onChange={e => setMesExport(e.target.value)}
                            >
                                {mesesExport.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                            <a href={`/api/retenciones/export?formato=planilla&desde=${mesExport}-01&hasta=${finDeMes(mesExport)}`} target="_blank" rel="noreferrer">
                                <Button variant="outline" size="sm">Planilla PDF</Button>
                            </a>
                            <a href={`/api/retenciones/export?formato=txt&desde=${mesExport}-01&hasta=${finDeMes(mesExport)}`}>
                                <Button variant="outline" size="sm">TXT SICORE</Button>
                            </a>
                            {puedePresentar && esAdmin && (
                                <Button variant="outline" size="sm" disabled={finDeMes(mesExport) > hoyISO() || (!!presentadoHasta && finDeMes(mesExport) <= presentadoHasta)}
                                    title="Cuando el contador ya presentó el TXT de ese mes: cierra el período"
                                    onClick={() => setConfirmaPresentar(true)}>
                                    Marcar presentado ante ARCA
                                </Button>
                            )}
                            {presentadoHasta && <span className="text-xs text-muted-foreground">Presentado hasta el {fecha(presentadoHasta)}</span>}
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>N° OP</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Medios</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Retenciones</TableHead>
                                    <TableHead className="text-right">Neto</TableHead>
                                    <TableHead className="text-center">Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                                            <CargaProgreso compacto mensajes={MENSAJES.pagos} className="mx-auto max-w-sm" />
                                        </TableCell>
                                    </TableRow>
                                ) : ordenes.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                                            No hay órdenes de pago
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    ordenes.map((op) => (
                                        <TableRow key={op.id} className="hover:bg-muted/50">
                                            <TableCell className="font-mono font-medium">{op.numero_op}</TableCell>
                                            <TableCell>
                                                {fecha(op.fecha)}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {op.proveedores?.nombre || op.proveedores?.sigla || "—"}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {getMediosResumen(op.ordenes_pago_detalle)}
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {formatCurrency(op.monto_total)}
                                            </TableCell>
                                            <TableCell className="text-right text-sm text-muted-foreground">
                                                {op.total_retenciones > 0 ? formatCurrency(op.total_retenciones) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-bold">
                                                {formatCurrency(op.neto_a_pagar)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {getBadgeEstado(op.estado)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex gap-1 justify-end">
                                                    <a href={`/api/ordenes-pago/${op.id}/pdf`} target="_blank" rel="noreferrer">
                                                        <Button variant="ghost" size="sm" title="PDF de la orden de pago">
                                                            <FileText className="h-4 w-4" />
                                                        </Button>
                                                    </a>
                                                    {op.estado === "pagada" && Number(op.retencion_ganancias || 0) > 0 && (
                                                        <a href={`/api/ordenes-pago/${op.id}/certificado`} target="_blank" rel="noreferrer">
                                                            <Button variant="ghost" size="sm" className="text-orange-600 hover:bg-orange-50"
                                                                title="Certificado de retención RG 830">
                                                                <Receipt className="h-4 w-4" />
                                                            </Button>
                                                        </a>
                                                    )}
                                                    {op.estado === "pendiente" && esAdmin && (
                                                        <Button variant="ghost" size="sm" disabled={trabajando}
                                                            className="text-green-600 hover:bg-green-50"
                                                            onClick={() => abrirDialogo("confirmar", op)}
                                                            title="Confirmar pago (sale la plata)">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {op.estado === "pagada" && esAdmin && (
                                                        <Button variant="ghost" size="sm" disabled={trabajando}
                                                            className="text-amber-700 hover:bg-amber-50 gap-1"
                                                            onClick={() => abrirDialogo("anular", op)}
                                                            title="Anular: revierte el pago y deja la orden como Anulada">
                                                            <Undo2 className="h-4 w-4" /> Anular
                                                        </Button>
                                                    )}
                                                    {(op.estado === "pendiente" || (op.estado === "pagada" && esAdmin)) && (
                                                        <Button variant="ghost" size="sm" disabled={trabajando}
                                                            className="text-red-600 hover:bg-red-50"
                                                            onClick={() => abrirDialogo("eliminar", op)}
                                                            title="Eliminar (revierte todo, como si nunca hubiera existido)">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </main>

            {/* Marcar un mes como presentado ante ARCA */}
            <AlertDialog open={confirmaPresentar} onOpenChange={setConfirmaPresentar}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Marcar {mesesExport.find(m => m.v === mesExport)?.l} como presentado ante ARCA?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>Hacelo recién cuando el contador ya presentó el TXT de SICORE de ese mes. Bajar el TXT no marca nada.</p>
                                <p>Desde ese momento, hasta el {fecha(finDeMes(mesExport))}:</p>
                                <ul className="list-disc space-y-0.5 pl-5">
                                    <li>no se puede <b>eliminar</b> una orden de pago con certificado de retención (se anula),</li>
                                    <li>no se puede crear ni confirmar una orden con retención fechada en ese período.</li>
                                </ul>
                                <p className="text-muted-foreground">No se puede deshacer desde la pantalla.</p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Volver</AlertDialogCancel>
                        <AlertDialogAction onClick={marcarPresentado}>Marcar como presentado</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Confirmar / anular / eliminar: diálogo del sistema que explica qué va a pasar */}
            <AlertDialog open={!!dialogo} onOpenChange={(o) => { if (!o) setDialogo(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {dialogo?.tipo === "confirmar" && `¿Confirmar la orden de pago ${dialogo.op.numero_op}?`}
                            {dialogo?.tipo === "anular" && `¿Anular la orden de pago ${dialogo.op.numero_op}?`}
                            {dialogo?.tipo === "eliminar" && `¿Eliminar la orden de pago ${dialogo.op.numero_op}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                {dialogo && (
                                    <p>
                                        <b>{dialogo.op.proveedores?.nombre || dialogo.op.proveedores?.sigla || "Proveedor"}</b> · neto {formatCurrency(dialogo.op.neto_a_pagar)}
                                        {Number(dialogo.op.total_retenciones || 0) > 0 ? ` · retenciones ${formatCurrency(dialogo.op.total_retenciones)}` : ""}
                                    </p>
                                )}
                                {dialogo?.tipo === "confirmar" && (
                                    <>
                                        <p>Al confirmar sale la plata:</p>
                                        <ul className="list-disc space-y-0.5 pl-5">
                                            <li>baja el saldo de la caja o del banco y los cheques pasan a entregados,</li>
                                            <li>se registra el pago en la cuenta corriente del proveedor,</li>
                                            <li>los comprobantes y vencimientos elegidos quedan pagados,</li>
                                            <li>si hay retención de Ganancias, se emite el certificado.</li>
                                        </ul>
                                        <p>Si algún comprobante ya no tiene saldo (lo pagó otra orden), no se confirma y avisa cuál.</p>
                                        {retCargando && <p className="text-muted-foreground">Calculando la retención de hoy…</p>}
                                        {retHoy?.cambia && (
                                            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                                                <p className="font-semibold">La retención de Ganancias cambió desde que se armó la orden.</p>
                                                <p>
                                                    La retención cuenta por el día en que se paga (hoy, {fecha(retHoy.fecha_pago)}), no por la fecha de la orden ({fecha(retHoy.fecha_orden)}).
                                                    Era <b>{formatCurrency(retHoy.retencion_guardada)}</b> y hoy corresponde <b>{formatCurrency(retHoy.retencion_hoy)}</b>:
                                                    el neto a pagar pasa de {formatCurrency(retHoy.neto_guardado)} a <b>{formatCurrency(retHoy.neto_hoy)}</b>.
                                                </p>
                                                {retHoy.se_puede_ajustar ? (
                                                    <p>Si confirmás, la diferencia se ajusta en {retHoy.medio_que_se_ajusta === "efectivo" ? "el efectivo" : retHoy.medio_que_se_ajusta === "deposito" ? "el depósito" : "la transferencia"} de la orden.</p>
                                                ) : (
                                                    <p className="font-semibold">Esta orden no tiene una transferencia ni efectivo donde ajustar la diferencia (se paga con cheques): eliminala y armala de nuevo.</p>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                                {dialogo?.tipo === "anular" && (
                                    <>
                                        <p>Anular revierte el pago y deja la orden en el listado como <b>Anulada</b>:</p>
                                        <ul className="list-disc space-y-0.5 pl-5">
                                            <li>la plata vuelve a la caja o al banco (contraasiento),</li>
                                            <li>los cheques de terceros vuelven a cartera; los propios quedan anulados,</li>
                                            <li>la deuda vuelve a la cuenta corriente del proveedor,</li>
                                            <li>los comprobantes y vencimientos vuelven a pendiente,</li>
                                            <li>el certificado de retención queda anulado (su número no se vuelve a usar).</li>
                                        </ul>
                                        <Input autoFocus placeholder="Motivo de la anulación (obligatorio)" value={motivoAnular}
                                            onChange={e => setMotivoAnular(e.target.value)} />
                                    </>
                                )}
                                {dialogo?.tipo === "eliminar" && (dialogo.op.estado === "pagada" ? (
                                    <>
                                        <p>Eliminar la borra <b>como si nunca hubiera existido</b>. Se revierte todo:</p>
                                        <ul className="list-disc space-y-0.5 pl-5">
                                            <li>saldos de cajas y bancos (contraasiento), cheques otra vez en cartera,</li>
                                            <li>la cuenta corriente del proveedor queda como estaba y los vencimientos vuelven a pendiente,</li>
                                            <li>el certificado de retención se elimina (no sale en el TXT de SICORE),</li>
                                            <li>los números de OP y de certificado se liberan si eran los últimos.</li>
                                        </ul>
                                        <p>Si el certificado ya se le entregó al proveedor o el período ya se presentó, usá <b>Anular</b> en lugar de eliminar.</p>
                                    </>
                                ) : (
                                    <p>Todavía no se pagó: se borra por completo y el número se libera si era el último. No mueve plata.</p>
                                ))}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={dialogo?.tipo === "confirmar" && (retCargando || (retHoy?.cambia === true && retHoy?.se_puede_ajustar === false))}
                            className={dialogo?.tipo === "confirmar" ? "" : "bg-red-600 hover:bg-red-700"}
                            onClick={(e) => { e.preventDefault(); aceptarDialogo() }}>
                            {dialogo?.tipo === "confirmar" ? (retHoy?.cambia ? "Confirmar con la retención de hoy" : "Confirmar pago") : dialogo?.tipo === "anular" ? "Anular la orden" : "Eliminar la orden"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Selección de cuenta bancaria de origen para OP con transferencias */}
            {eligeCuenta && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEligeCuenta(null)}>
                    <div className="bg-white rounded-xl p-5 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold mb-1">¿Desde qué cuenta salen las transferencias?</h3>
                        <p className="text-xs text-muted-foreground mb-3">La OP incluye transferencias — elegí la cuenta de origen para asentar el kardex y bajar el saldo.</p>
                        <div className="space-y-2">
                            {eligeCuenta.bancos.map((b: any) => (
                                <button key={b.cuenta_id}
                                    className="w-full text-left rounded-lg border px-3 py-2 text-sm hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                                    onClick={() => { const opId = eligeCuenta.opId; setEligeCuenta(null); confirmarOP(opId, b.cuenta_id) }}>
                                    <span className="font-medium">{b.nombre}</span>
                                    <span className="text-xs text-muted-foreground ml-2">
                                        saldo {moneda(Number(b.saldos?.BLANCO ?? 0), 0)}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="text-right mt-3">
                            <Button variant="outline" size="sm" onClick={() => setEligeCuenta(null)}>Cancelar</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
