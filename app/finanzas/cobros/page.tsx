export const dynamic = 'force-dynamic'
"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, CheckCircle, Loader2 } from "lucide-react"
import Link from "next/link"
import { getPagosPendientes, confirmarCobro, obtenerSugerenciaImputacion } from "@/lib/actions/finanzas"
import { MoneyColorBadge } from "@/components/finanzas/MoneyColorBadge"
import { PaymentMethodBadge } from "@/components/finanzas/PaymentMethodBadge"
import { useToast } from "@/hooks/use-toast"

export default function CobrosPage() {
    const [pagos, setPagos] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [selectedPago, setSelectedPago] = useState<any>(null)
    const [destinoTipo, setDestinoTipo] = useState<"CAJA" | "BANCO">("CAJA")
    const [destinoId, setDestinoId] = useState("")
    const [procesando, setProcesando] = useState(false)
    const [sugerencia, setSugerencia] = useState<any[]>([])
    const { toast } = useToast()

    useEffect(() => {
        loadPagos()
    }, [])

    async function loadPagos() {
        const data = await getPagosPendientes()
        setPagos(data || [])
        setLoading(false)
    }

    async function handleOpenModal(pago: any) {
        setSelectedPago(pago)
        setModalOpen(true)

        // Get AI suggestion
        const sug = await obtenerSugerenciaImputacion(pago.cliente_id, pago.monto)
        setSugerencia(sug || [])
    }

    async function handleConfirmar() {
        if (!selectedPago || !destinoId) {
            toast({ title: "Error", description: "Seleccione destino", variant: "destructive" })
            return
        }

        setProcesando(true)
        try {
            await confirmarCobro({
                pagoId: selectedPago.id,
                destinoTipo,
                destinoId,
                imputaciones: sugerencia.map(s => ({ comprobante_id: s.comprobante_id, monto: s.monto }))
            })

            toast({ title: "Éxito", description: "Cobro confirmado correctamente" })
            setModalOpen(false)
            setSugerencia([])
            loadPagos()
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" })
        } finally {
            setProcesando(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/finanzas">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Cobros Pendientes</h1>
                            <p className="text-sm text-muted-foreground">Confirmar pagos registrados</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8">
                {pagos.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <p className="text-muted-foreground">No hay cobros pendientes</p>
                        </CardContent>
                    </Card>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Método</TableHead>
                                <TableHead>Color Sugerido</TableHead>
                                <TableHead>Monto</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pagos.map(pago => (
                                <TableRow key={pago.id}>
                                    <TableCell className="font-medium">{pago.cliente_id}</TableCell>
                                    <TableCell>{new Date(pago.fecha_carga).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                                    <TableCell>
                                        <PaymentMethodBadge method={pago.metodo} />
                                    </TableCell>
                                    <TableCell>
                                        {pago.color_sugerido && <MoneyColorBadge color={pago.color_sugerido} />}
                                    </TableCell>
                                    <TableCell className="font-bold">${Number(pago.monto).toFixed(2)}</TableCell>
                                    <TableCell>
                                        <Badge variant="secondary">Pendiente</Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button size="sm" onClick={() => handleOpenModal(pago)}>
                                            Confirmar
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}

                <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Confirmar Cobro</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>Destino</Label>
                                <Select value={destinoTipo} onValueChange={(v: any) => setDestinoTipo(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CAJA">Caja</SelectItem>
                                        <SelectItem value="BANCO">Banco</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div>
                                <Label>ID de Cuenta</Label>
                                <Select value={destinoId} onValueChange={setDestinoId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione una cuenta" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="caja-chica">Caja Chica</SelectItem>
                                        <SelectItem value="caja-principal">Caja Principal</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {sugerencia.length > 0 && (
                                <div className="border rounded-lg p-4 bg-muted/30">
                                    <h4 className="font-semibold mb-2">Imputación Sugerida (IA)</h4>
                                    <div className="space-y-2">
                                        {sugerencia.map(sug => (
                                            <div key={sug.comprobante_id} className="flex justify-between text-sm">
                                                <span>{sug.numero}</span>
                                                <span className="font-semibold">${sug.monto.toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 justify-end pt-4">
                                <Button variant="outline" onClick={() => setModalOpen(false)}>
                                    Cancelar
                                </Button>
                                <Button onClick={handleConfirmar} disabled={procesando}>
                                    {procesando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                                    Confirmar
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </main>
        </div>
    )
}

