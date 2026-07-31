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
import { ComprobantesSection } from "./comprobantes-section"

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
    cant_oc: number              // en la unidad pedida (bultos si tipo bulto)
    unidades_por_bulto: number
    es_bulto: boolean
    precio_oc: number            // NETO por unidad pedida (lista − D1..D4, × unid/bulto si bulto)
    cant_recibida: number        // suma de todas las tandas (bultos)
    // Per-comprobante data filled dynamically
    comp_data: Record<string, { cantidad: number; precio: number }> // keyed by comprobante id; precio NETO por línea
    cant_total_facturada: number
    pendiente_oc: number         // lo que el proveedor no envió vs OC (ni recibido ni facturado)
    no_pedido: boolean           // recibido/facturado sin estar en la OC
    status: "ok" | "diferencia_cantidad" | "diferencia_precio" | "faltante" | "ambas" | "no_pedido"
}

export default function VerificacionOCPage() {
    const supabase = createClient()
    const params = useParams()
    const router = useRouter()
    const ordenId = params.id as string

    const [orden, setOrden] = useState<any>(null)
    const [rows, setRows] = useState<VerRow[]>([])
    const [comprobantes, setComprobantes] = useState<CompData[]>([])
    const [sinMatch, setSinMatch] = useState(0)
    const [loading, setLoading] = useState(true)
    const [recepcionId, setRecepcionId] = useState<string | null>(null)
    const [recepcionIds, setRecepcionIds] = useState<string[]>([])
    const [transportes, setTransportes] = useState<any[]>([])

    // Resolution dialog state
    const [resolviendoRow, setResolviendoRow] = useState<VerRow | null>(null)
    const [resolucionTipo, setResolucionTipo] = useState<'mercaderia' | 'precio'>('mercaderia')
    const [resolucionAccion, setResolucionAccion] = useState<'A' | 'B' | 'C' | 'D'>('A')
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
                .select("comprobante_id, articulo_id, cantidad_facturada, precio_unitario, descuento1, tipo_cantidad, match_estado")
                .in("comprobante_id", compIds)
            compDetalle = det || []
            setSinMatch(compDetalle.filter((d: any) => d.match_estado === "sugerido" || d.match_estado === "sin_match").length)
        }

        const { data: recepciones } = await supabase
            .from("recepciones").select("id").eq("orden_compra_id", ordenId)
            .order("created_at", { ascending: false })

        let recItems: any[] = []
        if (recepciones && recepciones.length > 0) {
            setRecepcionId(recepciones[0].id)
            setRecepcionIds(recepciones.map(r => r.id))
            const { data } = await supabase
                .from("recepciones_items").select("*, cantidad_diferencia_destino")
                .in("recepcion_id", recepciones.map(r => r.id))
            recItems = data || []
        }

        // Build comprobantes data with article-level info from detalle table.
        // El precio se guarda NETO (precio − descuento de línea) para poder
        // compararlo contra el precio neto de la OC.
        const compDataList: CompData[] = (comps || []).map((c: any) => {
            const items: Record<string, { cantidad: number; precio: number }> = {}
            const detalleRows = compDetalle.filter((d: any) => d.comprobante_id === c.id)

            for (const det of detalleRows) {
                if (det.articulo_id) {
                    const precioNeto = (Number(det.precio_unitario) || 0) * (1 - (Number(det.descuento1) || 0) / 100)
                    if (items[det.articulo_id]) {
                        items[det.articulo_id].cantidad += Number(det.cantidad_facturada) || 0
                    } else {
                        items[det.articulo_id] = {
                            cantidad: Number(det.cantidad_facturada) || 0,
                            precio: Math.round(precioNeto * 100) / 100,
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

        // Recibido por artículo: SUMA de todas las tandas. Las filas fuera_de_oc
        // de artículos que SÍ están en la OC son duplicados de documentación
        // vieja — no suman recibido.
        const ocArtIds = new Set((ocItems || []).map((i: any) => i.articulo_id))
        const recibidoPorArt: Record<string, number> = {}
        const faltanteMarcado: Record<string, boolean> = {}
        for (const ri of recItems) {
            if (ri.fuera_de_oc && ocArtIds.has(ri.articulo_id)) continue
            recibidoPorArt[ri.articulo_id] = (recibidoPorArt[ri.articulo_id] || 0) + Number(ri.cantidad_fisica || 0)
            if (ri.estado_linea === "faltante") faltanteMarcado[ri.articulo_id] = true
        }

        const TOLERANCIA_PRECIO = 0.005 // 0.5%: cubre redondeos de OCR/conversión de descuentos

        const buildRow = (params: {
            artId: string, sku: string, descripcion: string, upb: number, esBulto: boolean,
            cantOC: number, precioOCNeto: number, noPedido: boolean,
        }): VerRow => {
            const { artId, sku, descripcion, upb, esBulto, cantOC, precioOCNeto, noPedido } = params
            const cantRecibida = recibidoPorArt[artId] || 0

            const compDataForArt: Record<string, { cantidad: number; precio: number }> = {}
            let cantTotalFacturada = 0
            let precioFANeto: number | null = null
            for (const cd of compDataList) {
                const artData = cd.items[artId]
                if (artData) {
                    compDataForArt[cd.id] = artData
                    if (cd.tipo.startsWith("NC") || cd.tipo.startsWith("ND")) {
                        cantTotalFacturada -= artData.cantidad
                    } else {
                        cantTotalFacturada += artData.cantidad
                        if (precioFANeto === null && artData.precio > 0) precioFANeto = artData.precio
                    }
                }
            }

            const hasOCRData = Object.keys(compDataForArt).length > 0

            // Diferencia de cantidad: lo FACTURADO vs lo RECIBIDO (misma unidad: bultos)
            const diffCant = hasOCRData ? cantTotalFacturada - cantRecibida : 0
            // Diferencia de precio: neto factura vs neto OC (ambos por bulto/unidad de pedido)
            const difPrecio = precioFANeto !== null && precioOCNeto > 0
                ? Math.abs(precioFANeto - precioOCNeto) / precioOCNeto > TOLERANCIA_PRECIO
                : false
            // Lo que el proveedor no envió vs la OC (ni recibido ni facturado): faltante de fábrica
            const pendienteOC = Math.max(0, cantOC - Math.max(cantRecibida, cantTotalFacturada))

            let status: VerRow["status"] = "ok"
            if (noPedido) status = "no_pedido"
            else if (cantRecibida === 0 && cantOC > 0) status = "faltante"
            else if (Math.abs(diffCant) > 0.01 && difPrecio) status = "ambas"
            else if (Math.abs(diffCant) > 0.01) status = "diferencia_cantidad"
            else if (difPrecio) status = "diferencia_precio"

            return {
                articulo_id: artId, sku, descripcion,
                cant_oc: cantOC, unidades_por_bulto: upb, es_bulto: esBulto,
                precio_oc: precioOCNeto,
                cant_recibida: cantRecibida,
                comp_data: compDataForArt,
                cant_total_facturada: cantTotalFacturada,
                pendiente_oc: pendienteOC,
                no_pedido: noPedido,
                status,
            }
        }

        // Filas de la OC (cantidades y precios en la unidad pedida: bultos)
        const verRows: VerRow[] = (ocItems || []).map((item: any) => {
            const upb = item.articulo?.unidades_por_bulto || 1
            const esBulto = item.tipo_cantidad === "bulto"
            const descuentos = [item.descuento1, item.descuento2, item.descuento3, item.descuento4]
                .map((d: any) => Number(d) || 0)
            const precioNetoUnit = descuentos.reduce((p, d) => p * (1 - d / 100), Number(item.precio_unitario) || 0)
            return buildRow({
                artId: item.articulo_id,
                sku: item.articulo?.sku || "",
                descripcion: item.articulo?.descripcion || "",
                upb, esBulto,
                cantOC: Number(item.cantidad_pedida) || 0,
                precioOCNeto: Math.round(precioNetoUnit * (esBulto ? upb : 1) * 100) / 100,
                noPedido: false,
            })
        })

        // Artículos NO pedidos: recibidos (fuera_de_oc) o facturados sin estar en la OC
        const extraIds = new Set<string>()
        for (const ri of recItems) {
            if (ri.fuera_de_oc && !ocArtIds.has(ri.articulo_id)) extraIds.add(ri.articulo_id)
        }
        for (const cd of compDataList) {
            for (const artId of Object.keys(cd.items)) {
                if (!ocArtIds.has(artId)) extraIds.add(artId)
            }
        }
        if (extraIds.size > 0) {
            const { data: extraArts } = await supabase
                .from("articulos")
                .select("id, sku, descripcion, unidades_por_bulto")
                .in("id", [...extraIds])
            for (const art of extraArts || []) {
                // Lo recibido fuera de OC sí cuenta como recibido acá
                recibidoPorArt[art.id] = recItems
                    .filter(ri => ri.articulo_id === art.id)
                    .reduce((s, ri) => s + Number(ri.cantidad_fisica || 0), 0)
                verRows.push(buildRow({
                    artId: art.id,
                    sku: art.sku || "",
                    descripcion: art.descripcion || "",
                    upb: art.unidades_por_bulto || 1,
                    esBulto: true,
                    cantOC: 0,
                    precioOCNeto: 0,
                    noPedido: true,
                }))
            }
        }

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
        if (!resolviendoRow || recepcionIds.length === 0) return

        // Buscar el ítem en TODAS las tandas (preferir la fila real de la OC)
        const { data: candidatos } = await supabase
            .from('recepciones_items')
            .select('id, recepcion_id, cantidad_oc, cantidad_fisica, fuera_de_oc')
            .in('recepcion_id', recepcionIds)
            .eq('articulo_id', resolviendoRow.articulo_id)

        const recItem = (candidatos || []).find(c => !c.fuera_de_oc && Number(c.cantidad_fisica || 0) > 0)
            || (candidatos || []).find(c => !c.fuera_de_oc)
            || (candidatos || [])[0]

        if (!recItem) {
            alert('No se encontró el ítem en la recepción')
            setResolviendoRow(null)
            return
        }

        const cantFaltante = resolviendoRow.cant_oc - resolviendoRow.cant_recibida

        const decision = {
            item_id: recItem.id,
            tipo: resolucionTipo,
            accion: resolucionAccion,
            transporte_id: resolucionAccion === 'B' ? resolucionTransporte : undefined,
            valor_real: cantFaltante,
            descripcion: resolucionDesc || undefined,
        }

        const res = await fetch(`/api/recepciones/${recItem.recepcion_id}/cerrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decisions: [decision] }),
        })

        const data = await res.json()
        if (!res.ok) {
            alert(data.error || 'Error al resolver')
            return
        }

        const destino = resolucionAccion === 'A' ? 'empresa' : resolucionAccion === 'B' ? 'transporte' : resolucionAccion === 'D' ? 'nc-esperada' : 'proveedor'
        setResoluciones(prev => ({ ...prev, [resolviendoRow.articulo_id]: destino }))
        setResolviendoRow(null)
    }

    async function finalizarOC() {
        if (!confirm("¿Finalizar esta OC?")) return
        await supabase.from("ordenes_compra").update({ estado: "finalizada" }).eq("id", ordenId)
        router.push("/ordenes-compra")
    }

    // Los faltantes de fábrica no se reciben después: se repiden.
    // Crea una OC nueva con lo que el proveedor no envió, a los precios
    // y descuentos de la OC original.
    async function generarOCFaltantes() {
        const faltantes = rows.filter(r => r.pendiente_oc > 0)
        if (faltantes.length === 0) return

        const resumen = faltantes.map(r => `· ${r.sku} — ${r.pendiente_oc}${r.es_bulto ? " BUL" : " u"} — ${r.descripcion}`).join("\n")
        if (!confirm(`¿Generar una nueva OC con estos faltantes?\n\n${resumen}`)) return

        const { data: ocDetalle } = await supabase
            .from("ordenes_compra_detalle")
            .select("articulo_id, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4")
            .eq("orden_compra_id", ordenId)

        const items = faltantes.map(r => {
            const det = (ocDetalle || []).find((d: any) => d.articulo_id === r.articulo_id)
            return {
                articulo_id: r.articulo_id,
                cantidad_pedida: r.pendiente_oc,
                tipo_cantidad: det?.tipo_cantidad || "bulto",
                precio_unitario: det?.precio_unitario || 0,
                descuento1: det?.descuento1 || 0,
                descuento2: det?.descuento2 || 0,
                descuento3: det?.descuento3 || 0,
                descuento4: det?.descuento4 || 0,
            }
        })

        const res = await fetch("/api/ordenes-compra/crear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                proveedor_id: orden?.proveedor_id,
                observaciones: `Reposición de faltantes de ${orden?.numero_orden}`,
                items,
            }),
        })
        const data = await res.json()
        if (!res.ok) {
            alert(data.error || "Error al generar la OC")
            return
        }
        alert(`OC de reposición creada: ${data.orden?.numero_orden || "OK"}`)
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
                    {rows.some(r => r.pendiente_oc > 0) && (
                        <Button onClick={generarOCFaltantes} variant="outline" className="gap-2 border-amber-400 text-amber-700 hover:bg-amber-50">
                            <FileText className="h-4 w-4" /> Generar OC con faltantes
                        </Button>
                    )}
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

            {sinMatch > 0 && (
                <div className="mb-4 p-3 border border-amber-300 bg-amber-50 rounded-lg">
                    <p className="text-sm text-amber-800">
                        <strong>{sinMatch} ítem{sinMatch !== 1 ? "s" : ""} de comprobantes sin vincular al catálogo</strong> —
                        confirmalos en "Revisar matches" (más abajo); hasta entonces la verificación no los incluye.
                    </p>
                </div>
            )}

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

            {/* ── COMPROBANTES: subir (múltiple, sin bloquear), editar, validar, eliminar + revisar matches ── */}
            <div className="mb-6">
                <ComprobantesSection ordenId={ordenId} onChanged={loadAll} />
            </div>

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
                                <Select value={resolucionTipo} onValueChange={(v: any) => { setResolucionTipo(v); setResolucionAccion('A') }}>
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
                                    {(resolucionTipo === 'precio' ? [
                                        { value: 'A', label: '↩ Empresa absorbe', desc: 'Se acepta el precio facturado y se actualiza el costo del artículo', color: 'border-gray-300' },
                                        { value: 'C', label: '🏭 Proveedor — reclamar NC', desc: 'Queda una NC esperada por la diferencia de precio para reclamar al proveedor', color: 'border-red-300' },
                                        { value: 'D', label: '📉 Descuento fuera de factura', desc: 'El proveedor factura sin el descuento y manda la NC a fin de mes/trimestre. Queda como NC esperada.', color: 'border-purple-300' },
                                    ] : [
                                        { value: 'A', label: '↩ Empresa absorbe', desc: 'Se desestima la diferencia, sin movimiento en cuentas', color: 'border-gray-300' },
                                        { value: 'B', label: '🚚 Transporte', desc: 'Se registra en la cuenta corriente del transporte', color: 'border-blue-300' },
                                        { value: 'C', label: '🏭 Proveedor', desc: 'Devolución con ajuste de stock + NC esperada para reclamar', color: 'border-red-300' },
                                    ]).map(opt => (
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
                                <TableHead className="text-right">Precio OC<br /><span className="text-[10px] text-muted-foreground font-normal">neto c/desc.</span></TableHead>
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
                                    <TableRow key={row.articulo_id} className={row.no_pedido ? "bg-purple-50/50" : hasDiff ? "bg-orange-50/50" : ""}>
                                        <TableCell>
                                            {row.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                : row.status === "faltante" ? <XCircle className="h-4 w-4 text-red-500" />
                                                    : row.no_pedido ? <AlertTriangle className="h-4 w-4 text-purple-500" />
                                                        : <AlertTriangle className="h-4 w-4 text-orange-500" />}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                                        <TableCell className="text-sm max-w-[180px] truncate">{row.descripcion}</TableCell>
                                        <TableCell className="text-right font-mono">
                                            {row.cant_oc}{row.es_bulto && row.cant_oc > 0 ? <span className="text-[10px] text-muted-foreground"> BUL ({row.cant_oc * row.unidades_por_bulto} u)</span> : null}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono ${hasDiff ? "text-orange-600 font-bold" : ""}`}>
                                            {row.cant_recibida}{row.es_bulto && row.cant_recibida > 0 ? <span className="text-[10px] text-muted-foreground"> BUL</span> : null}
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
                                            <div className="flex flex-col items-center gap-1">
                                                <Badge className={`text-xs ${row.status === "ok" ? "bg-green-500"
                                                    : row.status === "no_pedido" ? "bg-purple-500" : "bg-orange-500"}`}>
                                                    {row.status === "ok" ? "OK"
                                                        : row.status === "faltante" ? "Faltante"
                                                            : row.status === "no_pedido" ? "NO PEDIDO"
                                                                : row.status === "diferencia_precio" ? "Δ Precio"
                                                                    : row.status === "ambas" ? "Δ Cant. + Precio"
                                                                        : "Δ Cant."}
                                                </Badge>
                                                {row.pendiente_oc > 0 && row.status !== "faltante" && (
                                                    <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400"
                                                        title="El proveedor no envió ni facturó esta cantidad de la OC (faltante de fábrica: no se debe, pero quedó sin cubrir)">
                                                        Incompleto: −{row.pendiente_oc}{row.es_bulto ? " BUL" : ""} vs OC
                                                    </Badge>
                                                )}
                                            </div>
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
