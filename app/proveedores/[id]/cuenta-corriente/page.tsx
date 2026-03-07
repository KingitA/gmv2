"use client"

import { nowArgentina, todayArgentina } from "@/lib/utils"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Wallet, DollarSign, ListChecks } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

export default function CuentaCorrienteProveedorPage() {
    const params = useParams()
    const id = params?.id as string

    const [movimientos, setMovimientos] = useState<any[]>([])
    const [totales, setTotales] = useState({
        comprobantes: 0,
        facturado: 0,
        pagado: 0,
        saldo: 0
    })
    const [loading, setLoading] = useState(true)
    const [selectedMovs, setSelectedMovs] = useState<Set<string>>(new Set())

    // Payment Dialog State
    const [showPaymentDialog, setShowPaymentDialog] = useState(false)
    const [paymentData, setPaymentData] = useState({
        monto: 0,
        fecha: todayArgentina(),
        observaciones: ""
    })
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        if (id) {
            loadCuentaCorriente()
        }
    }, [id])

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
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo cargar la cuenta corriente"
            })
        } finally {
            setLoading(false)
        }
    }

    const toggleSelection = (movId: string) => {
        const newSelection = new Set(selectedMovs)
        if (newSelection.has(movId)) {
            newSelection.delete(movId)
        } else {
            newSelection.add(movId)
        }
        setSelectedMovs(newSelection)
    }

    const totalSelected = movimientos
        .filter(m => selectedMovs.has(m.id))
        .reduce((sum, m) => sum + (m.saldo_pendiente || 0), 0)

    async function handlePayment() {
        if (paymentData.monto <= 0) {
            toast({ variant: "destructive", title: "Error", description: "El monto debe ser mayor a 0" })
            return
        }

        setIsSubmitting(true)
        try {
            const selectedItems = movimientos.filter(m => selectedMovs.has(m.id))
            let remainingPayment = paymentData.monto
            const imputaciones = []

            for (const item of selectedItems) {
                if (remainingPayment <= 0) break
                const amountToImpute = Math.min(remainingPayment, item.saldo_pendiente)
                if (amountToImpute > 0) {
                    imputaciones.push({
                        documento_id: item.id,
                        monto_imputado: amountToImpute
                    })
                    remainingPayment -= amountToImpute
                }
            }

            const res = await fetch(`/api/proveedores/${id}/imputar-pago`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...paymentData,
                    monto_total: paymentData.monto,
                    imputaciones
                })
            })

            if (!res.ok) throw new Error("Error saving payment")

            toast({ title: "Éxito", description: "Pago registrado e imputado correctamente" })
            setShowPaymentDialog(false)
            setSelectedMovs(new Set())
            setPaymentData({ monto: 0, fecha: todayArgentina(), observaciones: "" })
            loadCuentaCorriente()
        } catch (error) {
            console.error(error)
            toast({ variant: "destructive", title: "Error", description: "No se pudo registrar el pago" })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/proveedores">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Cuenta Corriente Proveedor</h1>
                    <p className="text-muted-foreground">Historial de movimientos y gestión de pagos</p>
                </div>
            </div>

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
                        <p className="text-xs text-muted-foreground">
                            {totales.saldo > 0 ? "Deuda Total" : "A favor"}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Facturado</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(totales.facturado)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Pagado</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(totales.pagado)}</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <ListChecks className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Movimientos</CardTitle>
                        </div>
                        <div className="flex items-center gap-4">
                            {selectedMovs.size > 0 && (
                                <div className="text-sm font-medium text-muted-foreground">
                                    Seleccionado: <span className="text-foreground">{formatCurrency(totalSelected)}</span>
                                </div>
                            )}
                            <Button
                                onClick={() => {
                                    setPaymentData(prev => ({ ...prev, monto: totalSelected }))
                                    setShowPaymentDialog(true)
                                }}
                                disabled={selectedMovs.size === 0}
                                className="gap-2"
                            >
                                <DollarSign className="h-4 w-4" />
                                Imputar Pago ({selectedMovs.size})
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]"></TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Descripción / Comprobante</TableHead>
                                <TableHead className="text-right">Importe</TableHead>
                                <TableHead className="text-right">Saldo Pendiente</TableHead>
                                <TableHead className="text-center">Estado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground animate-pulse">Cargando movimientos...</TableCell>
                                </TableRow>
                            ) : movimientos.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">No hay movimientos registrados</TableCell>
                                </TableRow>
                            ) : (
                                movimientos.map((mov) => {
                                    const isDebt = !['PAGO', 'NOTA CREDITO'].includes(mov.tipo)
                                    const canSelect = isDebt && mov.saldo_pendiente > 0

                                    return (
                                        <TableRow key={mov.id} className={selectedMovs.has(mov.id) ? "bg-accent/40" : ""}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={selectedMovs.has(mov.id)}
                                                    onCheckedChange={() => toggleSelection(mov.id)}
                                                    disabled={!canSelect}
                                                />
                                            </TableCell>
                                            <TableCell className="text-sm font-medium">
                                                {new Date(mov.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={isDebt ? "secondary" : "outline"} className={!isDebt ? "text-green-600 border-green-200 bg-green-50" : ""}>
                                                    {mov.tipo}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="max-w-[300px] truncate" title={mov.numero}>
                                                {mov.numero}
                                            </TableCell>
                                            <TableCell className={`text-right font-mono ${!isDebt ? 'text-green-600' : ''}`}>
                                                {formatCurrency(mov.total)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold">
                                                {formatCurrency(mov.saldo_pendiente)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={mov.estado === 'pagado' ? 'default' : 'destructive'}
                                                    className={mov.estado === 'pagado' ? 'bg-green-500' : 'bg-orange-500'}>
                                                    {mov.estado.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Registrar e Imputar Pago</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="monto">Monto del Pago</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="monto"
                                    type="number"
                                    className="pl-10"
                                    value={paymentData.monto}
                                    onChange={(e) => setPaymentData(prev => ({ ...prev, monto: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="fecha">Fecha</Label>
                            <Input
                                id="fecha"
                                type="date"
                                value={paymentData.fecha}
                                onChange={(e) => setPaymentData(prev => ({ ...prev, fecha: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="obs">Observaciones / Referencia</Label>
                            <Input
                                id="obs"
                                value={paymentData.observaciones}
                                onChange={(e) => setPaymentData(prev => ({ ...prev, observaciones: e.target.value }))}
                                placeholder="Ej: Transferencia Banco Nación"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancelar</Button>
                        <Button onClick={handlePayment} disabled={isSubmitting}>
                            {isSubmitting ? "Procesando..." : "Confirmar Pago"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
