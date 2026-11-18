"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FileText, CreditCard, Scale, Lock, Image as ImageIcon, X, Pencil } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { ComprobantesSection } from "./comprobantes-section"
import { ResolverDiferencia } from "./resolver-diferencia"
import { CorregirRecibido } from "./corregir-recibido"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { useConfirmar } from "@/components/ui/confirmar"
import { bultosParaCubrir, cant, desdeUnidadesBase } from "@/lib/deposito/unidades"
import { moneda } from "@/lib/formato"
import type { VerificacionOC, DocumentoRecepcion } from "@/lib/compras/cargar-verificacion"
import type { Bandera, FilaVerificacion } from "@/lib/compras/verificacion"

// Verificación de una orden de compra: pedido / recibido / facturado.
// Los datos y TODAS las cuentas vienen del servidor en una sola llamada
// (GET /api/ordenes-compra/[id]/verificacion → lib/compras/verificacion.ts). Acá no se
// calcula nada: se muestra, y se le pide al servidor que resuelva, valide o finalice.

type Datos = VerificacionOC & { transportes: Array<{ id: string; nombre: string }> }

const ESTADOS_OC: Record<string, string> = {
    pendiente: "Pendiente", enviada: "Enviada", confirmada: "Confirmada", en_camino: "En camino",
    recibida_parcial: "Recibida en parte", recibida_completa: "Recibida", finalizada: "Finalizada", cancelada: "Cancelada",
}

const BANDERA: Record<Bandera, { texto: string; clase: string }> = {
    precio: { texto: "Δ Precio", clase: "bg-orange-500" },
    cantidad: { texto: "Δ Cantidad", clase: "bg-orange-500" },
    pendiente: { texto: "Falta recibir", clase: "bg-amber-500" },
    no_pedido: { texto: "No pedido", clase: "bg-purple-500" },
    sin_documentar: { texto: "Sin documentar", clase: "bg-amber-600" },
}
const DESTINO: Record<string, string> = {
    empresa: "lo asume la empresa", proveedor: "reclamo al proveedor", transporte: "cargo al transporte",
    descuento_fuera_factura: "descuento fuera de factura", resuelto: "resuelto",
    espera_factura: "recibido, se espera la factura", bonificado: "recibido sin cargo (bonificado)",
}

export default function VerificacionOCPage() {
    const supabase = createClient()
    const params = useParams()
    const router = useRouter()
    const ordenId = params.id as string
    const { confirmar, dialogo } = useConfirmar()

    const [datos, setDatos] = useState<Datos | null>(null)
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [resolviendo, setResolviendo] = useState<FilaVerificacion | null>(null)
    const [corrigiendo, setCorrigiendo] = useState<FilaVerificacion | null>(null)
    const [docVisible, setDocVisible] = useState<DocumentoRecepcion | null>(null) // foto / PDF al lado de la tabla
    const [trabajando, setTrabajando] = useState(false)

    const cargar = useCallback(async () => {
        try {
            const res = await fetch(`/api/ordenes-compra/${ordenId}/verificacion`, { cache: "no-store" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { setError(data.error || `No se pudo cargar la verificación (error ${res.status})`); return }
            setError(null)
            setDatos(data)
            // Si la foto que se estaba mirando ya no existe, se cierra el panel
            // (se conserva el MISMO objeto: el enlace firmado cambia en cada carga y, si se reemplazara,
            // la foto o el PDF se volverían a descargar y a dibujar en cada refresco de la pantalla)
            setDocVisible((d) => (d ? ((data.documentos || []).some((x: DocumentoRecepcion) => x.id === d.id) ? d : null) : null))
        } catch {
            setError("No se pudo cargar la verificación: sin conexión con el servidor.")
        } finally {
            setCargando(false)
        }
    }, [ordenId])

    useEffect(() => { if (ordenId) cargar() }, [ordenId, cargar])

    const v = datos?.verificacion
    // La MISMA lista mientras no cambien los datos: si se armara una nueva en cada dibujado, los
    // componentes que dependen de ella (los renglones sin vincular) volverían a pedir todo al servidor
    // cada vez que se abre un cartel o cambia cualquier cosa de la pantalla.
    const comprobantesVisibles = useMemo(() => (datos?.comprobantes || []).filter((c) => c.estado !== "esperada"), [datos])
    const filas = v?.filas || []
    const columnas = v?.columnas || []
    const control = datos?.control
    const soloLectura = !!datos?.solo_lectura
    const pendientes = control?.pendientes || []

    // Finalizar = validar los comprobantes con precios que falten y cerrar la orden. El cierre lo
    // decide el servidor (factura validada que cubra lo recibido; faltantes aceptados expresamente).
    async function finalizarOC() {
        if (!datos || !control) return
        const sinResolver = filas.filter((f) => f.banderas.some((b) => b !== "pendiente")).length
        const porValidar = datos.comprobantes.filter((c) => c.tipo_comprobante !== "Remito" && !["validado", "cerrado", "esperada"].includes(c.estado))
        const lineas: string[] = []
        if (porValidar.length > 0) lineas.push(`Se validan ${porValidar.length} comprobante(s): ${porValidar.map((c) => `${c.tipo_comprobante} ${c.numero_comprobante}`).join(", ")}. Cada uno registra su deuda en la cuenta corriente del proveedor y su vencimiento.`)
        if (sinResolver > 0) lineas.push(`⚠ Hay ${sinResolver} artículo(s) con diferencias de precio o cantidad SIN resolver.`)
        if (pendientes.length > 0) lineas.push(`⚠ Falta recibir mercadería de ${pendientes.length} artículo(s): ${pendientes.slice(0, 6).map((p) => `${p.sku} (${cant(p.unidades)} u)`).join(", ")}${pendientes.length > 6 ? "…" : ""}. Al finalizar, la orden se cierra SIN el resto: el depósito ya no la va a poder recibir.`)
        // Si el comprobante de esa parte está cargado y se valida en este mismo paso, no falta nada
        const sinComprobante = (control.canales_sin_comprobante || []).filter((x) =>
            !porValidar.some((c) => ["FA", "FB", "FC", "Adquisicion", "ADQ"].includes(c.tipo_comprobante) && ["Adquisicion", "ADQ"].includes(c.tipo_comprobante) === (x.canal === "negro")))
        for (const x of sinComprobante) {
            lineas.push(`⚠ La parte ${x.nombre} de la orden (${moneda(x.total_orden)}) no tiene ningún comprobante validado. Si finalizás así, se CANCELAN ${moneda(x.provision)} de deuda provisoria y ${moneda(x.vencimiento_estimado)} de vencimiento estimado: esa plata deja de figurar como deuda. Si el comprobante va a llegar, cargalo y validalo antes de finalizar.`)
        }
        lineas.push("Una orden finalizada queda en solo lectura.")
        const ok = await confirmar({
            titulo: pendientes.length > 0 ? `¿Cerrar ${datos.orden.numero_orden} sin el resto de la mercadería?` : `¿Finalizar ${datos.orden.numero_orden}?`,
            detalle: lineas.join("\n\n"),
            confirmar: pendientes.length > 0 ? "Cerrar sin el resto" : "Finalizar",
            peligro: pendientes.length > 0 || sinResolver > 0 || sinComprobante.length > 0,
        })
        if (!ok) return

        setTrabajando(true)
        try {
            const avisos: string[] = []
            for (const comp of porValidar) {
                const res = await fetch(`/api/comprobantes-compra/${comp.id}/validar`, { method: "POST" })
                const data = await res.json().catch(() => ({}))
                if (res.status === 409 && data.codigo === "vencimiento_a_mano") {
                    // E-102: puede estar anotada a mano en el calendario; eso se decide comprobante por comprobante
                    toast.error(`La orden no se finalizó. ${comp.tipo_comprobante} ${comp.numero_comprobante} puede ser una factura que ya estaba anotada a mano en el calendario: validalo con su botón (✓) para decir si es esa o es otra cosa, y después finalizá la orden.`, { duration: 20000 })
                    return
                }
                if (!res.ok) {
                    // Se frena acá: la orden NO queda finalizada con un comprobante sin validar
                    toast.error(`La orden no se finalizó. No se pudo validar ${comp.tipo_comprobante} ${comp.numero_comprobante}: ${data.error || `error ${res.status}`}`, { duration: 15000 })
                    return
                }
                for (const a of (data.avisos || []) as string[]) avisos.push(`${comp.tipo_comprobante} ${comp.numero_comprobante}: ${a}`)
            }
            const res = await fetch(`/api/ordenes-compra/${ordenId}/finalizar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ aceptar_faltantes: pendientes.length > 0, aceptar_canal_sin_comprobante: sinComprobante.length > 0 }),
            })
            const fin = await res.json().catch(() => ({}))
            for (const a of (fin.avisos || []) as string[]) avisos.push(a)
            if (avisos.length > 0) toast.warning(avisos.join(" · "), { duration: 15000 })
            if (!res.ok) { toast.error(fin.error || `La orden no se finalizó (error ${res.status})`, { duration: 20000 }); return }
            toast.success(fin.cerrada_sin_el_resto ? "Orden cerrada sin el resto de la mercadería" : "Orden finalizada")
        } finally {
            setTrabajando(false)
            cargar()
        }
    }

    // Los faltantes que no van a llegar se pueden volver a pedir: crea una orden nueva con lo
    // que el proveedor no envió, a los precios y descuentos de la orden original.
    async function generarOCFaltantes() {
        if (!datos) return
        const faltantes = filas.filter((f) => f.dif.pendiente_oc > 0)
        if (faltantes.length === 0) return
        // pendiente en unidades: una línea por bulto se repide en bultos ENTEROS (hacia arriba)
        const aPedir = (f: FilaVerificacion) => (f.pedido_por_bulto ? bultosParaCubrir(f.dif.pendiente_oc, f.unidades_por_bulto) : f.dif.pendiente_oc)
        const resumen = faltantes.map((f) => `· ${f.sku} — ${cant(aPedir(f))}${f.pedido_por_bulto ? ` bultos (${cant(aPedir(f) * f.unidades_por_bulto)} u)` : " u"} — ${f.descripcion}`).join("\n")
        if (!(await confirmar({ titulo: "¿Generar una orden de compra nueva con estos faltantes?", detalle: resumen, confirmar: "Generar orden" }))) return

        const { data: ocDetalle } = await supabase
            .from("ordenes_compra_detalle")
            .select("articulo_id, precio_unitario, descuento1, descuento2, descuento3, descuento4")
            .eq("orden_compra_id", ordenId)
        const items = faltantes.map((f) => {
            const det = (ocDetalle || []).find((d: any) => d.articulo_id === f.articulo_id)
            return {
                articulo_id: f.articulo_id,
                cantidad_pedida: aPedir(f),
                tipo_cantidad: f.pedido_por_bulto ? "bulto" : "unidad",
                precio_unitario: det?.precio_unitario || 0,
                descuento1: det?.descuento1 || 0, descuento2: det?.descuento2 || 0, descuento3: det?.descuento3 || 0, descuento4: det?.descuento4 || 0,
            }
        })
        const res = await fetch("/api/ordenes-compra/crear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proveedor_id: datos.orden.proveedor_id, observaciones: `Reposición de faltantes de ${datos.orden.numero_orden}`, items }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(`No se generó la orden de faltantes: ${data.error || `error ${res.status}`}`, { duration: 12000 }); return }
        toast.success(`Orden de reposición creada: ${data.orden?.numero_orden || "OK"}`)
        router.push("/ordenes-compra")
    }

    function generarOrdenPago() {
        if (!datos || !v) return
        const q = new URLSearchParams({ proveedor_id: datos.orden.proveedor_id || "", orden_compra_id: ordenId, monto: String(v.resumen.total_facturado) })
        router.push(`/ordenes-pago/nueva?${q}`)
    }

    if (cargando && !datos) {
        return <div className="min-h-screen bg-background p-6"><CargaProgreso mensajes={MENSAJES.ordenesCompra} className="mx-auto max-w-sm mt-24" /></div>
    }
    if (error && !datos) {
        return (
            <div className="min-h-screen bg-background p-6">
                <div className="max-w-xl mx-auto mt-24 p-4 border border-red-300 bg-red-50 rounded-lg text-sm text-red-800">
                    <p className="font-semibold">No se pudo abrir la verificación</p>
                    <p className="mt-1">{error}</p>
                    <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => { setCargando(true); cargar() }}>Reintentar</Button>
                        <Link href="/ordenes-compra"><Button size="sm" variant="outline">Volver a órdenes de compra</Button></Link>
                    </div>
                </div>
            </div>
        )
    }
    if (!datos || !v || !control) return null

    const tieneComps = datos.comprobantes.some((c) => c.estado !== "esperada")
    const todoOK = v.resumen.con_diferencias === 0 && filas.length > 0 && tieneComps
    const varias = columnas.length > 1
    const documentos = datos.documentos
    const fotos = documentos.filter((d) => !!d.url)

    return (
        <div className="min-h-screen bg-background p-6">
            {dialogo}
            <div className="flex items-center gap-4 mb-6 flex-wrap">
                <Link href="/ordenes-compra"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
                <div className="flex-1 min-w-60">
                    <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap">
                        Verificación — {datos.orden.numero_orden}
                        <Badge variant="outline">{ESTADOS_OC[datos.orden.estado] || datos.orden.estado}</Badge>
                    </h1>
                    <p className="text-muted-foreground">{datos.orden.proveedor_nombre || "Sin proveedor"} · pedido, recibido y facturado, artículo por artículo</p>
                </div>
                {!soloLectura && (
                    <div className="flex gap-2 flex-wrap">
                        {pendientes.length > 0 && (
                            <Button onClick={generarOCFaltantes} variant="outline" className="gap-2 border-amber-400 text-amber-700 hover:bg-amber-50">
                                <FileText className="h-4 w-4" /> Generar OC con faltantes
                            </Button>
                        )}
                        {tieneComps && (
                            <Button onClick={finalizarOC} disabled={trabajando || !control.puede}
                                title={!control.puede ? control.faltas.join(" ") : undefined}
                                className={`gap-2 ${todoOK ? "bg-green-600 hover:bg-green-700" : "bg-orange-500 hover:bg-orange-600"}`}>
                                <CheckCircle2 className="h-4 w-4" /> {pendientes.length > 0 ? "Cerrar sin el resto" : "Finalizar OC"}
                            </Button>
                        )}
                    </div>
                )}
                {tieneComps && (
                    <Button onClick={generarOrdenPago} variant="outline" className="gap-2"><CreditCard className="h-4 w-4" /> Generar Orden de Pago</Button>
                )}
            </div>

            {soloLectura && (
                <div className="mb-4 p-3 border rounded-lg bg-muted/40 text-sm flex items-center gap-2">
                    <Lock className="h-4 w-4" /> Esta orden está {datos.orden.estado === "cancelada" ? "cancelada" : "finalizada"}: se puede consultar, pero no modificar.
                </div>
            )}

            {(datos.conteos_tardios || []).length > 0 && (
                <div className="mb-4 p-4 border-2 border-amber-400 bg-amber-50 rounded-lg">
                    <p className="font-bold text-amber-900">Conteos del depósito que llegaron tarde y NO entraron al stock</p>
                    <p className="text-sm text-amber-900 mt-1">Otro equipo contó esto cuando la entrega ya estaba cerrada (estaba sin señal). Revisá con el depósito si esa mercadería llegó de verdad; si llegó, corregí lo recibido con el botón "Corregir" del artículo.</p>
                    <ul className="text-sm text-amber-900 mt-2 list-disc pl-5">
                        {(datos.conteos_tardios || []).map((a: any) => (
                            <li key={a.id}>{a.sku ? <strong>{a.sku}</strong> : null} {a.descripcion || "Artículo"}: contó {a.cantidad ?? "?"}{a.unidad ? ` (${a.unidad === "bulto" ? "bultos" : "unidades"})` : ""}{a.entrega ? ` — entrega ${a.entrega}` : ""}</li>
                        ))}
                    </ul>
                </div>
            )}

            {!soloLectura && datos.descuadres.length > 0 && (
                <div className="mb-4 p-4 border-2 border-red-400 bg-red-50 rounded-lg">
                    <p className="font-bold text-red-900">Los renglones no suman lo que dice el comprobante</p>
                    <ul className="text-sm text-red-900 mt-1 space-y-1">
                        {datos.descuadres.map((d) => (
                            <li key={d.comprobante_id}><strong>{d.comprobante}:</strong> {d.faltas.join(" ")}</li>
                        ))}
                    </ul>
                    <p className="text-xs text-red-800 mt-2">Hasta corregirlo, ese comprobante no se puede validar: editá los datos (lápiz), agregá el renglón que falta (+) o marcá como "No es mercadería" el concepto que corresponda.</p>
                </div>
            )}

            {!soloLectura && !control.puede && (
                <div className="mb-4 p-3 border border-sky-300 bg-sky-50 rounded-lg">
                    <p className="text-sm font-semibold text-sky-900">{control.falta_factura ? "Falta la factura para controlar precios" : "Todavía no se puede finalizar la orden"}</p>
                    <ul className="text-sm text-sky-900 mt-1 list-disc pl-5">{control.faltas.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </div>
            )}

            {!soloLectura && pendientes.length > 0 && (
                <div className="mb-4 p-3 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-900">
                    <strong>Falta recibir mercadería de {pendientes.length} artículo(s).</strong> La orden sigue abierta ("recibida en parte"): el depósito puede
                    recibir el resto en otra entrega sobre esta misma orden. Si no va a llegar, se cierra sin el resto (botón de arriba) o se vuelve a pedir con
                    "Generar OC con faltantes".
                </div>
            )}

            {v.resumen.sin_vincular > 0 && (
                <div className="mb-4 p-3 border border-amber-300 bg-amber-50 rounded-lg">
                    <p className="text-sm text-amber-800">
                        <strong>{v.resumen.sin_vincular} renglón{v.resumen.sin_vincular !== 1 ? "es" : ""} de comprobantes sin vincular al catálogo</strong> —
                        confirmalos en "Revisar matches" (más abajo); hasta entonces la verificación no los incluye.
                    </p>
                </div>
            )}

            {v.otros_conceptos.length > 0 && (
                <div className="mb-4 p-3 border rounded-lg bg-muted/30">
                    <p className="text-sm font-medium">Otros conceptos facturados (no son mercadería, no entran al stock)</p>
                    <ul className="text-sm text-muted-foreground mt-1">
                        {v.otros_conceptos.map((o, i) => (
                            <li key={i}>{o.comprobante} — {o.descripcion}{o.importe > 0 ? <> — <span className="font-mono">{moneda(o.importe)}</span> + impuestos</> : null}</li>
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-1">Ya están incluidos en el total de cada comprobante, que es lo que se registra como deuda.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total de la orden <span className="font-normal">(neto)</span></CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold">{moneda(v.resumen.total_oc)}</div></CardContent>
                </Card>
                <Card className="border-l-4 border-l-purple-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total facturado <span className="font-normal">(con impuestos)</span></CardTitle></CardHeader>
                    <CardContent>
                        <div className="text-xl font-bold">{tieneComps ? moneda(v.resumen.total_facturado) : <span className="text-muted-foreground">Sin comprobantes</span>}</div>
                        {v.resumen.nc_esperadas > 0 && <div className="text-xs text-muted-foreground mt-1">Notas de crédito esperadas del proveedor: {moneda(v.resumen.nc_esperadas)}</div>}
                        {v.resumen.nd_esperadas > 0 && <div className="text-xs text-muted-foreground mt-1">Mercadería de más que falta facturar: {moneda(v.resumen.nd_esperadas)}</div>}
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Artículos OK</CardTitle></CardHeader>
                    <CardContent><div className="text-xl font-bold text-green-600">{v.resumen.ok} / {v.resumen.articulos}</div></CardContent>
                </Card>
                <Card className={`border-l-4 ${v.resumen.con_diferencias > 0 ? "border-l-orange-500" : "border-l-green-500"}`}>
                    <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Con diferencias</CardTitle></CardHeader>
                    <CardContent><div className={`text-xl font-bold ${v.resumen.con_diferencias > 0 ? "text-orange-600" : "text-green-600"}`}>{v.resumen.con_diferencias}</div></CardContent>
                </Card>
            </div>

            {/* Comprobantes: subir, editar, validar, eliminar, documentos no leídos y revisar matches */}
            <div className="mb-6">
                <ComprobantesSection ordenId={ordenId} onChanged={cargar} soloLectura={soloLectura}
                    comprobantes={comprobantesVisibles}
                    documentos={documentos} onVerDocumento={setDocVisible} />
            </div>

            {resolviendo && (
                <ResolverDiferencia fila={resolviendo} filasOC={filas.filter((f) => !f.no_pedido)} transportes={datos.transportes} ordenId={ordenId}
                    recepcion={datos.recepciones.find((r) => r.id === resolviendo.recepcion_id) || null}
                    onCerrar={() => setResolviendo(null)} onHecho={() => { setResolviendo(null); cargar() }} />
            )}
            {corrigiendo && (
                <CorregirRecibido fila={corrigiendo} onCerrar={() => setCorrigiendo(null)} onHecho={() => { setCorrigiendo(null); cargar() }} />
            )}

            {fotos.length > 0 && (
                <div className="mb-3 flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-muted-foreground">Ver el comprobante al lado de la tabla:</span>
                    {fotos.map((d) => (
                        <Button key={d.id} size="sm" variant={docVisible?.id === d.id ? "default" : "outline"} className="h-7 gap-1"
                            onClick={() => setDocVisible(docVisible?.id === d.id ? null : d)}>
                            <ImageIcon className="h-3.5 w-3.5" /> {d.nombre_archivo || d.tipo_documento || "documento"}
                        </Button>
                    ))}
                </div>
            )}

            <div className={docVisible ? "grid grid-cols-1 xl:grid-cols-2 gap-4 items-start" : ""}>
                <Card>
                    <CardContent className="p-0 overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30">
                                    <TableHead className="w-[30px]"></TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Descripción</TableHead>
                                    <TableHead className="text-right">Pedido<br /><span className="text-[10px] text-muted-foreground font-normal">en unidades</span></TableHead>
                                    <TableHead className="text-right">Recibido<br /><span className="text-[10px] text-muted-foreground font-normal">en unidades</span></TableHead>
                                    {columnas.map((c) => (
                                        <TableHead key={`h-cant-${c.id}`} className="text-right text-xs">
                                            Cant. {c.tipo}<br /><span className="text-[10px] text-muted-foreground">{c.numero}</span>
                                            {c.es_remito && <><br /><span className="text-[10px] text-sky-700">controla cantidades</span></>}
                                        </TableHead>
                                    ))}
                                    {varias && <TableHead className="text-right font-bold">Facturado</TableHead>}
                                    <TableHead className="text-right">Precio OC<br /><span className="text-[10px] text-muted-foreground font-normal">neto por unidad</span></TableHead>
                                    {columnas.filter((c) => !c.es_remito).map((c) => (
                                        <TableHead key={`h-pre-${c.id}`} className="text-right text-xs">
                                            Precio {c.tipo}<br /><span className="text-[10px] text-muted-foreground">{c.numero}</span>
                                        </TableHead>
                                    ))}
                                    <TableHead className="text-center">Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filas.length === 0 ? (
                                    <TableRow><TableCell colSpan={20} className="text-center h-20 text-muted-foreground">Sin artículos</TableCell></TableRow>
                                ) : filas.map((f) => {
                                    const ok = f.banderas.length === 0
                                    const soloPendiente = !ok && f.banderas.every((b) => b === "pendiente")
                                    const { dif } = f
                                    const resueltos = [f.resuelto.precio && `precio: ${DESTINO[f.resuelto.precio] || f.resuelto.precio}`, f.resuelto.cantidad && `cantidad: ${DESTINO[f.resuelto.cantidad] || f.resuelto.cantidad}`].filter(Boolean)
                                    return (
                                        <TableRow key={f.articulo_id} className={f.no_pedido ? "bg-purple-50/50" : ok ? "" : soloPendiente ? "bg-amber-50/60" : "bg-orange-50/50"}>
                                            <TableCell>
                                                {ok ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                    : dif.recibido_unidades === 0 && !f.no_pedido ? <XCircle className="h-4 w-4 text-red-500" />
                                                        : <AlertTriangle className={`h-4 w-4 ${f.no_pedido ? "text-purple-500" : soloPendiente ? "text-amber-500" : "text-orange-500"}`} />}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                                            <TableCell className="text-sm max-w-[200px] truncate" title={f.descripcion}>{f.descripcion}</TableCell>
                                            <TableCell className="text-right font-mono">
                                                {dif.oc ? cant(dif.oc.unidades) : <span className="text-muted-foreground">—</span>}
                                                {dif.oc && f.pedido_por_bulto && dif.oc.unidades > 0 ? <div className="text-[10px] text-muted-foreground">{cant(desdeUnidadesBase(dif.oc.unidades, f.unidades_por_bulto))} bultos × {cant(f.unidades_por_bulto)}</div> : null}
                                                {f.sin_unidades_por_bulto ? <div className="text-[10px] text-red-600 font-sans" title="Se pidió por bulto y el artículo no tiene unidades por bulto: se toma 1 unidad por bulto. Cargá el dato en la ficha del artículo.">⚠ sin unidades por bulto</div> : null}
                                            </TableCell>
                                            <TableCell className={`text-right font-mono ${dif.pendiente_oc > 0 || f.banderas.includes("cantidad") ? "text-orange-600 font-bold" : ""}`}>
                                                {cant(dif.recibido_unidades)}
                                                {f.pedido_por_bulto && dif.recibido_unidades > 0 && f.unidades_por_bulto > 1 ? <div className="text-[10px] text-muted-foreground font-normal">{cant(desdeUnidadesBase(dif.recibido_unidades, f.unidades_por_bulto))} bultos</div> : null}
                                                {dif.pendiente_oc > 0 ? <div className="text-[10px] text-amber-700 font-sans font-normal">faltan {cant(dif.pendiente_oc)}</div> : null}
                                            </TableCell>
                                            {columnas.map((c) => {
                                                const d = f.por_comprobante[c.id]
                                                return <TableCell key={`c-${c.id}`} className="text-right font-mono text-sm">{d ? cant(d.unidades) : <span className="text-muted-foreground">—</span>}</TableCell>
                                            })}
                                            {varias && (
                                                <TableCell className="text-right font-mono font-bold">
                                                    {dif.factura ? cant(dif.factura.unidades) : <span className="text-muted-foreground">—</span>}
                                                    {dif.factura && dif.factura.bonificadas > 0 ? <div className="text-[10px] text-green-700 font-sans font-normal">{cant(dif.factura.bonificadas)} sin cargo</div> : null}
                                                </TableCell>
                                            )}
                                            <TableCell className="text-right font-mono">{dif.oc ? moneda(dif.oc.neto_unidad) : <span className="text-muted-foreground">—</span>}</TableCell>
                                            {columnas.filter((c) => !c.es_remito).map((c) => {
                                                const d = f.por_comprobante[c.id]
                                                return <TableCell key={`p-${c.id}`} className={`text-right font-mono text-sm ${f.banderas.includes("precio") ? "text-orange-600 font-bold" : ""}`}>{d && d.neto_unidad > 0 ? moneda(d.neto_unidad) : d ? <span className="text-green-700 text-xs font-sans">sin cargo</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                                            })}
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center gap-1">
                                                    {ok ? <Badge className="text-xs bg-green-500">OK</Badge>
                                                        : f.banderas.map((b) => <Badge key={b} className={`text-xs ${BANDERA[b].clase}`}>{BANDERA[b].texto}{b === "pendiente" ? ` ${cant(dif.pendiente_oc)} u` : ""}</Badge>)}
                                                    {resueltos.length > 0 && <Badge variant="outline" className="text-[10px] text-green-700 border-green-300">Resuelto — {resueltos.join(" · ")}</Badge>}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {!soloLectura && (
                                                    <div className="flex gap-1 justify-end">
                                                        {f.recepcion_item_id && (
                                                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Corregir lo que contó el depósito" onClick={() => setCorrigiendo(f)}>
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </Button>
                                                        )}
                                                        {!ok && (
                                                            <Button variant="outline" size="sm" className="text-xs h-7 text-orange-600 gap-1" onClick={() => setResolviendo(f)}>
                                                                <Scale className="h-3 w-3" /> {soloPendiente ? "Ver" : "Resolver"}
                                                            </Button>
                                                        )}
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

                {docVisible && (
                    <Card className="xl:sticky xl:top-4">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ImageIcon className="h-4 w-4" /> <span className="truncate">{docVisible.nombre_archivo || "Documento"}</span>
                                <a href={docVisible.url || "#"} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-blue-600 underline shrink-0">abrir aparte</a>
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setDocVisible(null)}><X className="h-4 w-4" /></Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {(docVisible.tipo_mime || "").includes("pdf") || /\.pdf($|\?)/i.test(docVisible.nombre_archivo || "")
                                ? <iframe src={docVisible.url || ""} title="Comprobante" className="w-full h-[75vh] border rounded" />
                                // eslint-disable-next-line @next/next/no-img-element
                                : <div className="max-h-[75vh] overflow-auto border rounded"><img src={docVisible.url || ""} alt="Comprobante" className="w-full" decoding="async" /></div>}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}
