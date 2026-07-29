"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Truck, Loader2 } from "lucide-react"
import { formatCurrency, formatDateAR } from "@/lib/utils"

const TIPO_LABELS: Record<string, string> = {
    faltante_mercaderia: "Faltante de mercadería",
    pago: "Pago",
    ajuste: "Ajuste",
}

// Cuenta corriente de transportes: faltantes de bultos/mercadería imputados
// desde la verificación de recepciones, pagos y ajustes manuales.
export default function TransportesPage() {
    const [transportes, setTransportes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    // Detalle CC
    const [ccAbierta, setCcAbierta] = useState<any>(null)
    const [movimientos, setMovimientos] = useState<any[]>([])
    const [saldo, setSaldo] = useState(0)
    const [cargandoCC, setCargandoCC] = useState(false)

    // Movimiento manual
    const [nuevoTipo, setNuevoTipo] = useState<string>("pago")
    const [nuevoMonto, setNuevoMonto] = useState<number>(0)
    const [nuevaDesc, setNuevaDesc] = useState("")
    const [guardando, setGuardando] = useState(false)

    const cargar = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/transportes")
            if (res.ok) setTransportes(await res.json())
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { cargar() }, [cargar])

    const abrirCC = async (t: any) => {
        setCcAbierta(t)
        setCargandoCC(true)
        setNuevoTipo("pago")
        setNuevoMonto(0)
        setNuevaDesc("")
        try {
            const res = await fetch(`/api/transportes/${t.id}/cuenta-corriente`)
            const data = await res.json()
            if (res.ok) {
                setMovimientos(data.movimientos || [])
                setSaldo(data.saldo || 0)
            }
        } finally {
            setCargandoCC(false)
        }
    }

    const registrarMovimiento = async () => {
        if (!ccAbierta || nuevoMonto <= 0) {
            alert("Ingresá un monto mayor a 0")
            return
        }
        setGuardando(true)
        try {
            const res = await fetch(`/api/transportes/${ccAbierta.id}/cuenta-corriente`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tipo_movimiento: nuevoTipo, monto: nuevoMonto, descripcion: nuevaDesc || undefined }),
            })
            const data = await res.json()
            if (!res.ok) {
                alert(data.error || "Error al registrar")
                return
            }
            await abrirCC(ccAbierta)
            cargar()
        } finally {
            setGuardando(false)
        }
    }

    const totalDeuda = transportes.reduce((s, t) => s + Math.max(0, Number(t.saldo || 0)), 0)

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Truck className="h-7 w-7" /> Cuenta Corriente Transportes
                    </h1>
                    <p className="text-muted-foreground">
                        Faltantes imputados desde recepciones, pagos y ajustes
                    </p>
                </div>
                <Card className="border-l-4 border-l-blue-500">
                    <CardContent className="py-3 px-4">
                        <p className="text-xs text-muted-foreground">Deuda total de transportes</p>
                        <p className="text-xl font-bold">{formatCurrency(totalDeuda)}</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className="pt-6">
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Transporte</TableHead>
                                    <TableHead>CUIT</TableHead>
                                    <TableHead>Teléfono</TableHead>
                                    <TableHead className="text-right">Saldo</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {transportes.map((t) => (
                                    <TableRow key={t.id} className={!t.activo ? "opacity-50" : ""}>
                                        <TableCell className="font-medium">{t.nombre}</TableCell>
                                        <TableCell className="font-mono text-sm">{t.cuit || "—"}</TableCell>
                                        <TableCell>{t.telefono || "—"}</TableCell>
                                        <TableCell className={`text-right font-semibold ${Number(t.saldo) > 0 ? "text-red-600" : ""}`}>
                                            {formatCurrency(Number(t.saldo || 0))}
                                        </TableCell>
                                        <TableCell>
                                            <Button size="sm" variant="outline" onClick={() => abrirCC(t)}>Ver CC</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!ccAbierta} onOpenChange={(open) => !open && setCcAbierta(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {ccAbierta?.nombre}
                            <Badge variant={saldo > 0 ? "destructive" : "secondary"}>
                                Saldo {formatCurrency(saldo)}
                            </Badge>
                        </DialogTitle>
                    </DialogHeader>

                    {cargandoCC ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : (
                        <div className="space-y-4">
                            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                                <p className="text-sm font-semibold">Registrar movimiento manual</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label className="text-xs">Tipo</Label>
                                        <Select value={nuevoTipo} onValueChange={setNuevoTipo}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="pago">Pago del transporte (baja deuda)</SelectItem>
                                                <SelectItem value="ajuste">Ajuste (suma deuda)</SelectItem>
                                                <SelectItem value="faltante_mercaderia">Faltante manual</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label className="text-xs">Monto</Label>
                                        <Input type="number" step="0.01" value={nuevoMonto || ""}
                                            onChange={(e) => setNuevoMonto(Number.parseFloat(e.target.value) || 0)} />
                                    </div>
                                </div>
                                <Textarea rows={2} placeholder="Descripción (opcional)" value={nuevaDesc}
                                    onChange={(e) => setNuevaDesc(e.target.value)} />
                                <Button size="sm" onClick={registrarMovimiento} disabled={guardando}>
                                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar"}
                                </Button>
                            </div>

                            {movimientos.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4">Sin movimientos.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Fecha</TableHead>
                                            <TableHead>Tipo</TableHead>
                                            <TableHead>Descripción</TableHead>
                                            <TableHead className="text-right">Monto</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {movimientos.map((m) => (
                                            <TableRow key={m.id}>
                                                <TableCell className="text-xs">
                                                    {formatDateAR(m.fecha)}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{TIPO_LABELS[m.tipo_movimiento] || m.tipo_movimiento}</Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">{m.descripcion || "—"}</TableCell>
                                                <TableCell className={`text-right font-semibold ${Number(m.monto) < 0 ? "text-green-700" : ""}`}>
                                                    {formatCurrency(Number(m.monto))}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCcAbierta(null)}>Cerrar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
