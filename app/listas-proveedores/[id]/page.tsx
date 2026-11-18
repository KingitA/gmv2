"use client"

// Una lista de precios de proveedor: VISTA PREVIA antes de aplicar (E-20).
// Por artículo: costo actual → nuevo, % de cambio, alertas de subas o bajas grandes, y qué precios
// de venta quedan desactualizados. La cuenta la hace el servidor (lib/compras/listas-servidor.ts).
// Aplicar no toca precios de venta. Con vigencia futura la lista queda programada.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { InputMonto } from "@/components/ui/input-monto"
import { useConfirmar } from "@/components/ui/confirmar"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { ArrowLeft, CalendarClock, CheckCircle, FileText, Loader2, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { fecha, hoyISO, moneda, porcentaje } from "@/lib/formato"
import { cant } from "@/lib/deposito/unidades"
import { esVigenciaFutura } from "@/lib/compras/lista-proveedor"
import type { ItemVistaPrevia, VistaPreviaLista } from "@/lib/compras/listas-servidor"

type Filtro = "todos" | "cambian" | "alertas" | "venta" | "revisar" | "sin_articulo" | "errores"

const ESTADO_LISTA: Record<string, { texto: string; clase: string }> = {
    pendiente: { texto: "Pendiente", clase: "bg-blue-100 text-blue-800" },
    programada: { texto: "Programada", clase: "bg-violet-100 text-violet-800" },
    aplicada: { texto: "Aplicada", clase: "bg-green-100 text-green-800" },
    vencida: { texto: "Vencida", clase: "bg-red-100 text-red-800" },
    borrador: { texto: "Borrador", clase: "bg-gray-100 text-gray-800" },
}
const ESTADO_ITEM: Record<string, string> = { pendiente: "se aplica", revisar: "por revisar", ignorado: "no se aplica", aplicado: "aplicado", error: "con error" }

const descuentos = (d: Array<number | null>) => d.map((x) => (x == null ? "·" : `${cant(x)} %`)).join(" + ")
const descuentosDe = (d: number[]) => (d.some((x) => x > 0) ? d.filter((x) => x > 0).map((x) => `${cant(x)} %`).join(" + ") : "sin descuento")

export default function DetalleListaPage() {
    const params = useParams()
    const listaId = params.id as string
    const { confirmar, dialogo } = useConfirmar()
    const [vista, setVista] = useState<VistaPreviaLista | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [cargando, setCargando] = useState(true)
    const [trabajando, setTrabajando] = useState(false)
    const [umbral, setUmbral] = useState<number | null>(null)
    const [filtro, setFiltro] = useState<Filtro>("todos")
    const [resultado, setResultado] = useState<any>(null)

    const cargar = useCallback(async (umbralPct?: number | null) => {
        try {
            const res = await fetch(`/api/listas-proveedores/${listaId}${umbralPct ? `?umbral=${umbralPct}` : ""}`, { cache: "no-store" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { setError(data.error || `No se pudo cargar la lista (error ${res.status})`); return }
            setError(null)
            setVista(data)
        } catch {
            setError("No se pudo cargar la lista: sin conexión con el servidor.")
        } finally {
            setCargando(false)
        }
    }, [listaId])

    useEffect(() => { if (listaId) cargar() }, [listaId, cargar])

    const items = vista?.items || []
    const visibles = useMemo(() => items.filter((i) => {
        if (filtro === "cambian") return i.estado_item === "pendiente" && !!i.cambio && Object.keys(i.cambio.cambios).length > 0
        if (filtro === "alertas") return !!i.cambio?.alerta && i.estado_item !== "ignorado"
        if (filtro === "venta") return i.venta?.tipo === "desactualizado" && i.estado_item !== "ignorado"
        if (filtro === "revisar") return i.estado_item === "revisar"
        if (filtro === "sin_articulo") return i.estado_item === "ignorado"
        if (filtro === "errores") return i.estado_item === "error"
        return true
    }), [items, filtro])

    if (cargando) return <CargaProgreso mensajes={MENSAJES.general} />
    if (error || !vista) {
        return (
            <div className="p-6">
                <p className="text-red-700">{error || "No se pudo cargar la lista."}</p>
                <Link href="/listas-proveedores" className="text-blue-600 underline text-sm">Volver a las listas</Link>
            </div>
        )
    }

    const { lista, resumen } = vista
    const estado = ESTADO_LISTA[lista.estado] || { texto: lista.estado, clase: "" }
    const futura = esVigenciaFutura(lista.fecha_vigencia, hoyISO())
    const editable = lista.estado !== "aplicada"

    const accionItem = async (item: ItemVistaPrevia, accion: "confirmar" | "ignorar" | "incluir") => {
        const res = await fetch(`/api/listas-proveedores/${listaId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: item.id, accion }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo guardar el cambio"); return }
        cargar(umbral)
    }

    const aplicar = async (aplicarHoy: boolean) => {
        const programar = futura && !aplicarHoy
        const lineas: string[] = []
        if (programar) lineas.push(`La lista rige desde el ${fecha(lista.fecha_vigencia)}: queda PROGRAMADA y se aplica sola ese día. Hoy no cambia ningún precio.`)
        else lineas.push(`Se actualiza el costo (precio de lista y descuentos) de ${resumen.con_cambio} artículo(s). ${resumen.sin_cambio > 0 ? `${resumen.sin_cambio} ya estaban igual. ` : ""}Cada cambio queda en el historial de costo del artículo.`)
        if (aplicarHoy && futura) lineas.push(`⚠ La lista dice que rige desde el ${fecha(lista.fecha_vigencia)} y la estás aplicando HOY.`)
        if (resumen.subas_grandes + resumen.bajas_grandes > 0) lineas.push(`⚠ ${resumen.subas_grandes} suba(s) y ${resumen.bajas_grandes} baja(s) de más de ${cant(vista.umbral_pct)} %. Revisalas antes: puede ser un error del archivo.`)
        if (resumen.por_revisar > 0) lineas.push(`⚠ Quedan ${resumen.por_revisar} renglón(es) por revisar (artículo sugerido sin confirmar): no se aplican, y la lista no queda como "aplicada" hasta resolverlos.`)
        if (resumen.sin_articulo > 0) lineas.push(`${resumen.sin_articulo} renglón(es) no tienen artículo: no se aplican.`)
        if (resumen.venta_desactualizados > 0) lineas.push(`Precios de venta: ${resumen.venta_desactualizados} artículo(s) tienen precio de venta guardado y NO se tocan: van a quedar con otro margen. Después de aplicar se listan para revisarlos.`)
        if (resumen.venta_cambian_solos > 0) lineas.push(`${resumen.venta_cambian_solos} artículo(s) no tienen precio de venta guardado: su precio de venta se calcula desde el costo y cambia solo.`)
        const ok = await confirmar({
            titulo: programar ? `¿Programar la lista para el ${fecha(lista.fecha_vigencia)}?` : "¿Aplicar la lista ahora?",
            detalle: lineas.join("\n\n"),
            confirmar: programar ? "Programar" : "Aplicar",
            peligro: !programar && (resumen.subas_grandes + resumen.bajas_grandes > 0 || (aplicarHoy && futura)),
        })
        if (!ok) return
        setTrabajando(true)
        try {
            const res = await fetch(`/api/listas-proveedores/${listaId}/aplicar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aplicar_hoy: aplicarHoy }) })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || `No se pudo aplicar la lista (error ${res.status})`, { duration: 15000 }); return }
            setResultado(data)
            if (data.programada) toast.success(`Lista programada para el ${fecha(lista.fecha_vigencia)}`)
            else if ((data.errores || []).length > 0) toast.warning(`Se aplicaron ${data.aplicados} artículo(s) y ${data.errores.length} renglón(es) fallaron: la lista NO quedó como aplicada.`, { duration: 15000 })
            else toast.success(`Lista aplicada: ${data.aplicados} artículo(s) actualizados`)
            await cargar(umbral)
        } finally {
            setTrabajando(false)
        }
    }

    const desprogramar = async () => {
        const res = await fetch(`/api/listas-proveedores/${listaId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "desprogramar" }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo sacar de programada"); return }
        toast.success("La lista volvió a pendiente")
        cargar(umbral)
    }

    const chip = (f: Filtro, texto: string, n: number, clase = "") => (
        <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} className={`h-7 ${filtro === f ? "" : clase}`} onClick={() => setFiltro(f)}>{texto} ({n})</Button>
    )
    const ventaResultado: any[] = (resultado?.precios_venta || []).filter((v: any) => v.tipo === "desactualizado")

    return (
        <div className="min-h-screen bg-background p-6 space-y-4">
            {dialogo}
            <div className="flex items-center gap-4 flex-wrap">
                <Link href="/listas-proveedores"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
                <div className="flex-1 min-w-60">
                    <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap">
                        {lista.nombre || "Lista de precios"} <Badge className={estado.clase}>{estado.texto}</Badge>
                        {lista.origen === "mail" && <Badge variant="outline">llegó por mail</Badge>}
                    </h1>
                    <p className="text-muted-foreground">
                        {vista.proveedor_nombre || "Sin proveedor"} · rige desde el {fecha(lista.fecha_vigencia)}{lista.fecha_fin ? ` hasta el ${fecha(lista.fecha_fin)}` : ""}
                        {" · "}descuentos {vista.tipo_descuento === "sobre_lista" ? "sobre precio de lista" : "en cascada"}
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                    {vista.archivo_enlace && (
                        <a href={vista.archivo_enlace} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" className="gap-2"><FileText className="h-4 w-4" /> Ver el archivo</Button>
                        </a>
                    )}
                    {lista.estado === "programada" && <Button variant="outline" onClick={desprogramar}>Sacar de programada</Button>}
                    {editable && lista.estado !== "programada" && futura && (
                        <Button onClick={() => aplicar(false)} disabled={trabajando || resumen.se_aplican === 0} className="gap-2 bg-violet-600 hover:bg-violet-700">
                            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Programar para el {fecha(lista.fecha_vigencia)}
                        </Button>
                    )}
                    {editable && (
                        <Button onClick={() => aplicar(true)} disabled={trabajando || resumen.se_aplican === 0} variant={futura ? "outline" : "default"} className="gap-2">
                            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} {futura ? "Aplicar hoy igual" : "Aplicar la lista"}
                        </Button>
                    )}
                </div>
            </div>

            {lista.estado === "programada" && (
                <div className="p-3 border border-violet-300 bg-violet-50 rounded-lg text-sm text-violet-900">
                    Esta lista está <strong>programada</strong>: se aplica sola el {fecha(lista.fecha_vigencia)}. Hasta ese día no cambia ningún precio.
                </div>
            )}
            {resumen.con_error > 0 && (
                <div className="p-3 border-2 border-red-400 bg-red-50 rounded-lg text-sm text-red-900">
                    <strong>{resumen.con_error} renglón(es) no se pudieron aplicar.</strong> La lista no queda como aplicada hasta resolverlos: mirá el motivo en cada uno (filtro "Con error"), corregilo o marcalo "No aplicar", y volvé a aplicar.
                </div>
            )}
            {ventaResultado.length > 0 && (
                <div className="p-3 border-2 border-amber-400 bg-amber-50 rounded-lg text-sm text-amber-900 space-y-1">
                    <p className="font-bold">Precios de venta para revisar ({ventaResultado.length})</p>
                    <p>El costo de estos artículos cambió y su precio de venta guardado NO se tocó: quedaron con otro margen que el de su ficha.</p>
                    <ul className="list-disc pl-5">
                        {ventaResultado.slice(0, 30).map((v) => (
                            <li key={v.articulo_id}>
                                <Link className="underline" href={`/articulos?buscar=${encodeURIComponent(v.sku || "")}`}>{v.sku} — {v.descripcion}</Link>: precio base {moneda(v.precio_base_guardado)}; con el costo nuevo daría {moneda(v.precio_base_segun_costo)} ({v.diferencia_pct > 0 ? "+" : ""}{porcentaje(v.diferencia_pct, 1)})
                            </li>
                        ))}
                    </ul>
                    {ventaResultado.length > 30 && <p>…y {ventaResultado.length - 30} más (filtro "Precio de venta").</p>}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Renglones</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{resumen.total}</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Cambian el costo</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{resumen.con_cambio}</div><div className="text-xs text-muted-foreground">{resumen.sin_cambio} ya estaban igual</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Subas / bajas de más de {cant(vista.umbral_pct)} %</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${resumen.subas_grandes + resumen.bajas_grandes > 0 ? "text-orange-600" : ""}`}>{resumen.subas_grandes} / {resumen.bajas_grandes}</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Por revisar / sin artículo</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${resumen.por_revisar > 0 ? "text-amber-600" : ""}`}>{resumen.por_revisar} / {resumen.sin_articulo}</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Precio de venta a revisar</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${resumen.venta_desactualizados > 0 ? "text-amber-600" : ""}`}>{resumen.venta_desactualizados}</div><div className="text-xs text-muted-foreground">{resumen.venta_cambian_solos} cambian solos</div></CardContent></Card>
            </div>

            <div className="flex gap-2 flex-wrap items-center">
                {chip("todos", "Todos", resumen.total)}
                {chip("cambian", "Cambian", resumen.con_cambio)}
                {chip("alertas", "Subas / bajas grandes", resumen.subas_grandes + resumen.bajas_grandes, "border-orange-300 text-orange-700")}
                {chip("venta", "Precio de venta", resumen.venta_desactualizados, "border-amber-300 text-amber-700")}
                {chip("revisar", "Por revisar", resumen.por_revisar, "border-amber-300 text-amber-700")}
                {chip("sin_articulo", "No se aplican", resumen.sin_articulo)}
                {resumen.con_error > 0 && chip("errores", "Con error", resumen.con_error, "border-red-300 text-red-700")}
                <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Avisar cambios de más de</span>
                    <InputMonto decimales={0} soloPositivos className="h-8 w-16 rounded-md border px-2 text-sm tabular-nums" value={umbral ?? vista.umbral_pct}
                        onChange={(n) => { setUmbral(n); if (n && n > 0) cargar(n) }} />
                    <span className="text-muted-foreground">%</span>
                </div>
            </div>

            <Card>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>En el archivo</TableHead>
                                <TableHead>Artículo</TableHead>
                                <TableHead className="text-right">Costo actual</TableHead>
                                <TableHead className="text-right">Costo nuevo</TableHead>
                                <TableHead className="text-right">Cambio</TableHead>
                                <TableHead>Precio de venta</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibles.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No hay renglones con ese filtro.</TableCell></TableRow>}
                            {visibles.map((i) => {
                                const c = i.cambio
                                const cambia = !!c && Object.keys(c.cambios).length > 0
                                return (
                                    <TableRow key={i.id} className={i.estado_item === "ignorado" ? "opacity-60" : i.estado_item === "error" ? "bg-red-50" : c?.alerta ? "bg-orange-50/60" : ""}>
                                        <TableCell className="text-sm">
                                            <div className="font-medium">{i.codigo_proveedor ? `${i.codigo_proveedor} — ` : ""}{i.descripcion_proveedor || "(sin descripción)"}</div>
                                            <div className="text-xs text-muted-foreground">
                                                precio {i.archivo.precio_compra != null ? moneda(i.archivo.precio_compra) : "sin dato (no se toca)"} · desc. {descuentos(i.archivo.descuentos)} <span title="· = vacío en el archivo: ese descuento no se toca">ⓘ</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {i.articulo ? <><span className="font-mono">{i.articulo.sku}</span> — {i.articulo.descripcion}</> : i.sugerido ? (
                                                <div>
                                                    <div className="text-amber-700">¿{i.sugerido.sku} — {i.sugerido.descripcion}?</div>
                                                    {i.sugerido.otro_proveedor && <div className="text-xs font-semibold text-red-700">⚠ Artículo de otro proveedor ({i.sugerido.otro_proveedor})</div>}
                                                </div>
                                            ) : <span className="text-muted-foreground">sin artículo</span>}
                                            <div className="text-xs text-muted-foreground">{ESTADO_ITEM[i.estado_item] || i.estado_item}{i.error ? `: ${i.error}` : ""}</div>
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums">
                                            {c ? <><div>{moneda(c.actual.precio)}</div><div className="text-xs text-muted-foreground">{descuentosDe(c.actual.descuentos)} = {moneda(c.actual.neto)}</div></> : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums">
                                            {c ? <><div className={cambia ? "font-semibold" : ""}>{moneda(c.nuevo.precio)}</div><div className="text-xs text-muted-foreground">{descuentosDe(c.nuevo.descuentos)} = {moneda(c.nuevo.neto)}</div></> : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums">
                                            {!c ? "—" : !cambia ? <span className="text-muted-foreground">igual</span> : c.variacion_pct == null ? <span className="text-muted-foreground">sin costo previo</span> : (
                                                <span className={`inline-flex items-center gap-1 ${c.alerta ? "font-bold text-orange-700" : c.variacion_pct > 0 ? "text-red-600" : c.variacion_pct < 0 ? "text-green-700" : ""}`}>
                                                    {c.alerta && <TriangleAlert className="h-4 w-4" />}
                                                    {c.variacion_pct > 0 ? <TrendingUp className="h-4 w-4" /> : c.variacion_pct < 0 ? <TrendingDown className="h-4 w-4" /> : null}
                                                    {c.variacion_pct > 0 ? "+" : ""}{porcentaje(c.variacion_pct, 1)}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {i.venta?.tipo === "desactualizado" ? (
                                                <span className="text-amber-800">Guardado {moneda(i.venta.precio_base_guardado)}; con el costo nuevo daría {moneda(i.venta.precio_base_segun_costo)} ({(i.venta.diferencia_pct ?? 0) > 0 ? "+" : ""}{porcentaje(i.venta.diferencia_pct, 1)}). No se toca.</span>
                                            ) : i.venta?.tipo === "cambia_solo" ? <span className="text-muted-foreground">Cambia solo con el costo: {moneda(i.venta.precio_base_segun_costo)}</span> : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap">
                                            {editable && i.estado_item === "revisar" && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => accionItem(i, "confirmar")}>Es ese</Button>}
                                            {editable && (i.estado_item === "pendiente" || i.estado_item === "revisar" || i.estado_item === "error") && <Button size="sm" variant="ghost" className="h-7" onClick={() => accionItem(i, "ignorar")}>No aplicar</Button>}
                                            {editable && i.estado_item === "ignorado" && i.articulo && <Button size="sm" variant="ghost" className="h-7" onClick={() => accionItem(i, "incluir")}>Aplicar</Button>}
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
