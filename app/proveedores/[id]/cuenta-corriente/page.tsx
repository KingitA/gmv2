"use client"

// Cuenta corriente del proveedor (E-68, 17/11/2026).
// Una sola fuente de saldo: los movimientos de la cuenta corriente (E-56).
//   · "Qué le debemos": comprobantes con saldo, para tildar y pagar; créditos disponibles.
//   · "Extracto": cronológico con saldo corrido; cada orden de pago en UNA fila, con sus
//     medios y la retención, y enlaces al PDF de la orden y al certificado.
//   · Notas de crédito que el proveedor todavía nos debe mandar, a la vista.
//   · Exportar a Excel y PDF lo mismo que se ve.

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, DollarSign, ExternalLink, FileSpreadsheet, FileText, Receipt } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { toast } from "sonner"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { InputMonto } from "@/components/ui/input-monto"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { fecha, fechaISO } from "@/lib/formato"
import { useMisRoles } from "@/lib/hooks/useMisRoles"
import { etiquetaComprobante, type FilaExtracto } from "@/lib/proveedores/extracto-cc"
import type { DatosResumen } from "@/lib/cuenta-corriente/exportar-resumen"

// Movimientos que no son un comprobante para pagar: los pagos van agrupados en el extracto y
// las provisiones de órdenes de compra (mercadería pedida, sin facturar) NO son deuda: se
// muestran aparte, fuera del saldo y fuera de lo que se puede pagar.
const NO_ES_COMPROBANTE = ["PAGO", "RETENCION", "ANULACION", "ORDEN COMPRA"]

export default function CuentaCorrienteProveedorPage() {
    const params = useParams()
    const router = useRouter()
    const id = params?.id as string
    const { esAdmin } = useMisRoles()

    const [movimientos, setMovimientos] = useState<any[]>([])
    const [saldo, setSaldo] = useState(0)
    const [extracto, setExtracto] = useState<{ filas: FilaExtracto[]; saldo_anterior: number; saldo_final: number }>({ filas: [], saldo_anterior: 0, saldo_final: 0 })
    const [ncEsperadas, setNcEsperadas] = useState<any[]>([])
    const [comprometido, setComprometido] = useState<FilaExtracto[]>([])
    const [proveedor, setProveedor] = useState<{ nombre: string; sigla?: string | null; cuit?: string | null } | null>(null)
    const [loading, setLoading] = useState(true)
    const [desde, setDesde] = useState("")
    const [hasta, setHasta] = useState("")
    const [selectedMovs, setSelectedMovs] = useState<Set<string>>(new Set())
    const [exportando, setExportando] = useState(false)

    const [ncOpen, setNcOpen] = useState(false)
    const [nc, setNc] = useState<{ tipo: string; numero: string; fecha: string; total: number | null; total_neto: number | null }>({ tipo: "NC", numero: "", fecha: "", total: null, total_neto: null })
    const [ncSaving, setNcSaving] = useState(false)

    // Nombre completo del proveedor (la sigla sola no dice quién es); la sigla va al lado
    const provNombre = proveedor?.nombre || proveedor?.sigla || ""

    async function cargar() {
        setLoading(true)
        try {
            const q = new URLSearchParams()
            if (desde) q.set("desde", desde)
            if (hasta) q.set("hasta", hasta)
            const res = await fetch(`/api/proveedores/${id}/cuenta-corriente${q.toString() ? `?${q}` : ""}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || "No se pudo cargar la cuenta corriente")
            setMovimientos(data.comprobantes || [])
            setSaldo(Number(data.totales?.saldo ?? 0))
            setExtracto(data.extracto || { filas: [], saldo_anterior: 0, saldo_final: 0 })
            setNcEsperadas(data.nc_esperadas || [])
            setComprometido(data.comprometido_oc || [])
            if (data.proveedor) setProveedor(data.proveedor)
        } catch (e: any) {
            toast.error(e?.message || "No se pudo cargar la cuenta corriente")
        } finally { setLoading(false) }
    }

    useEffect(() => { if (id) cargar() }, [id, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

    async function guardarNC() {
        const total = nc.total
        if (total === null || total <= 0) { toast.warning("Total inválido"); return }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nc.fecha)) { toast.warning("Fecha inválida (dd/mm/aaaa)"); return }
        setNcSaving(true)
        try {
            const res = await fetch(`/api/proveedores/${id}/nc`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tipo: nc.tipo, numero: nc.numero || null, fecha: nc.fecha, total, total_neto: nc.total_neto ? nc.total_neto : null }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error)
            toast.success(`${nc.tipo} registrada: ya figura como crédito y se puede descontar en la próxima orden de pago`)
            setNcOpen(false)
            setNc({ tipo: "NC", numero: "", fecha: "", total: null, total_neto: null })
            cargar()
        } catch (e: any) {
            toast.error(e.message || "No se pudo registrar la nota de crédito")
        } finally { setNcSaving(false) }
    }

    // ── Qué le debemos: comprobantes con saldo (deuda) y créditos disponibles ──
    const documentos = useMemo(() => movimientos.filter((m: any) => !NO_ES_COMPROBANTE.includes(m.tipo)), [movimientos])
    const deudas = documentos.filter((m: any) => m.estado === "pendiente" && Number(m.saldo_pendiente) > 0)
        .sort((a: any, b: any) => String(a.vencimiento || a.fecha).localeCompare(String(b.vencimiento || b.fecha)))
    const creditos = documentos.filter((m: any) => m.estado === "pendiente" && Number(m.saldo_pendiente) < 0)
    const totalDeudas = deudas.reduce((s: number, m: any) => s + Number(m.saldo_pendiente), 0)
    const totalCreditos = creditos.reduce((s: number, m: any) => s + Math.abs(Number(m.saldo_pendiente)), 0)
    // Lo pagado que no está aplicado a ningún comprobante (pagos a cuenta) = lo que explica la diferencia con el saldo
    const aCuenta = Math.round((totalDeudas - totalCreditos - saldo) * 100) / 100

    const toggle = (movId: string) => {
        const ns = new Set(selectedMovs)
        if (ns.has(movId)) ns.delete(movId); else ns.add(movId)
        setSelectedMovs(ns)
    }
    const seleccion = deudas.filter((m: any) => selectedMovs.has(m.id))
    const totalSeleccion = seleccion.reduce((s: number, m: any) => s + Number(m.saldo_pendiente), 0)

    function pagarSeleccion() {
        const ids = seleccion.map((m: any) => m.id).join(",")
        const montos = seleccion.map((m: any) => m.saldo_pendiente).join(",")
        const descs = seleccion.map((m: any) => encodeURIComponent(m.numero || m.tipo)).join(",")
        router.push(`/ordenes-pago/nueva?proveedor_id=${id}&mov_cc_ids=${ids}&mov_montos=${montos}&mov_desc=${descs}&monto=${totalSeleccion}`)
    }

    // ── Exportar (lo mismo que se ve) ──
    async function exportar(formato: "excel" | "pdf") {
        setExportando(true)
        try {
            const { exportarResumenExcel, exportarResumenPdf } = await import("@/lib/cuenta-corriente/exportar-resumen")
            const d: DatosResumen = {
                cliente: { nombre: proveedor?.nombre || provNombre || "proveedor", cuit: proveedor?.cuit ?? null },
                vista: "detallada",
                extracto: extracto.filas.map(f => ({
                    fecha: fechaISO(f.fecha), movimiento: f.movimiento, detalle: f.detalle,
                    debe: f.debe, haber: f.haber, saldo_acumulado: f.saldo,
                })),
                saldos: [...deudas, ...creditos].map((m: any) => ({
                    tipo: m.tipo_comprobante || m.tipo, numero: m.numero || "", fecha: fechaISO(m.fecha),
                    pedido: m.vencimiento ? `vence ${fecha(m.vencimiento)}` : "-",
                    total: Math.abs(Number(m.total)), saldo: Math.abs(Number(m.saldo_pendiente)),
                    estado: Math.abs(Number(m.saldo_pendiente)) < Math.abs(Number(m.total)) - 0.01 ? "parcial" : "pendiente",
                    es_credito: Number(m.saldo_pendiente) < 0,
                })),
                saldoFinal: desde || hasta ? extracto.saldo_final : saldo,
                rango: { desde: desde || undefined, hasta: hasta || undefined },
                etiquetas: {
                    tituloExtracto: "Extracto (del más viejo al más nuevo)", positivo: "(le debemos)", negativo: "(a nuestro favor)",
                    columnaPedido: "Vencimiento", archivo: "cuenta-proveedor",
                },
            }
            if (formato === "excel") exportarResumenExcel(d); else await exportarResumenPdf(d)
        } catch (e: any) {
            toast.error(e?.message || "No se pudo exportar")
        } finally { setExportando(false) }
    }

    const claseFila: Record<string, string> = { pago: "bg-green-50/50", anulacion: "bg-red-50/50", provision: "text-muted-foreground" }

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="mb-6 flex flex-wrap items-center gap-4">
                <Link href="/proveedores">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Cuenta corriente{provNombre && ` — ${provNombre}`}</h1>
                    <p className="text-muted-foreground">Comprobantes, pagos y retenciones, con el saldo al día</p>
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" disabled={exportando || loading} onClick={() => exportar("excel")}>
                        <FileSpreadsheet className="h-4 w-4" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" disabled={exportando || loading} onClick={() => exportar("pdf")}>
                        <FileText className="h-4 w-4" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setNcOpen(true)}>+ Nota de crédito</Button>
                </div>
            </div>

            {/* Saldo y cómo se compone */}
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                <Card className={`border-l-4 ${saldo > 0.005 ? "border-l-red-500" : "border-l-green-500"}`}>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{saldo > 0.005 ? "Le debemos" : saldo < -0.005 ? "Saldo a nuestro favor" : "Saldo"}</CardTitle></CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold tabular-nums ${saldo > 0.005 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(Math.abs(saldo))}</div>
                        <p className="mt-1 text-xs text-muted-foreground">Comprobantes, pagos y retenciones. No incluye la mercadería pedida sin facturar.</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Comprobantes sin pagar</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold tabular-nums">{formatCurrency(totalDeudas)}</div><p className="mt-1 text-xs text-muted-foreground">{deudas.length} comprobante{deudas.length === 1 ? "" : "s"}</p></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Créditos sin usar</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold tabular-nums text-emerald-700">{formatCurrency(totalCreditos)}</div><p className="mt-1 text-xs text-muted-foreground">Notas de crédito y reversas para descontar</p></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pagado a cuenta</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold tabular-nums">{formatCurrency(Math.max(0, aCuenta))}</div><p className="mt-1 text-xs text-muted-foreground">Pagos y retenciones sin aplicar a un comprobante</p></CardContent>
                </Card>
            </div>

            {/* Mercadería pedida y todavía sin factura: no es deuda, no se paga */}
            {comprometido.length > 0 && (
                <Card className="mb-6 border-dashed">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Comprometido por órdenes de compra · {formatCurrency(comprometido.reduce((s, c) => s + c.debe, 0))}</CardTitle>
                        <p className="text-xs text-muted-foreground">Mercadería pedida que todavía no tiene factura. NO es deuda: no suma al saldo ni se puede pagar. Pasa a deuda cuando se valida la factura.</p>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                        {comprometido.map((c) => (
                            <div key={c.clave} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                                <span className="w-24">{fecha(c.fecha)}</span>
                                <span className="flex-1 truncate">{c.detalle}</span>
                                <span className="font-mono">{formatCurrency(c.debe)}</span>
                                {c.orden_compra_id && (
                                    <Link href={`/ordenes-compra/${c.orden_compra_id}/verificacion`} className="inline-flex items-center gap-1 text-xs text-blue-700 underline">
                                        <ExternalLink className="h-3 w-3" /> ver la orden
                                    </Link>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* NC que el proveedor nos debe mandar */}
            {ncEsperadas.length > 0 && (
                <Card className="mb-6 border-amber-300 bg-amber-50/40">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Notas de crédito que nos tiene que mandar ({ncEsperadas.length}) · {formatCurrency(ncEsperadas.reduce((s, n) => s + Number(n.total || 0), 0))}</CardTitle>
                        <p className="text-xs text-muted-foreground">Todavía NO bajan la deuda: cuentan recién cuando llega el documento y se registra.</p>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                        {ncEsperadas.map((n: any) => (
                            <div key={n.id} className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{formatCurrency(Number(n.total || 0))}</span>
                                <span className="text-muted-foreground">{n.origen_nc ? String(n.origen_nc).replace(/_/g, " ") : "nota de crédito esperada"}</span>
                                {n.fecha_comprobante && <span className="text-xs text-muted-foreground">desde el {fecha(n.fecha_comprobante)}</span>}
                                {n.orden_compra_id && (
                                    <Link href={`/ordenes-compra/${n.orden_compra_id}/verificacion`} className="inline-flex items-center gap-1 text-xs text-blue-700 underline">
                                        <ExternalLink className="h-3 w-3" /> ver la orden de compra
                                    </Link>
                                )}
                            </div>
                        ))}
                        <Link href="/ordenes-compra/nc-pendientes" className="inline-block pt-1 text-xs text-blue-700 underline">Ir a NC esperadas</Link>
                    </CardContent>
                </Card>
            )}

            <Tabs defaultValue="pendientes">
                <TabsList>
                    <TabsTrigger value="pendientes">Qué le debemos</TabsTrigger>
                    <TabsTrigger value="extracto">Extracto</TabsTrigger>
                </TabsList>

                <TabsContent value="pendientes">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <CardTitle className="text-lg">Comprobantes sin pagar</CardTitle>
                                {esAdmin && (
                                    <div className="flex items-center gap-3">
                                        {selectedMovs.size > 0 && <span className="text-sm text-muted-foreground">Elegido: <b className="text-foreground">{formatCurrency(totalSeleccion)}</b></span>}
                                        <Button onClick={pagarSeleccion} disabled={seleccion.length === 0} className="gap-2">
                                            <DollarSign className="h-4 w-4" /> Pagar lo elegido ({seleccion.length})
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/30">
                                        {esAdmin && <TableHead className="w-[40px]"></TableHead>}
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Comprobante</TableHead>
                                        <TableHead>Vence</TableHead>
                                        <TableHead className="text-right">Importe</TableHead>
                                        <TableHead className="text-right">Falta pagar</TableHead>
                                        <TableHead className="w-[60px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={7} className="h-20 text-center"><CargaProgreso compacto mensajes={MENSAJES.cuentaCorriente} className="mx-auto max-w-sm" /></TableCell></TableRow>
                                    ) : deudas.length === 0 ? (
                                        <TableRow><TableCell colSpan={7} className="h-16 text-center text-muted-foreground">No hay comprobantes sin pagar</TableCell></TableRow>
                                    ) : deudas.map((m: any) => {
                                        const parcial = Number(m.saldo_pendiente) < Number(m.total) - 0.01
                                        return (
                                            <TableRow key={m.id} className={selectedMovs.has(m.id) ? "bg-accent/40" : ""}>
                                                {esAdmin && <TableCell><Checkbox checked={selectedMovs.has(m.id)} onCheckedChange={() => toggle(m.id)} /></TableCell>}
                                                <TableCell className="text-sm">{fecha(m.fecha)}</TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary" className="mr-2">{etiquetaComprobante(m.tipo_comprobante)}</Badge>
                                                    <span className="text-sm">{m.numero}</span>
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">{m.vencimiento ? fecha(m.vencimiento) : ""}</TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(m.total)}</TableCell>
                                                <TableCell className="text-right font-mono font-bold">
                                                    {formatCurrency(m.saldo_pendiente)}
                                                    {parcial && <div className="text-[11px] font-normal text-amber-700">pago parcial</div>}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {m.referencia_tipo === "orden_compra" && m.referencia_id && (
                                                        <Link href={`/ordenes-compra/${m.referencia_id}/verificacion`}>
                                                            <Button variant="ghost" size="sm" className="gap-1 text-xs text-blue-600 hover:bg-blue-50"><ExternalLink className="h-3 w-3" /> OC</Button>
                                                        </Link>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                            {creditos.length > 0 && (
                                <div className="border-t p-4">
                                    <h4 className="mb-2 text-sm font-semibold text-emerald-700">Créditos sin usar (se descuentan al armar la orden de pago)</h4>
                                    <div className="space-y-1 text-sm">
                                        {creditos.map((m: any) => (
                                            <div key={m.id} className="flex items-center gap-3">
                                                <span className="w-24 text-muted-foreground">{fecha(m.fecha)}</span>
                                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{etiquetaComprobante(m.tipo_comprobante)}</Badge>
                                                <span className="flex-1 truncate">{m.numero}</span>
                                                <span className="font-mono font-semibold text-emerald-700">− {formatCurrency(Math.abs(Number(m.saldo_pendiente)))}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="extracto">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <CardTitle className="text-lg">Extracto</CardTitle>
                                    <p className="text-xs text-muted-foreground">Del más viejo al más nuevo. Cada pago figura una sola vez, con sus medios y la retención.</p>
                                </div>
                                <div className="flex flex-wrap items-end gap-2">
                                    <div><label className="text-xs font-medium">Desde</label><DateInputAR className="h-8 w-36" value={desde} onChange={setDesde} /></div>
                                    <div><label className="text-xs font-medium">Hasta</label><DateInputAR className="h-8 w-36" value={hasta} onChange={setHasta} /></div>
                                    {(desde || hasta) && <Button variant="ghost" size="sm" onClick={() => { setDesde(""); setHasta("") }}>Ver todo</Button>}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/30">
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Movimiento</TableHead>
                                        <TableHead>Detalle</TableHead>
                                        <TableHead className="text-right">Suma deuda</TableHead>
                                        <TableHead className="text-right">Baja deuda</TableHead>
                                        <TableHead className="text-right">Saldo</TableHead>
                                        <TableHead className="w-[90px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={7} className="h-20 text-center"><CargaProgreso compacto mensajes={MENSAJES.cuentaCorriente} className="mx-auto max-w-sm" /></TableCell></TableRow>
                                    ) : (
                                        <>
                                            {(desde || Math.abs(extracto.saldo_anterior) > 0.005) && (
                                                <TableRow className="bg-muted/20 font-medium">
                                                    <TableCell colSpan={5}>Saldo anterior{desde ? ` al ${fecha(desde)}` : ""}</TableCell>
                                                    <TableCell className="text-right font-mono">{formatCurrency(extracto.saldo_anterior)}</TableCell>
                                                    <TableCell />
                                                </TableRow>
                                            )}
                                            {extracto.filas.length === 0 && (
                                                <TableRow><TableCell colSpan={7} className="h-16 text-center text-muted-foreground">Sin movimientos{desde || hasta ? " en ese período" : ""}</TableCell></TableRow>
                                            )}
                                            {extracto.filas.map((f) => (
                                                <TableRow key={f.clave} className={claseFila[f.clase] ?? ""}>
                                                    <TableCell className="whitespace-nowrap text-sm">{fecha(f.fecha)}</TableCell>
                                                    <TableCell className="text-sm font-medium">{f.movimiento}</TableCell>
                                                    <TableCell className="max-w-[420px] text-sm text-muted-foreground">
                                                        {f.clase === "pago" ? (
                                                            <div className="space-y-0.5">
                                                                {(f.medios ?? []).map((m, i) => (
                                                                    <div key={i}>{m.medio}{m.detalle ? ` ${m.detalle}` : ""}: <span className="font-mono text-foreground">{formatCurrency(m.monto)}</span></div>
                                                                ))}
                                                                {(f.retencion ?? 0) > 0 && <div className="text-orange-700">Retención de Ganancias: <span className="font-mono">{formatCurrency(f.retencion ?? 0)}</span></div>}
                                                                {f.orden_pago_estado === "anulada" && <div className="font-semibold text-red-700">Orden anulada (ver la anulación más abajo)</div>}
                                                            </div>
                                                        ) : f.detalle}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">{f.debe > 0 ? formatCurrency(f.debe) : ""}</TableCell>
                                                    <TableCell className="text-right font-mono text-green-700">{f.haber > 0 ? `− ${formatCurrency(f.haber)}` : ""}</TableCell>
                                                    <TableCell className="text-right font-mono font-bold">{formatCurrency(f.saldo)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-1">
                                                            {f.orden_pago_id && f.clase === "pago" && esAdmin && (
                                                                <a href={`/api/ordenes-pago/${f.orden_pago_id}/pdf`} target="_blank" rel="noreferrer" title="PDF de la orden de pago">
                                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><FileText className="h-4 w-4" /></Button>
                                                                </a>
                                                            )}
                                                            {f.orden_pago_id && f.tiene_certificado && f.orden_pago_estado === "pagada" && esAdmin && (
                                                                <a href={`/api/ordenes-pago/${f.orden_pago_id}/certificado`} target="_blank" rel="noreferrer" title="Certificado de retención">
                                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-orange-600"><Receipt className="h-4 w-4" /></Button>
                                                                </a>
                                                            )}
                                                            {f.orden_compra_id && (
                                                                <Link href={`/ordenes-compra/${f.orden_compra_id}/verificacion`} title="Orden de compra">
                                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600"><ExternalLink className="h-4 w-4" /></Button>
                                                                </Link>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow className="bg-muted/30 font-bold">
                                                <TableCell colSpan={5}>{desde || hasta ? "Saldo al final del período" : "Saldo actual"}</TableCell>
                                                <TableCell className="text-right font-mono">{formatCurrency(extracto.saldo_final)}</TableCell>
                                                <TableCell />
                                            </TableRow>
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {ncOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setNcOpen(false)}>
                    <div className="w-[420px] space-y-3 rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold">Nueva nota de crédito — {provNombre}</h3>
                        <p className="text-xs text-muted-foreground">
                            Para NC comerciales sin OC (ej. 3% del trimestre). NC/NCA/NCB = fiscal (resta base de retención) · Reversa = canal negro (no afecta retención).
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs font-medium">Tipo</label>
                                <select className="w-full rounded-md border px-2 py-1.5 text-sm" value={nc.tipo} onChange={e => setNc(p => ({ ...p, tipo: e.target.value }))}>
                                    <option value="NC">NC</option>
                                    <option value="NCA">NCA</option>
                                    <option value="NCB">NCB</option>
                                    <option value="Reversa">Reversa (negro)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium">N° comprobante</label>
                                <input className="w-full rounded-md border px-2 py-1.5 text-sm" value={nc.numero} onChange={e => setNc(p => ({ ...p, numero: e.target.value }))} placeholder="0001-00001234" />
                            </div>
                            <div>
                                <label className="text-xs font-medium">Fecha</label>
                                <DateInputAR className="h-auto w-full rounded-md border px-2 py-1.5 text-sm" value={nc.fecha} onChange={v => setNc(p => ({ ...p, fecha: v }))} />
                            </div>
                            <div>
                                <label className="text-xs font-medium">Total</label>
                                <InputMonto pesos soloPositivos className="h-auto w-full rounded-md border py-1.5 pr-2 text-sm tabular-nums" value={nc.total} onChange={n => setNc(p => ({ ...p, total: n }))} />
                            </div>
                            {nc.tipo !== "Reversa" && (
                                <div className="col-span-2">
                                    <label className="text-xs font-medium">Neto gravado (opcional — si no, total ÷ 1,21)</label>
                                    <InputMonto pesos soloPositivos className="h-auto w-full rounded-md border py-1.5 pr-2 text-sm tabular-nums" value={nc.total_neto} onChange={n => setNc(p => ({ ...p, total_neto: n }))} />
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="outline" size="sm" onClick={() => setNcOpen(false)}>Cancelar</Button>
                            <Button size="sm" disabled={ncSaving} onClick={guardarNC}>{ncSaving ? "Guardando…" : "Registrar NC"}</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
