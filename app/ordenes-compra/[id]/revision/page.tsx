"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FileText, Package, DollarSign } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

interface ArticuloVerificacion {
    articulo_id: string
    sku: string
    descripcion: string
    // OC
    cantidad_pedida: number
    tipo_cantidad: string
    precio_oc: number
    descuentos_oc: number[]
    // Recepción
    cantidad_recibida: number | null
    // Factura (OCR)
    cantidad_facturada: number | null
    precio_factura: number | null
    // Diferencias
    dif_cantidad_recepcion: number
    dif_cantidad_factura: number
    dif_precio: number
    estado: "ok" | "diferencia_cantidad" | "diferencia_precio" | "faltante" | "sin_recepcion" | "sin_factura"
}

export default function RevisionOCPage() {
    const supabase = createClient()
    const params = useParams()
    const router = useRouter()
    const ordenId = params.id as string

    const [orden, setOrden] = useState<any>(null)
    const [articulos, setArticulos] = useState<ArticuloVerificacion[]>([])
    const [comprobantes, setComprobantes] = useState<any[]>([])
    const [recepciones, setRecepciones] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => { if (ordenId) loadAll() }, [ordenId])

    async function loadAll() {
        setLoading(true)
        try {
            // OC con proveedor
            const { data: oc } = await supabase
                .from("ordenes_compra")
                .select("*, proveedor:proveedores(nombre, sigla)")
                .eq("id", ordenId).single()
            setOrden(oc)

            // Detalle OC (lo pedido)
            const { data: detalle } = await supabase
                .from("ordenes_compra_detalle")
                .select("*, articulo:articulos(sku, descripcion, unidades_por_bulto)")
                .eq("orden_compra_id", ordenId)

            // Comprobantes
            const { data: comps } = await supabase
                .from("comprobantes_compra")
                .select("*")
                .eq("orden_compra_id", ordenId)
            setComprobantes(comps || [])

            // Recepciones
            const { data: recs } = await supabase
                .from("recepciones")
                .select("id, estado, fecha_fin")
                .eq("orden_compra_id", ordenId)
            setRecepciones(recs || [])

            // Items recibidos (de todas las recepciones de esta OC)
            const recIds = (recs || []).map(r => r.id)
            let recItems: any[] = []
            if (recIds.length > 0) {
                const { data: ri } = await supabase
                    .from("recepciones_items")
                    .select("*")
                    .in("recepcion_id", recIds)
                recItems = ri || []
            }

            // Build verification table
            const arts: ArticuloVerificacion[] = (detalle || []).map((d: any) => {
                const recItem = recItems.find(r => r.articulo_id === d.articulo_id)
                const cantPedida = d.cantidad_pedida || 0
                const cantRecibida = recItem ? (recItem.cantidad_fisica || 0) : null
                const cantFacturada = recItem ? (recItem.cantidad_documentada || 0) : null
                const precioOC = d.precio_unitario || 0
                const precioFact = recItem?.precio_documentado || null

                const difCantRec = cantRecibida !== null ? cantRecibida - cantPedida : 0
                const difCantFact = cantFacturada !== null && cantFacturada > 0 ? cantFacturada - cantPedida : 0
                const difPrecio = precioFact !== null && precioFact > 0 ? precioFact - precioOC : 0

                let estado: ArticuloVerificacion["estado"] = "ok"
                if (cantRecibida === null) estado = "sin_recepcion"
                else if (cantFacturada === null || cantFacturada === 0) estado = "sin_factura"
                else if (Math.abs(difCantRec) > 0.01 || Math.abs(difCantFact) > 0.01) estado = "diferencia_cantidad"
                else if (Math.abs(difPrecio) > 0.01) estado = "diferencia_precio"

                return {
                    articulo_id: d.articulo_id,
                    sku: d.articulo?.sku || "",
                    descripcion: d.articulo?.descripcion || "",
                    cantidad_pedida: cantPedida,
                    tipo_cantidad: d.tipo_cantidad || "unidad",
                    precio_oc: precioOC,
                    descuentos_oc: [d.descuento1, d.descuento2, d.descuento3, d.descuento4].filter(Boolean),
                    cantidad_recibida: cantRecibida,
                    cantidad_facturada: cantFacturada,
                    precio_factura: precioFact,
                    dif_cantidad_recepcion: difCantRec,
                    dif_cantidad_factura: difCantFact,
                    dif_precio: difPrecio,
                    estado
                }
            })

            setArticulos(arts)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    async function ajustarPrecioArticulo(art: ArticuloVerificacion) {
        if (!art.precio_factura || art.precio_factura <= 0) return
        const { error } = await supabase
            .from("articulos")
            .update({ precio_compra: art.precio_factura })
            .eq("id", art.articulo_id)
        if (error) {
            toast({ variant: "destructive", title: "Error", description: error.message })
        } else {
            toast({ title: "Precio actualizado", description: `${art.sku} → ${formatCurrency(art.precio_factura)}` })
            loadAll()
        }
    }

    async function enviarDiferenciaCC(art: ArticuloVerificacion) {
        if (!orden) return
        const dif = art.dif_precio * art.cantidad_pedida
        const { error } = await supabase.from("cuenta_corriente_proveedores").insert({
            proveedor_id: orden.proveedor_id,
            tipo_movimiento: "ajuste_precio",
            monto: dif,
            descripcion: `Ajuste diferencia precio ${art.sku} — OC ${orden.numero_orden}`,
            referencia_id: orden.id,
            referencia_tipo: "orden_compra",
            fecha: new Date().toISOString(),
        })
        if (error) {
            toast({ variant: "destructive", title: "Error", description: error.message })
        } else {
            toast({ title: "Ajuste registrado", description: `Diferencia de ${formatCurrency(dif)} enviada a CC` })
        }
    }

    async function finalizarOC() {
        if (!orden) return
        const pendientes = articulos.filter(a => a.estado === "sin_recepcion" || a.estado === "sin_factura")
        if (pendientes.length > 0) {
            const ok = confirm(`Hay ${pendientes.length} artículo(s) sin recepción o sin factura completa. ¿Finalizar igual?`)
            if (!ok) return
        }
        const { error } = await supabase
            .from("ordenes_compra")
            .update({ estado: "finalizada", updated_at: new Date().toISOString() })
            .eq("id", ordenId)
        if (error) {
            toast({ variant: "destructive", title: "Error", description: error.message })
        } else {
            toast({ title: "OC Finalizada", description: `${orden.numero_orden} marcada como finalizada` })
            router.push("/ordenes-compra")
        }
    }

    const totalOC = articulos.reduce((s, a) => s + (a.precio_oc * a.cantidad_pedida), 0)
    const totalFacturado = comprobantes.reduce((s, c) => s + Number(c.total_factura_declarado || 0), 0)
    const articulosOk = articulos.filter(a => a.estado === "ok").length
    const articulosConDif = articulos.filter(a => a.estado !== "ok").length

    // Check if OC can be finalized
    const todosRecibidos = articulos.every(a => a.cantidad_recibida !== null)
    const todosFacturados = comprobantes.length > 0

    function getEstadoBadge(estado: string) {
        switch (estado) {
            case "ok": return <Badge className="bg-green-100 text-green-700">OK</Badge>
            case "diferencia_cantidad": return <Badge className="bg-orange-100 text-orange-700">Dif. Cantidad</Badge>
            case "diferencia_precio": return <Badge className="bg-yellow-100 text-yellow-700">Dif. Precio</Badge>
            case "faltante": return <Badge className="bg-red-100 text-red-700">Faltante</Badge>
            case "sin_recepcion": return <Badge variant="secondary">Sin recepción</Badge>
            case "sin_factura": return <Badge variant="secondary">Sin factura</Badge>
            default: return <Badge variant="outline">{estado}</Badge>
        }
    }

    function formatDif(val: number) {
        if (Math.abs(val) < 0.01) return "—"
        const sign = val > 0 ? "+" : ""
        return <span className={val > 0 ? "text-red-600" : "text-green-600"}>{sign}{val.toFixed(2)}</span>
    }

    if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Cargando...</div>

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/ordenes-compra">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Revisión — {orden?.numero_orden}</h1>
                    <p className="text-muted-foreground">
                        {orden?.proveedor?.sigla || orden?.proveedor?.nombre} — Verificación triple
                    </p>
                </div>
            </div>

            {/* Resumen */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total OC</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{formatCurrency(totalOC)}</div></CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Facturado</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{formatCurrency(totalFacturado)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Comprobantes</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{comprobantes.length}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Artículos OK</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold text-green-600">{articulosOk}</div></CardContent>
                </Card>
                <Card className={articulosConDif > 0 ? "border-l-4 border-l-orange-500" : ""}>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Con diferencias</CardTitle></CardHeader>
                    <CardContent><div className={`text-xl font-bold ${articulosConDif > 0 ? "text-orange-600" : ""}`}>{articulosConDif}</div></CardContent>
                </Card>
            </div>

            {/* Comprobantes */}
            <Card className="mb-6">
                <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="h-4 w-4" /> Comprobantes asignados
                        </CardTitle>
                        <Link href={`/ordenes-compra/${ordenId}/comprobantes`}>
                            <Button variant="outline" size="sm">Cargar comprobante</Button>
                        </Link>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {comprobantes.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Sin comprobantes cargados</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30">
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Número</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-center">Estado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {comprobantes.map(c => (
                                    <TableRow key={c.id}>
                                        <TableCell><Badge variant="secondary">{c.tipo_comprobante}</Badge></TableCell>
                                        <TableCell className="font-mono">{c.numero_comprobante}</TableCell>
                                        <TableCell>{c.fecha_comprobante}</TableCell>
                                        <TableCell className="text-right font-bold">{formatCurrency(c.total_factura_declarado)}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge className={c.estado === "validado" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}>
                                                {c.estado}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Tabla de verificación triple */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" /> Verificación de artículos
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30">
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Descripción</TableHead>
                                    <TableHead className="text-right bg-blue-50">Cant. Pedida</TableHead>
                                    <TableHead className="text-right bg-purple-50">Cant. Recibida</TableHead>
                                    <TableHead className="text-right bg-green-50">Cant. Facturada</TableHead>
                                    <TableHead className="text-right bg-blue-50">Precio OC</TableHead>
                                    <TableHead className="text-right bg-green-50">Precio Factura</TableHead>
                                    <TableHead className="text-right">Dif. Precio</TableHead>
                                    <TableHead className="text-center">Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {articulos.map((art) => (
                                    <TableRow key={art.articulo_id} className={art.estado !== "ok" ? "bg-orange-50/30" : ""}>
                                        <TableCell className="font-mono text-sm">{art.sku}</TableCell>
                                        <TableCell className="text-sm max-w-[200px] truncate">{art.descripcion}</TableCell>
                                        <TableCell className="text-right font-mono bg-blue-50/30">{art.cantidad_pedida}</TableCell>
                                        <TableCell className="text-right font-mono bg-purple-50/30">
                                            {art.cantidad_recibida !== null ? art.cantidad_recibida : <span className="text-muted-foreground">—</span>}
                                            {art.dif_cantidad_recepcion !== 0 && <span className="text-xs ml-1">{formatDif(art.dif_cantidad_recepcion)}</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-mono bg-green-50/30">
                                            {art.cantidad_facturada !== null && art.cantidad_facturada > 0
                                                ? art.cantidad_facturada
                                                : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-mono bg-blue-50/30">{formatCurrency(art.precio_oc)}</TableCell>
                                        <TableCell className="text-right font-mono bg-green-50/30">
                                            {art.precio_factura && art.precio_factura > 0
                                                ? formatCurrency(art.precio_factura)
                                                : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatDif(art.dif_precio)}
                                        </TableCell>
                                        <TableCell className="text-center">{getEstadoBadge(art.estado)}</TableCell>
                                        <TableCell className="text-right">
                                            {art.estado === "diferencia_precio" && art.dif_precio !== 0 && (
                                                <div className="flex gap-1 justify-end">
                                                    <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:bg-blue-50"
                                                        onClick={() => ajustarPrecioArticulo(art)}
                                                        title="Ajustar precio del artículo al de la factura">
                                                        <DollarSign className="h-3 w-3 mr-1" /> Ajustar
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="text-xs text-orange-600 hover:bg-orange-50"
                                                        onClick={() => enviarDiferenciaCC(art)}
                                                        title="Enviar diferencia a cuenta corriente">
                                                        <AlertTriangle className="h-3 w-3 mr-1" /> A CC
                                                    </Button>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Acciones */}
            <div className="flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                    {todosRecibidos && todosFacturados
                        ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Todo recibido y facturado</span>
                        : <span className="text-orange-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />
                            {!todosRecibidos && "Faltan recepciones. "}
                            {!todosFacturados && "Faltan comprobantes."}
                        </span>
                    }
                </div>
                <div className="flex gap-3">
                    <Link href={`/ordenes-compra/${ordenId}/comprobantes`}>
                        <Button variant="outline" className="gap-2">
                            <FileText className="h-4 w-4" /> Cargar comprobante
                        </Button>
                    </Link>
                    <Button onClick={finalizarOC} className="gap-2"
                        variant={todosRecibidos && todosFacturados ? "default" : "outline"}>
                        <CheckCircle2 className="h-4 w-4" /> Finalizar OC
                    </Button>
                </div>
            </div>
        </div>
    )
}
