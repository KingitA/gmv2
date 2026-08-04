"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Plus, DollarSign, CheckCircle2, XCircle, Eye, FileText, Receipt } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"

export default function OrdenesPagoPage() {
    const [ordenes, setOrdenes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [filtroEstado, setFiltroEstado] = useState("todos")
    const [mesExport, setMesExport] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7))
    const [eligeCuenta, setEligeCuenta] = useState<{ opId: string; bancos: any[] } | null>(null)

    const finDeMes = (ym: string) => {
        const [y, m] = ym.split("-").map(Number)
        return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`
    }

    useEffect(() => { loadOrdenes() }, [filtroEstado])

    async function loadOrdenes() {
        setLoading(true)
        try {
            const res = await fetch(`/api/ordenes-pago?estado=${filtroEstado}`)
            const data = await res.json()
            setOrdenes(Array.isArray(data) ? data : [])
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    async function confirmarOP(id: string, cuentaBancariaId?: string) {
        if (!cuentaBancariaId && !confirm("¿Confirmar esta orden de pago? Se generarán los movimientos en cuenta corriente, kardex y saldos.")) return
        try {
            const res = await fetch(`/api/ordenes-pago/${id}/confirmar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(cuentaBancariaId ? { cuenta_bancaria_id: cuentaBancariaId } : {}),
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
                alert(d.error || "Error al confirmar")
                return
            }
            if (d.numero_certificado) {
                alert(`OP confirmada. Se emitió el certificado de retención N° ${d.numero_certificado} — podés bajarlo con el botón naranja.`)
            }
            loadOrdenes()
        } catch (e) {
            console.error(e)
        }
    }

    async function cancelarOP(id: string) {
        if (!confirm("¿Cancelar esta orden de pago?")) return
        try {
            await fetch(`/api/ordenes-pago/${id}`, { method: "DELETE" })
            loadOrdenes()
        } catch (e) {
            console.error(e)
        }
    }

    function getBadgeEstado(estado: string) {
        switch (estado) {
            case "pagada": return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Pagada</Badge>
            case "pendiente": return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pendiente</Badge>
            case "borrador": return <Badge variant="secondary">Borrador</Badge>
            case "cancelada": return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Cancelada</Badge>
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
                            <input
                                type="month"
                                className="rounded-md border px-2 py-1 text-sm"
                                value={mesExport}
                                onChange={e => setMesExport(e.target.value)}
                            />
                            <a href={`/api/retenciones/export?formato=planilla&desde=${mesExport}-01&hasta=${finDeMes(mesExport)}`} target="_blank" rel="noreferrer">
                                <Button variant="outline" size="sm">Planilla PDF</Button>
                            </a>
                            <a href={`/api/retenciones/export?formato=txt&desde=${mesExport}-01&hasta=${finDeMes(mesExport)}`}>
                                <Button variant="outline" size="sm">TXT SICORE</Button>
                            </a>
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
                                            Cargando...
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
                                                {new Date(op.fecha + "T00:00:00").toLocaleDateString("es-AR")}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {op.proveedores?.sigla || op.proveedores?.nombre || "—"}
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
                                                    {op.estado === "pendiente" && (
                                                        <>
                                                            <Button variant="ghost" size="sm"
                                                                className="text-green-600 hover:bg-green-50"
                                                                onClick={() => confirmarOP(op.id)}
                                                                title="Confirmar pago">
                                                                <CheckCircle2 className="h-4 w-4" />
                                                            </Button>
                                                            <Button variant="ghost" size="sm"
                                                                className="text-red-600 hover:bg-red-50"
                                                                onClick={() => cancelarOP(op.id)}
                                                                title="Cancelar">
                                                                <XCircle className="h-4 w-4" />
                                                            </Button>
                                                        </>
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
                                        saldo {Number(b.saldos?.BLANCO ?? 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}
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
