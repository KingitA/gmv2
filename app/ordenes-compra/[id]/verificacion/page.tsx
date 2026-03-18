"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FileText } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"

interface VerificationRow {
    articulo_id: string
    sku: string
    descripcion: string
    // OC
    cant_oc: number
    precio_oc: number
    // Factura (documentado)
    cant_facturada: number
    precio_factura: number
    // Depósito (recibido físico)
    cant_recibida: number
    // Diffs
    diff_cantidad: number // facturada - recibida
    diff_precio: number   // precio_factura - precio_oc
    status: "ok" | "diferencia_cantidad" | "diferencia_precio" | "faltante" | "ambas"
}

export default function VerificacionOCPage() {
    const supabase = createClient()
    const params = useParams()
    const router = useRouter()
    const ordenId = params.id as string

    const [orden, setOrden] = useState<any>(null)
    const [rows, setRows] = useState<VerificationRow[]>([])
    const [comprobantes, setComprobantes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => { if (ordenId) loadAll() }, [ordenId])

    async function loadAll() {
        setLoading(true)

        // Load OC with proveedor
        const { data: oc } = await supabase
            .from("ordenes_compra")
            .select("*, proveedor:proveedores(nombre, sigla)")
            .eq("id", ordenId)
            .single()
        setOrden(oc)

        // Load OC detail
        const { data: ocItems } = await supabase
            .from("ordenes_compra_detalle")
            .select("*, articulo:articulos(sku, descripcion, unidades_por_bulto)")
            .eq("orden_compra_id", ordenId)

        // Load comprobantes
        const { data: comps } = await supabase
            .from("comprobantes_compra")
            .select("*")
            .eq("orden_compra_id", ordenId)
        setComprobantes(comps || [])

        // Load recepciones + items for this OC
        const { data: recepciones } = await supabase
            .from("recepciones")
            .select("id")
            .eq("orden_compra_id", ordenId)

        let recItems: any[] = []
        if (recepciones && recepciones.length > 0) {
            const recIds = recepciones.map(r => r.id)
            const { data: items } = await supabase
                .from("recepciones_items")
                .select("*")
                .in("recepcion_id", recIds)
            recItems = items || []
        }

        // Build verification rows
        const tieneFactura = (comps || []).length > 0

        const verRows: VerificationRow[] = (ocItems || []).map((item: any) => {
            const artId = item.articulo_id
            const upb = item.articulo?.unidades_por_bulto || 1

            // OC quantities (in units)
            const cantOC = item.tipo_cantidad === "bulto"
                ? item.cantidad_pedida * upb
                : item.cantidad_pedida

            // Reception (physical count)
            const recItem = recItems.find(ri => ri.articulo_id === artId)
            const cantRecibida = recItem ? Number(recItem.cantidad_fisica) : 0

            // Factura (documented) — solo si hay comprobantes vinculados
            const cantFacturada = (tieneFactura && recItem) ? Number(recItem.cantidad_documentada || 0) : 0
            const precioOC = Number(item.precio_unitario) || 0
            const precioFactura = (tieneFactura && recItem) ? Number(recItem.precio_documentado || 0) : 0

            // Diferencias: solo calcular si hay datos reales
            let diffCant = 0
            let diffPrecio = 0

            if (tieneFactura && cantFacturada > 0) {
                diffCant = cantFacturada - cantRecibida
            } else {
                // Sin factura: comparar OC vs recibida para ver faltantes
                diffCant = cantOC - cantRecibida
            }

            if (tieneFactura && precioFactura > 0) {
                diffPrecio = precioFactura - precioOC
            }

            let status: VerificationRow["status"] = "ok"
            const hasDiffCant = Math.abs(diffCant) > 0.01
            const hasDiffPrecio = Math.abs(diffPrecio) > 0.01

            if (!tieneFactura) {
                // Sin factura: solo verificar OC vs recepción
                if (hasDiffCant) status = "diferencia_cantidad"
                else if (cantRecibida === 0 && cantOC > 0) status = "faltante"
            } else {
                if (hasDiffCant && hasDiffPrecio) status = "ambas"
                else if (hasDiffCant) status = "diferencia_cantidad"
                else if (hasDiffPrecio) status = "diferencia_precio"
                else if (cantRecibida === 0 && cantOC > 0) status = "faltante"
            }

            return {
                articulo_id: artId,
                sku: item.articulo?.sku || "",
                descripcion: item.articulo?.descripcion || "",
                cant_oc: cantOC,
                precio_oc: precioOC,
                cant_facturada: cantFacturada,
                precio_factura: precioFactura,
                cant_recibida: cantRecibida,
                diff_cantidad: diffCant,
                diff_precio: diffPrecio,
                status
            }
        })

        setRows(verRows)
        setLoading(false)
    }

    async function ajustarPrecioArticulo(articuloId: string, nuevoPrecio: number) {
        const { error } = await supabase
            .from("articulos")
            .update({ precio_compra: nuevoPrecio })
            .eq("id", articuloId)

        if (!error) {
            setRows(prev => prev.map(r =>
                r.articulo_id === articuloId
                    ? { ...r, precio_oc: nuevoPrecio, diff_precio: 0, status: r.diff_cantidad !== 0 ? "diferencia_cantidad" : "ok" }
                    : r
            ))
        }
    }

    async function enviarDiferenciaCC(row: VerificationRow) {
        if (!orden) return
        const monto = row.diff_precio * row.cant_recibida
        await supabase.from("cuenta_corriente_proveedores").insert({
            proveedor_id: orden.proveedor_id,
            tipo_movimiento: "ajuste_precio",
            monto: monto,
            descripcion: `Ajuste diferencia precio ${row.sku} — OC ${orden.numero_orden}`,
            referencia_id: ordenId,
            referencia_tipo: "orden_compra",
            fecha: new Date().toISOString(),
        })
        alert(`Ajuste de ${formatCurrency(monto)} enviado a cuenta corriente`)
    }

    async function finalizarOC() {
        if (!confirm("¿Finalizar esta orden de compra? Verificá que todas las diferencias estén resueltas.")) return
        await supabase.from("ordenes_compra").update({ estado: "finalizada" }).eq("id", ordenId)
        router.push("/ordenes-compra")
    }

    const totalOC = rows.reduce((s, r) => s + r.precio_oc * r.cant_oc, 0)
    const totalFacturado = comprobantes.reduce((s: number, c: any) => s + Number(c.total_factura_declarado || 0), 0)
    const tieneFactura = comprobantes.length > 0
    const itemsOK = rows.filter(r => r.status === "ok").length
    const itemsDiff = rows.filter(r => r.status !== "ok").length
    const allOK = itemsDiff === 0 && rows.length > 0 && tieneFactura

    const statusIcon = (s: VerificationRow["status"]) => {
        switch (s) {
            case "ok": return <CheckCircle2 className="h-4 w-4 text-green-500" />
            case "faltante": return <XCircle className="h-4 w-4 text-red-500" />
            default: return <AlertTriangle className="h-4 w-4 text-orange-500" />
        }
    }

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/ordenes-compra">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">
                        Verificación — {orden?.numero_orden}
                    </h1>
                    <p className="text-muted-foreground">
                        {orden?.proveedor?.sigla || orden?.proveedor?.nombre} — Triple verificación: OC vs Factura vs Depósito
                    </p>
                </div>
                {allOK && (
                    <Button onClick={finalizarOC} className="gap-2 bg-green-600 hover:bg-green-700">
                        <CheckCircle2 className="h-4 w-4" /> Finalizar OC
                    </Button>
                )}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total OC</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{formatCurrency(totalOC)}</div></CardContent>
                </Card>
                <Card className="border-l-4 border-l-purple-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Facturado</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{tieneFactura ? formatCurrency(totalFacturado) : <span className="text-muted-foreground">Sin factura</span>}</div></CardContent>
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

            {/* No factura warning */}
            {!tieneFactura && (
                <Card className="mb-6 border-orange-200 bg-orange-50">
                    <CardContent className="py-4 flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-orange-800">Sin factura vinculada</p>
                            <p className="text-xs text-orange-600">
                                Esta OC no tiene comprobantes cargados. Cargá la factura desde "Comprobantes" para completar la verificación triple.
                                Solo se compara OC vs Depósito.
                            </p>
                        </div>
                        <Button variant="outline" size="sm" className="ml-auto"
                            onClick={() => router.push(`/ordenes-compra/${ordenId}/comprobantes`)}>
                            <FileText className="h-4 w-4 mr-1" /> Cargar comprobante
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Comprobantes */}
            {comprobantes.length > 0 && (
                <Card className="mb-6">
                    <CardHeader className="py-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <FileText className="h-4 w-4" /> Comprobantes vinculados
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="py-2">
                        <div className="flex gap-3 flex-wrap">
                            {comprobantes.map(c => (
                                <Badge key={c.id} variant="outline" className="text-xs py-1 px-3">
                                    {c.tipo_comprobante} {c.numero_comprobante} — {formatCurrency(c.total_factura_declarado)}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Verification table */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="w-[40px]"></TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead className="text-right">Cant. OC</TableHead>
                                <TableHead className="text-right">Cant. Recibida</TableHead>
                                <TableHead className="text-right">Cant. Facturada</TableHead>
                                <TableHead className="text-right">Precio OC</TableHead>
                                <TableHead className="text-right">Precio Factura</TableHead>
                                <TableHead className="text-center">Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={10} className="text-center h-20">Cargando...</TableCell></TableRow>
                            ) : rows.length === 0 ? (
                                <TableRow><TableCell colSpan={10} className="text-center h-20 text-muted-foreground">Sin artículos en esta OC</TableCell></TableRow>
                            ) : rows.map(row => {
                                const hasPriceDiff = Math.abs(row.diff_precio) > 0.01
                                const hasQtyDiff = Math.abs(row.diff_cantidad) > 0.01

                                return (
                                    <TableRow key={row.articulo_id} className={row.status !== "ok" ? "bg-orange-50/50" : ""}>
                                        <TableCell>{statusIcon(row.status)}</TableCell>
                                        <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                                        <TableCell className="text-sm max-w-[200px] truncate">{row.descripcion}</TableCell>
                                        <TableCell className="text-right font-mono">{row.cant_oc}</TableCell>
                                        <TableCell className={`text-right font-mono ${hasQtyDiff ? "text-orange-600 font-bold" : ""}`}>
                                            {row.cant_recibida}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {row.cant_facturada > 0 ? row.cant_facturada : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{formatCurrency(row.precio_oc)}</TableCell>
                                        <TableCell className={`text-right font-mono ${hasPriceDiff ? "text-orange-600 font-bold" : ""}`}>
                                            {row.precio_factura > 0 ? formatCurrency(row.precio_factura) : <span className="text-muted-foreground">—</span>}
                                            {hasPriceDiff && (
                                                <div className="text-[10px] text-orange-500">
                                                    {row.diff_precio > 0 ? "+" : ""}{formatCurrency(row.diff_precio)}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={row.status === "ok" ? "default" : "destructive"}
                                                className={row.status === "ok" ? "bg-green-500 text-xs" : "bg-orange-500 text-xs"}>
                                                {row.status === "ok" ? "OK"
                                                    : row.status === "faltante" ? "Faltante"
                                                        : row.status === "diferencia_precio" ? "Δ Precio"
                                                            : row.status === "diferencia_cantidad" ? "Δ Cant."
                                                                : "Δ Ambas"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {hasPriceDiff && (
                                                <div className="flex gap-1 justify-end">
                                                    <Button variant="outline" size="sm" className="text-xs h-7"
                                                        onClick={() => ajustarPrecioArticulo(row.articulo_id, row.precio_factura)}
                                                        title="Actualizar precio del artículo al precio de factura">
                                                        Ajustar precio
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="text-xs h-7 text-orange-600"
                                                        onClick={() => enviarDiferenciaCC(row)}
                                                        title="Enviar diferencia a cuenta corriente">
                                                        Dif. a CC
                                                    </Button>
                                                </div>
                                            )}
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
