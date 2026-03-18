"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
    ArrowLeft, Plus, Calendar, AlertTriangle, CheckCircle2,
    Clock, XCircle, Filter, DollarSign
} from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"

const TIPOS_VENCIMIENTO = [
    { value: "factura", label: "Factura" },
    { value: "servicio", label: "Servicio" },
    { value: "impuesto", label: "Impuesto / VEP" },
    { value: "seguro", label: "Seguro" },
    { value: "vep", label: "VEP" },
    { value: "otro", label: "Otro" },
]

const RECURRENCIAS = [
    { value: "", label: "Sin recurrencia (pago único)" },
    { value: "mensual", label: "Mensual" },
    { value: "bimestral", label: "Bimestral" },
    { value: "trimestral", label: "Trimestral" },
    { value: "semestral", label: "Semestral" },
    { value: "anual", label: "Anual" },
]

interface Vencimiento {
    id: string
    proveedor_id: string | null
    tipo: string
    concepto: string
    monto: number
    fecha_vencimiento: string
    estado: string
    recurrencia: string | null
    observaciones: string | null
    dias_alerta: number
    proveedores?: { id: string; nombre: string; sigla: string | null } | null
}

export default function VencimientosPage() {
    const [vencimientos, setVencimientos] = useState<Vencimiento[]>([])
    const [proveedores, setProveedores] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [filtroEstado, setFiltroEstado] = useState("pendiente")
    const [filtroTipo, setFiltroTipo] = useState("todos")
    const [filtroProveedor, setFiltroProveedor] = useState("")
    const [formData, setFormData] = useState({
        proveedor_id: "",
        tipo: "factura",
        concepto: "",
        monto: 0,
        fecha_vencimiento: new Date().toISOString().split("T")[0],
        recurrencia: "",
        recurrencia_hasta: "",
        observaciones: "",
        dias_alerta: 3,
    })

    useEffect(() => {
        loadVencimientos()
        loadProveedores()
    }, [filtroEstado, filtroTipo])

    async function loadProveedores() {
        const supabase = createClient()
        const { data } = await supabase
            .from("proveedores")
            .select("id, nombre, sigla")
            .eq("activo", true)
            .order("nombre")
        setProveedores(data || [])
    }

    async function loadVencimientos() {
        setLoading(true)
        try {
            let url = `/api/vencimientos?estado=${filtroEstado}`
            if (filtroTipo !== "todos") url += `&tipo=${filtroTipo}`
            if (filtroProveedor) url += `&proveedor_id=${filtroProveedor}`

            const res = await fetch(url)
            const data = await res.json()
            setVencimientos(Array.isArray(data) ? data : [])
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        try {
            const res = await fetch("/api/vencimientos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    proveedor_id: formData.proveedor_id || null,
                    recurrencia: formData.recurrencia || null,
                    recurrencia_hasta: formData.recurrencia_hasta || null,
                }),
            })

            if (!res.ok) {
                const err = await res.json()
                alert(err.error || "Error al crear vencimiento")
                return
            }

            setIsDialogOpen(false)
            resetForm()
            loadVencimientos()
        } catch (e) {
            console.error(e)
        }
    }

    async function marcarPagado(id: string) {
        await fetch("/api/vencimientos", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, estado: "pagado" }),
        })
        loadVencimientos()
    }

    async function cancelarVencimiento(id: string) {
        if (!confirm("¿Cancelar este vencimiento?")) return
        await fetch(`/api/vencimientos?id=${id}`, { method: "DELETE" })
        loadVencimientos()
    }

    function resetForm() {
        setFormData({
            proveedor_id: "",
            tipo: "factura",
            concepto: "",
            monto: 0,
            fecha_vencimiento: new Date().toISOString().split("T")[0],
            recurrencia: "",
            recurrencia_hasta: "",
            observaciones: "",
            dias_alerta: 3,
        })
    }

    function diasHastaVencimiento(fecha: string) {
        const hoy = new Date()
        hoy.setHours(0, 0, 0, 0)
        const venc = new Date(fecha + "T00:00:00")
        return Math.ceil((venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    }

    function getBadgeEstado(estado: string, fechaVenc: string) {
        const dias = diasHastaVencimiento(fechaVenc)
        if (estado === "pagado") return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Pagado</Badge>
        if (estado === "cancelado") return <Badge variant="secondary">Cancelado</Badge>
        if (dias < 0) return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Vencido ({Math.abs(dias)}d)</Badge>
        if (dias <= 3) return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Vence en {dias}d</Badge>
        if (dias <= 7) return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Vence en {dias}d</Badge>
        return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">En {dias}d</Badge>
    }

    // Calcular resumen
    const totalPendiente = vencimientos
        .filter(v => v.estado === "pendiente")
        .reduce((sum, v) => sum + Number(v.monto), 0)

    const vencidos = vencimientos.filter(v =>
        v.estado === "pendiente" && diasHastaVencimiento(v.fecha_vencimiento) < 0
    )

    const proximos7 = vencimientos.filter(v =>
        v.estado === "pendiente" &&
        diasHastaVencimiento(v.fecha_vencimiento) >= 0 &&
        diasHastaVencimiento(v.fecha_vencimiento) <= 7
    )

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/proveedores">
                            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Vencimientos</h1>
                            <p className="text-sm text-muted-foreground">Agenda de pagos — facturas, servicios, impuestos, seguros</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8 space-y-6">
                {/* Resumen */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="border-l-4 border-l-blue-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pendiente</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{formatCurrency(totalPendiente)}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-l-4 border-l-red-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Vencidos</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-red-600">{vencidos.length}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-l-4 border-l-orange-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Próximos 7 días</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-orange-600">{proximos7.length}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-l-4 border-l-green-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Registros</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{vencimientos.length}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filtros y acciones */}
                <Card>
                    <CardHeader className="border-b bg-muted/30">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Calendar className="h-5 w-5" /> Agenda de Vencimientos
                            </CardTitle>
                            <div className="flex flex-wrap gap-2 items-center">
                                <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v)}>
                                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="todos">Todos</SelectItem>
                                        <SelectItem value="pendiente">Pendientes</SelectItem>
                                        <SelectItem value="vencido">Vencidos</SelectItem>
                                        <SelectItem value="pagado">Pagados</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v)}>
                                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="todos">Todos los tipos</SelectItem>
                                        {TIPOS_VENCIMIENTO.map(t => (
                                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Dialog open={isDialogOpen} onOpenChange={(o) => { setIsDialogOpen(o); if (!o) resetForm() }}>
                                    <DialogTrigger asChild>
                                        <Button className="gap-2"><Plus className="h-4 w-4" /> Nuevo Vencimiento</Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                                        <DialogHeader>
                                            <DialogTitle>Nuevo Vencimiento</DialogTitle>
                                        </DialogHeader>
                                        <form onSubmit={handleSubmit} className="space-y-4">
                                            <div>
                                                <Label>Proveedor (opcional)</Label>
                                                <Select value={formData.proveedor_id} onValueChange={(v) => setFormData({ ...formData, proveedor_id: v })}>
                                                    <SelectTrigger><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="">Sin proveedor</SelectItem>
                                                        {proveedores.map(p => (
                                                            <SelectItem key={p.id} value={p.id}>
                                                                {p.sigla ? `${p.sigla} - ${p.nombre}` : p.nombre}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label>Tipo *</Label>
                                                    <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {TIPOS_VENCIMIENTO.map(t => (
                                                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label>Monto</Label>
                                                    <Input type="number" step="0.01" value={formData.monto}
                                                        onChange={(e) => setFormData({ ...formData, monto: parseFloat(e.target.value) || 0 })} />
                                                </div>
                                            </div>
                                            <div>
                                                <Label>Concepto *</Label>
                                                <Input value={formData.concepto} required
                                                    onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
                                                    placeholder="Ej: Factura A 0001-00045678, IIBB Marzo, Seguro camión..." />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label>Fecha Vencimiento *</Label>
                                                    <Input type="date" value={formData.fecha_vencimiento}
                                                        onChange={(e) => setFormData({ ...formData, fecha_vencimiento: e.target.value })} />
                                                </div>
                                                <div>
                                                    <Label>Días alerta</Label>
                                                    <Input type="number" value={formData.dias_alerta}
                                                        onChange={(e) => setFormData({ ...formData, dias_alerta: parseInt(e.target.value) || 3 })} />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label>Recurrencia</Label>
                                                    <Select value={formData.recurrencia} onValueChange={(v) => setFormData({ ...formData, recurrencia: v })}>
                                                        <SelectTrigger><SelectValue placeholder="Sin recurrencia" /></SelectTrigger>
                                                        <SelectContent>
                                                            {RECURRENCIAS.map(r => (
                                                                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {formData.recurrencia && (
                                                    <div>
                                                        <Label>Hasta (opcional)</Label>
                                                        <Input type="date" value={formData.recurrencia_hasta}
                                                            onChange={(e) => setFormData({ ...formData, recurrencia_hasta: e.target.value })} />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <Label>Observaciones</Label>
                                                <Textarea value={formData.observaciones}
                                                    onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                                                    rows={2} />
                                            </div>
                                            <div className="flex gap-2 justify-end">
                                                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                                                <Button type="submit">Crear</Button>
                                            </div>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Vencimiento</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Proveedor</TableHead>
                                        <TableHead>Concepto</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                        <TableHead className="text-center">Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                Cargando...
                                            </TableCell>
                                        </TableRow>
                                    ) : vencimientos.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                No hay vencimientos {filtroEstado !== "todos" ? `con estado "${filtroEstado}"` : ""}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        vencimientos.map((v) => (
                                            <TableRow key={v.id} className="hover:bg-muted/50">
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar className="h-4 w-4 text-muted-foreground" />
                                                        {new Date(v.fecha_vencimiento + "T00:00:00").toLocaleDateString("es-AR")}
                                                    </div>
                                                    {v.recurrencia && (
                                                        <span className="text-xs text-muted-foreground ml-6">🔄 {v.recurrencia}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="text-xs">
                                                        {TIPOS_VENCIMIENTO.find(t => t.value === v.tipo)?.label || v.tipo}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {v.proveedores?.sigla || v.proveedores?.nombre || "—"}
                                                </TableCell>
                                                <TableCell className="max-w-[250px] truncate">{v.concepto}</TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {v.monto > 0 ? formatCurrency(v.monto) : "—"}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {getBadgeEstado(v.estado, v.fecha_vencimiento)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {v.estado === "pendiente" && (
                                                        <div className="flex gap-1 justify-end">
                                                            <Button variant="ghost" size="sm"
                                                                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                                                onClick={() => marcarPagado(v.id)}>
                                                                <CheckCircle2 className="h-4 w-4" />
                                                            </Button>
                                                            <Link href={`/ordenes-pago/nueva?proveedor_id=${v.proveedor_id}&vencimiento_id=${v.id}&monto=${v.monto}`}>
                                                                <Button variant="ghost" size="sm"
                                                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                                                                    <DollarSign className="h-4 w-4" />
                                                                </Button>
                                                            </Link>
                                                            <Button variant="ghost" size="sm"
                                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                                onClick={() => cancelarVencimiento(v.id)}>
                                                                <XCircle className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </main>
        </div>
    )
}
