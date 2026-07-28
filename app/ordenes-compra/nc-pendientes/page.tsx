"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ArrowLeft, FileMinus, Loader2, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { todayArgentina } from "@/lib/utils"

const ORIGEN_LABELS: Record<string, string> = {
    descuento_fuera_factura: "Descuento fuera de factura",
    faltante: "Faltante",
    devolucion: "Devolución",
    diferencia_precio: "Diferencia de precio",
}

// NC que los proveedores nos deben: descuentos fuera de factura (fin de
// mes/trimestre), faltantes, devoluciones y diferencias de precio. Al llegar
// el documento se registra (acredita CC) y se imputa contra la factura asociada.
export default function NCPendientesPage() {
    const supabase = createClient()

    const [esperadas, setEsperadas] = useState<any[]>([])
    const [sinImputar, setSinImputar] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    // Dialog registrar
    const [registrando, setRegistrando] = useState<any>(null)
    const [numeroNC, setNumeroNC] = useState("")
    const [fechaNC, setFechaNC] = useState(todayArgentina())
    const [totalNC, setTotalNC] = useState<number>(0)
    const [imputarAuto, setImputarAuto] = useState(true)
    const [guardando, setGuardando] = useState(false)

    const cargar = useCallback(async () => {
        setLoading(true)
        const { data: esp } = await supabase
            .from("comprobantes_compra")
            .select(`
                id, numero_comprobante, fecha_comprobante, total_factura_declarado,
                origen_nc, comprobante_asociado_id, created_at,
                proveedor:proveedores(id, nombre),
                orden_compra:ordenes_compra(id, numero_orden),
                asociado:comprobantes_compra!comprobantes_compra_comprobante_asociado_id_fkey(id, tipo_comprobante, numero_comprobante)
            `)
            .eq("estado", "esperada")
            .order("created_at", { ascending: true })

        const { data: sinImp } = await supabase
            .from("comprobantes_compra")
            .select(`
                id, tipo_comprobante, numero_comprobante, fecha_comprobante,
                saldo_pendiente, comprobante_asociado_id, origen_nc,
                proveedor:proveedores(id, nombre)
            `)
            .in("tipo_comprobante", ["NC", "NCA", "NCB", "NCC", "Reversa"])
            .eq("estado", "validado")
            .lt("saldo_pendiente", -0.01)
            .order("fecha_comprobante", { ascending: true })

        setEsperadas(esp || [])
        setSinImputar(sinImp || [])
        setLoading(false)
    }, [supabase])

    useEffect(() => { cargar() }, [cargar])

    const abrirRegistro = (nc: any) => {
        setRegistrando(nc)
        setNumeroNC("")
        setFechaNC(todayArgentina())
        setTotalNC(Number(nc.total_factura_declarado || 0))
        setImputarAuto(!!nc.comprobante_asociado_id)
    }

    const registrarNC = async () => {
        if (!registrando) return
        if (!numeroNC.trim() || totalNC <= 0) {
            alert("Completá número y total de la NC")
            return
        }
        setGuardando(true)
        try {
            const res = await fetch(`/api/comprobantes-compra/${registrando.id}/registrar-nc`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    numero_comprobante: numeroNC,
                    fecha_comprobante: fechaNC,
                    total: totalNC,
                    imputar: imputarAuto,
                }),
            })
            const data = await res.json()
            if (!res.ok) {
                alert(data.error || "Error al registrar la NC")
                return
            }
            setRegistrando(null)
            cargar()
        } catch {
            alert("Error de conexión")
        } finally {
            setGuardando(false)
        }
    }

    const imputarManual = async (nc: any) => {
        if (!nc.comprobante_asociado_id) {
            alert("Esta NC no tiene factura asociada — imputala desde la cuenta corriente del proveedor")
            return
        }
        if (!confirm(`¿Imputar la NC ${nc.numero_comprobante} contra su factura asociada?`)) return
        const { error } = await supabase.rpc("ccp_imputar_credito", {
            p_credito_id: nc.id,
            p_debito_id: nc.comprobante_asociado_id,
            p_monto: null,
        })
        if (error) {
            alert(error.message)
            return
        }
        cargar()
    }

    const diasEsperando = (createdAt: string) => {
        const dias = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)
        return dias
    }

    const totalEsperado = esperadas.reduce((s, e) => s + Number(e.total_factura_declarado || 0), 0)

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/ordenes-compra">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <FileMinus className="h-7 w-7" /> NC de Proveedores
                    </h1>
                    <p className="text-muted-foreground">
                        Notas de crédito esperadas (descuentos fuera de factura, faltantes, devoluciones) y créditos sin imputar
                    </p>
                </div>
                <Card className="border-l-4 border-l-amber-500">
                    <CardContent className="py-3 px-4">
                        <p className="text-xs text-muted-foreground">Total esperado</p>
                        <p className="text-xl font-bold">${totalEsperado.toFixed(2)}</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>NC esperadas ({esperadas.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : esperadas.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">No hay notas de crédito esperadas.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Origen</TableHead>
                                    <TableHead>OC</TableHead>
                                    <TableHead>Factura asociada</TableHead>
                                    <TableHead className="text-right">Monto esperado</TableHead>
                                    <TableHead className="text-right">Días esperando</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {esperadas.map((nc) => {
                                    const dias = diasEsperando(nc.created_at)
                                    return (
                                        <TableRow key={nc.id}>
                                            <TableCell className="font-medium">{nc.proveedor?.nombre || "—"}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{ORIGEN_LABELS[nc.origen_nc] || nc.origen_nc || "—"}</Badge>
                                            </TableCell>
                                            <TableCell>{nc.orden_compra?.numero_orden || "—"}</TableCell>
                                            <TableCell className="text-xs">
                                                {nc.asociado ? `${nc.asociado.tipo_comprobante} ${nc.asociado.numero_comprobante}` : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">
                                                ${Number(nc.total_factura_declarado || 0).toFixed(2)}
                                            </TableCell>
                                            <TableCell className={`text-right ${dias > 45 ? "text-red-600 font-bold" : dias > 30 ? "text-amber-600" : ""}`}>
                                                {dias}
                                            </TableCell>
                                            <TableCell>
                                                <Button size="sm" onClick={() => abrirRegistro(nc)}>Llegó la NC</Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>NC registradas sin imputar ({sinImputar.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {sinImputar.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">No hay créditos pendientes de imputación.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Comprobante</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead className="text-right">Crédito disponible</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sinImputar.map((nc) => (
                                    <TableRow key={nc.id}>
                                        <TableCell className="font-medium">{nc.proveedor?.nombre || "—"}</TableCell>
                                        <TableCell>{nc.tipo_comprobante} {nc.numero_comprobante}</TableCell>
                                        <TableCell>{new Date(nc.fecha_comprobante).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</TableCell>
                                        <TableCell className="text-right font-semibold text-green-700">
                                            ${Math.abs(Number(nc.saldo_pendiente || 0)).toFixed(2)}
                                        </TableCell>
                                        <TableCell>
                                            <Button size="sm" variant="outline" onClick={() => imputarManual(nc)}
                                                disabled={!nc.comprobante_asociado_id}>
                                                <CheckCircle2 className="h-4 w-4 mr-1" /> Imputar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!registrando} onOpenChange={(open) => !open && setRegistrando(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Registrar NC recibida</DialogTitle>
                    </DialogHeader>
                    {registrando && (
                        <div className="space-y-4 py-2">
                            <div className="p-3 bg-muted rounded-lg text-sm">
                                <p className="font-semibold">{registrando.proveedor?.nombre}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {ORIGEN_LABELS[registrando.origen_nc] || registrando.origen_nc} · esperado $
                                    {Number(registrando.total_factura_declarado || 0).toFixed(2)}
                                </p>
                            </div>
                            <div>
                                <Label>Número de la NC *</Label>
                                <Input placeholder="0001-00000001" value={numeroNC} onChange={(e) => setNumeroNC(e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Fecha</Label>
                                    <Input type="date" value={fechaNC} onChange={(e) => setFechaNC(e.target.value)} />
                                </div>
                                <div>
                                    <Label>Total real *</Label>
                                    <Input type="number" step="0.01" value={totalNC || ""}
                                        onChange={(e) => setTotalNC(Number.parseFloat(e.target.value) || 0)} />
                                </div>
                            </div>
                            {registrando.comprobante_asociado_id && (
                                <div className="flex items-center space-x-2 p-3 bg-green-50 border border-green-200 rounded-md">
                                    <input type="checkbox" id="imputar-auto" checked={imputarAuto}
                                        onChange={(e) => setImputarAuto(e.target.checked)} className="h-4 w-4" />
                                    <Label htmlFor="imputar-auto" className="text-sm cursor-pointer">
                                        Imputar automáticamente contra la factura asociada
                                    </Label>
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRegistrando(null)}>Cancelar</Button>
                        <Button onClick={registrarNC} disabled={guardando}>
                            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar NC"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
