"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ArrowLeft, Wallet, DollarSign, ListChecks, ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

export default function CuentaCorrienteProveedorPage() {
    const params = useParams()
    const router = useRouter()
    const id = params?.id as string

    const [movimientos, setMovimientos] = useState<any[]>([])
    const [totales, setTotales] = useState({ comprobantes: 0, facturado: 0, pagado: 0, saldo: 0 })
    const [loading, setLoading] = useState(true)
    const [selectedMovs, setSelectedMovs] = useState<Set<string>>(new Set())
    const [showPagados, setShowPagados] = useState(false)
    const [provNombre, setProvNombre] = useState("")
    const [ncOpen, setNcOpen] = useState(false)
    const [nc, setNc] = useState({ tipo: "NC", numero: "", fecha: "", total: "", total_neto: "" })
    const [ncSaving, setNcSaving] = useState(false)

    const parseMonto = (v: string) => {
        const t = v.trim().replace(",", ".")
        if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null
        return Number(t)
    }

    async function guardarNC() {
        const total = parseMonto(nc.total)
        if (total === null || total <= 0) { toast({ variant: "destructive", title: "Total inválido (punto = centavos)" }); return }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nc.fecha)) { toast({ variant: "destructive", title: "Fecha inválida (usar el selector)" }); return }
        setNcSaving(true)
        try {
            const res = await fetch(`/api/proveedores/${id}/nc`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tipo: nc.tipo,
                    numero: nc.numero || null,
                    fecha: nc.fecha,
                    total,
                    total_neto: nc.total_neto ? parseMonto(nc.total_neto) : null,
                }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error)
            toast({ title: `${nc.tipo} registrada — ya figura como crédito y se puede descontar en la próxima OP` })
            setNcOpen(false)
            setNc({ tipo: "NC", numero: "", fecha: "", total: "", total_neto: "" })
            loadCuentaCorriente()
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e.message })
        } finally { setNcSaving(false) }
    }

    useEffect(() => {
        if (id) { loadCuentaCorriente(); loadProveedorNombre() }
    }, [id])

    async function loadProveedorNombre() {
        try {
            const { createClient } = await import("@/lib/supabase/client")
            const supabase = createClient()
            const { data } = await supabase.from("proveedores").select("nombre, sigla").eq("id", id).single()
            if (data) setProvNombre(data.sigla || data.nombre)
        } catch (e) { }
    }

    async function loadCuentaCorriente() {
        setLoading(true)
        try {
            const res = await fetch(`/api/proveedores/${id}/cuenta-corriente`)
            if (!res.ok) throw new Error("Error loading account")
            const data = await res.json()
            setMovimientos(data.comprobantes || [])
            setTotales(data.totales || { comprobantes: 0, facturado: 0, pagado: 0, saldo: 0 })
        } catch (error) {
            console.error(error)
            toast({ variant: "destructive", title: "Error", description: "No se pudo cargar la cuenta corriente" })
        } finally { setLoading(false) }
    }

    const toggleSelection = (movId: string) => {
        const ns = new Set(selectedMovs)
        ns.has(movId) ? ns.delete(movId) : ns.add(movId)
        setSelectedMovs(ns)
    }

    const totalSelected = movimientos.filter(m => selectedMovs.has(m.id)).reduce((s, m) => s + (m.saldo_pendiente || 0), 0)

    function handleCrearOP() {
        const items = movimientos.filter(m => selectedMovs.has(m.id))
        const ids = items.map(m => m.id).join(',')
        const montos = items.map(m => m.saldo_pendiente).join(',')
        const descs = items.map(m => encodeURIComponent(m.numero || m.tipo)).join(',')
        router.push(`/ordenes-pago/nueva?proveedor_id=${id}&mov_cc_ids=${ids}&mov_montos=${montos}&mov_desc=${descs}&monto=${totalSelected}`)
    }

    const pendientes = movimientos.filter(m => m.estado === 'pendiente')
    const pagados = movimientos.filter(m => m.estado === 'pagado')

    function renderRow(mov: any, selectable: boolean) {
        const isDebt = !['PAGO', 'NOTA CREDITO', 'RETENCION'].includes(mov.tipo)
        const canSelect = selectable && isDebt && mov.saldo_pendiente > 0

        return (
            <TableRow key={mov.id} className={selectedMovs.has(mov.id) ? "bg-accent/40" : ""}>
                {selectable && (
                    <TableCell className="w-[40px]">
                        <Checkbox checked={selectedMovs.has(mov.id)} onCheckedChange={() => toggleSelection(mov.id)} disabled={!canSelect} />
                    </TableCell>
                )}
                <TableCell className="text-sm">
                    {new Date(mov.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                </TableCell>
                <TableCell>
                    <Badge variant={isDebt ? "secondary" : "outline"} className={!isDebt ? "text-green-600 border-green-200 bg-green-50" : ""}>
                        {mov.tipo_comprobante || mov.tipo}
                    </Badge>
                </TableCell>
                <TableCell className="max-w-[300px] truncate" title={mov.numero}>{mov.numero}</TableCell>
                {mov.vencimiento && (
                    <TableCell className="text-sm text-muted-foreground">
                        {new Date(mov.vencimiento + "T00:00:00").toLocaleDateString('es-AR')}
                    </TableCell>
                )}
                {!mov.vencimiento && <TableCell></TableCell>}
                <TableCell className={`text-right font-mono ${!isDebt ? 'text-green-600' : ''}`}>
                    {formatCurrency(mov.total)}
                </TableCell>
                <TableCell className="text-right font-mono font-bold">
                    {selectable ? formatCurrency(mov.saldo_pendiente) : "—"}
                </TableCell>
                <TableCell className="text-right">
                    {mov.referencia_tipo === 'orden_compra' && mov.referencia_id && (
                        <Link href={`/ordenes-compra/${mov.referencia_id}/articulos`}>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs text-blue-600 hover:bg-blue-50">
                                <ExternalLink className="h-3 w-3" /> OC
                            </Button>
                        </Link>
                    )}
                </TableCell>
            </TableRow>
        )
    }

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/proveedores">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Cuenta Corriente {provNombre && `— ${provNombre}`}</h1>
                    <p className="text-muted-foreground">Historial de movimientos y gestión de pagos</p>
                </div>
                <Button variant="outline" className="ml-auto" onClick={() => setNcOpen(true)}>
                    + Nota de crédito
                </Button>
            </div>

            {ncOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setNcOpen(false)}>
                    <div className="bg-white rounded-xl p-5 w-[420px] shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold">Nueva nota de crédito — {provNombre}</h3>
                        <p className="text-xs text-muted-foreground">
                            Para NC comerciales sin OC (ej. 3% del trimestre). NC/NCA/NCB = fiscal (resta base de retención) · Reversa = canal negro (no afecta retención).
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs font-medium">Tipo</label>
                                <select className="w-full rounded-md border px-2 py-1.5 text-sm" value={nc.tipo}
                                    onChange={e => setNc(p => ({ ...p, tipo: e.target.value }))}>
                                    <option value="NC">NC</option>
                                    <option value="NCA">NCA</option>
                                    <option value="NCB">NCB</option>
                                    <option value="Reversa">Reversa (negro)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium">N° comprobante</label>
                                <input className="w-full rounded-md border px-2 py-1.5 text-sm" value={nc.numero}
                                    onChange={e => setNc(p => ({ ...p, numero: e.target.value }))} placeholder="0001-00001234" />
                            </div>
                            <div>
                                <label className="text-xs font-medium">Fecha</label>
                                <input type="date" className="w-full rounded-md border px-2 py-1.5 text-sm" value={nc.fecha}
                                    onChange={e => setNc(p => ({ ...p, fecha: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-xs font-medium">Total</label>
                                <input inputMode="decimal" className="w-full rounded-md border px-2 py-1.5 text-sm tabular-nums" value={nc.total}
                                    onChange={e => setNc(p => ({ ...p, total: e.target.value }))} placeholder="punto = centavos" />
                            </div>
                            {nc.tipo !== "Reversa" && (
                                <div className="col-span-2">
                                    <label className="text-xs font-medium">Neto gravado (opcional — si no, total ÷ 1,21)</label>
                                    <input inputMode="decimal" className="w-full rounded-md border px-2 py-1.5 text-sm tabular-nums" value={nc.total_neto}
                                        onChange={e => setNc(p => ({ ...p, total_neto: e.target.value }))} />
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="outline" size="sm" onClick={() => setNcOpen(false)}>Cancelar</Button>
                            <Button size="sm" disabled={ncSaving} onClick={guardarNC}>{ncSaving ? "Guardando…" : "Registrar NC"}</Button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <Card className="border-l-4 border-l-red-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Saldo Pendiente</CardTitle>
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${totales.saldo > 0 ? 'text-red-500' : 'text-green-500'}`}>
                            {formatCurrency(totales.saldo)}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Facturado</CardTitle>
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{formatCurrency(totales.facturado)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Pagado</CardTitle>
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold text-green-600">{formatCurrency(totales.pagado)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{pendientes.length}</div></CardContent>
                </Card>
            </div>

            {/* PENDIENTES */}
            <Card className="mb-6">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="flex items-center gap-2">
                            <ListChecks className="h-5 w-5" /> Pendientes
                        </CardTitle>
                        <div className="flex items-center gap-4">
                            {selectedMovs.size > 0 && (
                                <span className="text-sm text-muted-foreground">
                                    Seleccionado: <span className="font-bold text-foreground">{formatCurrency(totalSelected)}</span>
                                </span>
                            )}
                            <Button onClick={handleCrearOP} disabled={selectedMovs.size === 0} className="gap-2">
                                <DollarSign className="h-4 w-4" /> Crear Orden de Pago ({selectedMovs.size})
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="w-[40px]"></TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Comprobante</TableHead>
                                <TableHead>Vencimiento</TableHead>
                                <TableHead className="text-right">Importe</TableHead>
                                <TableHead className="text-right">Saldo</TableHead>
                                <TableHead className="w-[60px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={8} className="text-center h-20 text-muted-foreground">Cargando...</TableCell></TableRow>
                            ) : pendientes.length === 0 ? (
                                <TableRow><TableCell colSpan={8} className="text-center h-16 text-muted-foreground">Sin comprobantes pendientes</TableCell></TableRow>
                            ) : pendientes.map(mov => renderRow(mov, true))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* ANTERIORES */}
            {pagados.length > 0 && (
                <Card>
                    <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-3"
                        onClick={() => setShowPagados(!showPagados)}>
                        <div className="flex items-center gap-2">
                            {showPagados ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <CardTitle className="text-sm text-muted-foreground font-medium">
                                Anteriores ({pagados.length})
                            </CardTitle>
                        </div>
                    </CardHeader>
                    {showPagados && (
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/20">
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Comprobante</TableHead>
                                        <TableHead>Vencimiento</TableHead>
                                        <TableHead className="text-right">Importe</TableHead>
                                        <TableHead className="text-right">Saldo</TableHead>
                                        <TableHead className="w-[60px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pagados.map(mov => renderRow(mov, false))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    )}
                </Card>
            )}
        </div>
    )
}
