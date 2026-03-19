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

    useEffect(() => { if (ordenId) loadAll() }, [ordenId])

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
            .select("id, tipo_comprobante, numero_comprobante, total_factura_declarado, datos_ocr")
            .eq("orden_compra_id", ordenId)

        const { data: recepciones } = await supabase
            .from("recepciones").select("id").eq("orden_compra_id", ordenId)

        let recItems: any[] = []
        if (recepciones && recepciones.length > 0) {
            const { data } = await supabase
                .from("recepciones_items").select("*")
                .in("recepcion_id", recepciones.map(r => r.id))
            recItems = data || []
        }

        // Build comprobantes data with article-level info from OCR
        const compDataList: CompData[] = (comps || []).map((c: any) => {
            const items: Record<string, { cantidad: number; precio: number }> = {}
            const ocrItems = c.datos_ocr?.items || []

            // Match OCR items to OC articles by SKU
            for (const ocrItem of ocrItems) {
                const code = String(ocrItem.codigo || "").trim()
                const desc = String(ocrItem.descripcion || "").toLowerCase()

                const match = (ocItems || []).find((oci: any) => {
                    if (code && oci.articulo?.sku === code) return true
                    if (desc) {
                        const artDesc = (oci.articulo?.descripcion || "").toLowerCase()
                        return artDesc.includes(desc) || desc.includes(artDesc)
                    }
                    return false
                })

                if (match) {
                    const artId = match.articulo_id
                    if (items[artId]) {
                        items[artId].cantidad += Number(ocrItem.cantidad) || 0
                    } else {
                        items[artId] = {
                            cantidad: Number(ocrItem.cantidad) || 0,
                            precio: Number(ocrItem.precio_unitario) || 0
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

    async function enviarDifCC(row: VerRow) {
        if (!orden) return
        const diff = row.cant_total_facturada - row.cant_recibida
        const monto = diff * row.precio_oc
        await supabase.from("cuenta_corriente_proveedores").insert({
            proveedor_id: orden.proveedor_id,
            tipo_movimiento: "ajuste_precio",
            monto, descripcion: `Ajuste ${row.sku} — OC ${orden.numero_orden}`,
            referencia_id: ordenId, referencia_tipo: "orden_compra",
            fecha: new Date().toISOString(),
        })
        alert(`Ajuste de ${formatCurrency(monto)} enviado a CC`)
    }

    async function finalizarOC() {
        if (!confirm("¿Finalizar esta OC?")) return
        await supabase.from("ordenes_compra").update({ estado: "finalizada" }).eq("id", ordenId)
        router.push("/ordenes-compra")
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
                {allOK && (
                    <Button onClick={finalizarOC} className="gap-2 bg-green-600 hover:bg-green-700">
                        <CheckCircle2 className="h-4 w-4" /> Finalizar OC
                    </Button>
                )}
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
                                    {Object.keys(c.items).length > 0 && <span className="ml-1 text-green-600">✓ OCR</span>}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

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
                                            {hasDiff && (
                                                <Button variant="outline" size="sm" className="text-xs h-7 text-orange-600"
                                                    onClick={() => enviarDifCC(row)}>
                                                    Dif. a CC
                                                </Button>
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
