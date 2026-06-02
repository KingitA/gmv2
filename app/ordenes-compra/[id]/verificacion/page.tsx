"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FileText, CreditCard, Scale } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface CompData {
    id: string
    tipo: string // FA, ADQ, NCA, etc
    numero: string
    total: number
    items: Record<string, { cantidad: number; precio: number }> // keyed by articulo_id
}

interface VerRow {
    articulo_id: string
    sku: string
    descripcion: string
    cant_oc: number
    precio_oc: number
    cant_recibida: number
    // Per-comprobante data filled dynamically
    comp_data: Record<string, { cantidad: number; precio: number }> // keyed by comprobante id
    cant_total_facturada: number
    status: "ok" | "diferencia_cantidad" | "diferencia_precio" | "faltante" | "ambas"
}

export default function VerificacionOCPage() {
    const supabase = createClient()
    const params = useParams()
    const router = useRouter()
    const ordenId = params.id as string

    const [orden, setOrden] = useState<any>(null)
    const [rows, setRows] = useState<VerRow[]>([])
    const [comprobantes, setComprobantes] = useState<CompData[]>([])
    const [loading, setLoading] = useState(true)
    const [recepcionId, setRecepcionId] = useState<string | null>(null)
    const [transportes, setTransportes] = useState<any[]>([])

    // Resolution dialog state
    const [resolviendoRow, setResolviendoRow] = useState<VerRow | null>(null)
    const [resolucionTipo, setResolucionTipo] = useState<'mercaderia' | 'precio'>('mercaderia')
    const [resolucionAccion, setResolucionAccion] = useState<'A' | 'B' | 'C'>('A')
    const [resolucionTransporte, setResolucionTransporte] = useState<string>('')
    const [resolucionDesc, setResolucionDesc] = useState<string>('')
    const [resolviendoItems, setResolviendoItems] = useState<Set<string>>(new Set())
    const [resoluciones, setResoluciones] = useState<Record<string, string>>({}) // articulo_id → destino

    useEffect(() => { if (ordenId) loadAll() }, [ordenId])
    useEffect(() => {
        supabase.from('transportes').select('id, nombre').eq('activo', true).order('nombre')
            .then(({ data }) => setTransportes(data || []))
    }, [])

    async function loadAll() {
        setLoading(true)

        const { data: oc } = await supabase
            .from("ordenes_compra")
            .select("*, proveedor:proveedores(nombre, sigla)")
            .eq("id", ordenId).single()
        setOrden(oc)

        const { data: ocItems } = await supabase
            .from("ordenes_compra_detalle")
            .select("*, articulo:articulos(sku, descripcion, unidades_por_bulto)")
            .eq("orden_compra_id", ordenId)

        const { data: comps } = await supabase
            .from("comprobantes_compra")
            .select("id, tipo_comprobante, numero_comprobante, total_factura_declarado")
            .eq("orden_compra_id", ordenId)

        // Load article-level detail from comprobantes_compra_detalle
        const compIds = (comps || []).map((c: any) => c.id)
        let compDetalle: any[] = []
        if (compIds.length > 0) {
            const { data: det } = await supabase
                .from("comprobantes_compra_detalle")
                .select("comprobante_id, articulo_id, cantidad_facturada, precio_unitario, tipo_cantidad")
                .in("comprobante_id", compIds)
            compDetalle = det || []
        }

        const { data: recepciones } = await supabase
            .from("recepciones").select("id").eq("orden_compra_id", ordenId)
            .order("created_at", { ascending: false })

        let recItems: any[] = []
        if (recepciones && recepciones.length > 0) {
            setRecepcionId(recepciones[0].id)
            const { data } = await supabase
                .from("recepciones_items").select("*, cantidad_diferencia_destino")
                .in("recepcion_id", recepciones.map(r => r.id))
            recItems = data || []
        }

        // Build comprobantes data with article-level info from detalle table
        const compDataList: CompData[] = (comps || []).map((c: any) => {
            const items: Record<string, { cantidad: number; precio: number }> = {}
            const detalleRows = compDetalle.filter((d: any) => d.comprobante_id === c.id)

            for (const det of detalleRows) {
                if (det.articulo_id) {
                    if (items[det.articulo_id]) {
                        items[det.articulo_id].cantidad += Number(det.cantidad_facturada) || 0
                    } else {
                        items[det.articulo_id] = {
                            cantidad: Number(det.cantidad_facturada) || 0,
                            precio: Number(det.precio_unitario) || 0
                        }
                    }
                }
            }

            return {
                id: c.id,
                tipo: c.tipo_comprobante,
                numero: c.numero_comprobante,
                total: c.total_factura_declarado,
                items
            }
        })
        setComprobantes(compDataList)

        // Build rows
        const verRows: VerRow[] = (ocItems || []).map((item: any) => {
            const artId = item.articulo_id
            const upb = item.articulo?.unidades_por_bulto || 1
            const cantOC = item.tipo_cantidad === "bulto" ? item.cantidad_pedida * upb : item.cantidad_pedida
            const precioOC = Number(item.precio_unitario) || 0

            const recItem = recItems.find(ri => ri.articulo_id === artId)
            const cantRecibida = recItem ? Number(recItem.cantidad_fisica) : 0

            // Collect per-comprobante data
            const compDataForArt: Record<string, { cantidad: number; precio: number }> = {}
            let cantTotalFacturada = 0

            for (const cd of compDataList) {
                const artData = cd.items[artId]
                if (artData) {
                    compDataForArt[cd.id] = artData
                    // NC/NDA subtract
                    if (cd.tipo.startsWith("NC") || cd.tipo.startsWith("ND")) {
                        cantTotalFacturada -= artData.cantidad
                    } else {
                        cantTotalFacturada += artData.cantidad
                    }
                }
            }

            const hasComps = compDataList.length > 0
            const hasOCRData = Object.keys(compDataForArt).length > 0

            let diffCant = hasOCRData ? cantTotalFacturada - cantRecibida : cantOC - cantRecibida
            let status: VerRow["status"] = "ok"
            if (Math.abs(diffCant) > 0.01) status = "diferencia_cantidad"
            if (cantRecibida === 0 && cantOC > 0) status = "faltante"

            return {
                articulo_id: artId,
                sku: item.articulo?.sku || "",
                descripcion: item.articulo?.descripcion || "",
                cant_oc: cantOC,
                precio_oc: precioOC,
                cant_recibida: cantRecibida,
                comp_data: compDataForArt,
                cant_total_facturada: cantTotalFacturada,
                status
            }
        })

        setRows(verRows)
        setLoading(false)
    }

    async function ajustarPrecio(articuloId: string, precio: number) {
        await supabase.from("articulos").update({ precio_compra: precio }).eq("id", articuloId)
        alert("Precio actualizado")
    }

    function abrirResolucion(row: VerRow) {
        setResolviendoRow(row)
        setResolucionTipo('mercaderia')
        setResolucionAccion('A')
        setResolucionTransporte(transportes[0]?.id || '')
        setResolucionDesc('')
    }

    async function confirmarResolucion() {
        if (!resolviendoRow || !recepcionId) return

        // Find the recepciones_item for this articulo
        const { data: recItems } = await supabase
            .from('recepciones_items')
            .select('id, cantidad_oc, cantidad_fisica')
            .eq('recepcion_id', recepcionId)
            .eq('articulo_id', resolviendoRow.articulo_id)
            .maybeSingle()

        if (!recItems) {
            alert('No se encontró el ítem en la recepción')
            setResolviendoRow(null)
            return
        }

        const cantFaltante = resolviendoRow.cant_oc - resolviendoRow.cant_recibida

        const decision = {
            item_id: recItems.id,
            tipo: resolucionTipo,
            accion: resolucionAccion,
            transporte_id: resolucionAccion === 'B' ? resolucionTransporte : undefined,
            valor_real: cantFaltante,
            descripcion: resolucionDesc || undefined,
        }

        const res = await fetch(`/api/recepciones/${recepcionId}/cerrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decisions: [decision] }),
        })

        const data = await res.json()
        if (!res.ok) {
            alert(data.error || 'Error al resolver')
            return
        }

        const destino = resolucionAccion === 'A' ? 'empresa' : resolucionAccion === 'B' ? 'transporte' : 'proveedor'
        setResoluciones(prev => ({ ...prev, [resolviendoRow.articulo_id]: destino }))
        setResolviendoRow(null)
    }

    async function finalizarOC() {
        if (!confirm("¿Finalizar esta OC?")) return
        await supabase.from("ordenes_compra").update({ estado: "finalizada" }).eq("id", ordenId)
        router.push("/ordenes-compra")
    }

    async function generarOrdenPago() {
        // Pre-fill the OP with OC data and navigate
        const params = new URLSearchParams({
            proveedor_id: orden?.proveedor_id || '',
            orden_compra_id: ordenId,
            monto: String(totalFacturado),
        })
        router.push(`/ordenes-pago/nueva?${params}`)
    }

    const tieneComps = comprobantes.length > 0
    const tieneOCR = comprobantes.some(c => Object.keys(c.items).length > 0)
    const totalOC = rows.reduce((s, r) => s + r.precio_oc * r.cant_oc, 0)
    const totalFacturado = comprobantes.reduce((s, c) => s + c.total, 0)
    const itemsOK = rows.filter(r => r.status === "ok").length
    const itemsDiff = rows.filter(r => r.status !== "ok").length
    const allOK = itemsDiff === 0 && rows.length > 0 && tieneComps

    // How many unique comp types (for dynamic columns)
    const showMultipleComps = comprobantes.length > 1

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/ordenes-compra">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">Verificación — {orden?.numero_orden}</h1>
                    <p className="text-muted-foreground">
                        {orden?.proveedor?.sigla || orden?.proveedor?.nombre} — Triple verificación
                    </p>
                </div>
                <div className="flex gap-2">
                    {allOK && (
                        <>
                            <Button onClick={finalizarOC} className="gap-2 bg-green-600 hover:bg-green-700">
                                <CheckCircle2 className="h-4 w-4" /> Finalizar OC
                            </Button>
                            <Button onClick={generarOrdenPago} variant="outline" className="gap-2">
                                <CreditCard className="h-4 w-4" /> Generar Orden de Pago
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total OC</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{formatCurrency(totalOC)}</div></CardContent>
                </Card>
                <Card className="border-l-4 border-l-purple-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Facturado</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{tieneComps ? formatCurrency(totalFacturado) : <span className="text-muted-foreground">Sin comprobantes</span>}</div></CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Artículos OK</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold text-green-600">{itemsOK} / {rows.length}</div></CardContent>
                </Card>
                <Card className={`border-l-4 ${itemsDiff > 0 ? "border-l-orange-500" : "border-l-green-500"}`}>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Con Diferencias</CardTitle></CardHeader>
                    <CardContent><div className={`text-xl font-bold ${itemsDiff > 0 ? "text-orange-600" : "text-green-600"}`}>{itemsDiff}</div></CardContent>
                </Card>
            </div>

            {!tieneComps && (
                <Card className="mb-6 border-orange-200 bg-orange-50">
                    <CardContent className="py-4 flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                        <div>
                            <p className="text-sm font-medium text-orange-800">Sin comprobantes vinculados</p>
                            <p className="text-xs text-orange-600">Cargá la factura para completar la verificación.</p>
                        </div>
                        <Button variant="outline" size="sm" className="ml-auto"
                            onClick={() => router.push(`/ordenes-compra/${ordenId}/comprobantes`)}>
                            <FileText className="h-4 w-4 mr-1" /> Cargar comprobante
                        </Button>
                    </CardContent>
                </Card>
            )}

            {tieneComps && (
                <Card className="mb-6">
                    <CardHeader className="py-3">
                        <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Comprobantes vinculados</CardTitle>
                    </CardHeader>
                    <CardContent className="py-2">
                        <div className="flex gap-3 flex-wrap">
                            {comprobantes.map(c => (
                                <Badge key={c.id} variant="outline" className="text-xs py-1 px-3">
                                    {c.tipo} {c.numero} — {formatCurrency(c.total)}
                                    {Object.keys(c.items).length > 0 && <span className="ml-1 text-green-600">✓ detalle</span>}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── DIALOG RESOLUCIÓN FALTANTES ── */}
            <Dialog open={!!resolviendoRow} onOpenChange={open => !open && setResolviendoRow(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Scale className="h-5 w-5 text-orange-500" />
                            Resolver diferencia
                        </DialogTitle>
                    </DialogHeader>
                    {resolviendoRow && (
                        <div className="space-y-4 py-2">
                            <div className="p-3 bg-muted rounded-lg text-sm">
                                <p className="font-semibold truncate">{resolviendoRow.descripcion}</p>
                                <p className="text-muted-foreground font-mono text-xs mt-1">{resolviendoRow.sku}</p>
                                <div className="flex gap-4 mt-2 text-xs">
                                    <span>OC: <strong>{resolviendoRow.cant_oc}</strong></span>
                                    <span>Recibido: <strong>{resolviendoRow.cant_recibida}</strong></span>
                                    <span className="text-orange-600">Faltante: <strong>{resolviendoRow.cant_oc - resolviendoRow.cant_recibida}</strong></span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Tipo de diferencia</Label>
                                <Select value={resolucionTipo} onValueChange={(v: any) => setResolucionTipo(v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="mercaderia">Diferencia de mercadería (cantidad)</SelectItem>
                                        <SelectItem value="precio">Diferencia de precio</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>¿A quién se imputa?</Label>
                                <div className="grid gap-2">
                                    {[
                                        { value: 'A', label: '↩ Empresa absorbe', desc: 'Se desestima la diferencia, sin movimiento en cuentas', color: 'border-gray-300' },
                                        { value: 'B', label: '🚚 Transporte', desc: 'Se registra en la cuenta corriente del transporte', color: 'border-blue-300' },
                                        { value: 'C', label: '🏭 Proveedor', desc: 'Se genera devolución y movimiento en CC proveedor', color: 'border-red-300' },
                                    ].map(opt => (
                                        <button key={opt.value}
                                            onClick={() => setResolucionAccion(opt.value as any)}
                                            className={`text-left p-3 rounded-lg border-2 transition-colors ${resolucionAccion === opt.value ? opt.color + ' bg-muted' : 'border-muted hover:border-muted-foreground/30'}`}>
                                            <div className="font-semibold text-sm">{opt.label}</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {resolucionAccion === 'B' && (
                                <div className="space-y-2">
                                    <Label>Transporte responsable</Label>
                                    <Select value={resolucionTransporte} onValueChange={setResolucionTransporte}>
                                        <SelectTrigger><SelectValue placeholder="Seleccionar transporte..." /></SelectTrigger>
                                        <SelectContent>
                                            {transportes.map(t => (
                                                <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {transportes.length === 0 && (
                                        <Alert><AlertDescription className="text-xs">No hay transportes activos cargados en el sistema.</AlertDescription></Alert>
                                    )}
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label>Observaciones (opcional)</Label>
                                <Textarea value={resolucionDesc} onChange={e => setResolucionDesc(e.target.value)}
                                    placeholder="Detalle adicional..." rows={2} />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResolviendoRow(null)}>Cancelar</Button>
                        <Button onClick={confirmarResolucion}
                            disabled={resolucionAccion === 'B' && !resolucionTransporte}>
                            Confirmar resolución
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="w-[30px]"></TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead className="text-right">Cant. OC</TableHead>
                                <TableHead className="text-right">Cant. Recibida</TableHead>
                                {/* Dynamic columns per comprobante */}
                                {comprobantes.map(c => (
                                    <TableHead key={`h-cant-${c.id}`} className="text-right text-xs">
                                        Cant. {c.tipo}<br /><span className="text-[10px] text-muted-foreground">{c.numero}</span>
                                    </TableHead>
                                ))}
                                {showMultipleComps && (
                                    <TableHead className="text-right font-bold">Total Fact.</TableHead>
                                )}
                                <TableHead className="text-right">Precio OC</TableHead>
                                {comprobantes.map(c => (
                                    <TableHead key={`h-pre-${c.id}`} className="text-right text-xs">
                                        Precio {c.tipo}<br /><span className="text-[10px] text-muted-foreground">{c.numero}</span>
                                    </TableHead>
                                ))}
                                <TableHead className="text-center">Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={20} className="text-center h-20">Cargando...</TableCell></TableRow>
                            ) : rows.length === 0 ? (
                                <TableRow><TableCell colSpan={20} className="text-center h-20 text-muted-foreground">Sin artículos</TableCell></TableRow>
                            ) : rows.map(row => {
                                const hasDiff = row.status !== "ok"

                                return (
                                    <TableRow key={row.articulo_id} className={hasDiff ? "bg-orange-50/50" : ""}>
                                        <TableCell>
                                            {row.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                : row.status === "faltante" ? <XCircle className="h-4 w-4 text-red-500" />
                                                    : <AlertTriangle className="h-4 w-4 text-orange-500" />}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                                        <TableCell className="text-sm max-w-[180px] truncate">{row.descripcion}</TableCell>
                                        <TableCell className="text-right font-mono">{row.cant_oc}</TableCell>
                                        <TableCell className={`text-right font-mono ${hasDiff ? "text-orange-600 font-bold" : ""}`}>
                                            {row.cant_recibida}
                                        </TableCell>
                                        {/* Cant per comprobante */}
                                        {comprobantes.map(c => {
                                            const d = row.comp_data[c.id]
                                            return (
                                                <TableCell key={`c-${c.id}`} className="text-right font-mono text-sm">
                                                    {d ? d.cantidad : <span className="text-muted-foreground">—</span>}
                                                </TableCell>
                                            )
                                        })}
                                        {showMultipleComps && (
                                            <TableCell className="text-right font-mono font-bold">
                                                {row.cant_total_facturada > 0 ? row.cant_total_facturada : <span className="text-muted-foreground">—</span>}
                                            </TableCell>
                                        )}
                                        <TableCell className="text-right font-mono">{formatCurrency(row.precio_oc)}</TableCell>
                                        {/* Precio per comprobante */}
                                        {comprobantes.map(c => {
                                            const d = row.comp_data[c.id]
                                            return (
                                                <TableCell key={`p-${c.id}`} className="text-right font-mono text-sm">
                                                    {d && d.precio > 0 ? formatCurrency(d.precio) : <span className="text-muted-foreground">—</span>}
                                                </TableCell>
                                            )
                                        })}
                                        <TableCell className="text-center">
                                            <Badge className={`text-xs ${row.status === "ok" ? "bg-green-500" : "bg-orange-500"}`}>
                                                {row.status === "ok" ? "OK" : row.status === "faltante" ? "Faltante" : "Δ Cant."}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {hasDiff && resoluciones[row.articulo_id] ? (
                                                <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                                                    {resoluciones[row.articulo_id] === 'empresa' ? '↩ Empresa' :
                                                     resoluciones[row.articulo_id] === 'transporte' ? '🚚 Transporte' :
                                                     '🏭 Proveedor'}
                                                </Badge>
                                            ) : hasDiff ? (
                                                <Button variant="outline" size="sm" className="text-xs h-7 text-orange-600 gap-1"
                                                    onClick={() => abrirResolucion(row)}>
                                                    <Scale className="h-3 w-3" /> Resolver
                                                </Button>
                                            ) : null}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
