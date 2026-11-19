"use client"

// Una lista de precios de proveedor: VISTA PREVIA antes de aplicar (E-20).
// Por artículo: costo actual → nuevo, % de cambio, alertas, lo que NO se aplica sin confirmar (cambio
// mayor al tope, lista por bulto sin unidades por bulto, lista posterior ya aplicada) y qué precios de
// venta quedan desactualizados. La cuenta la hace el servidor (lib/compras/listas-servidor.ts); los
// renglones vienen de a 200 y la aplicación va de a 200, con el avance a la vista.
// Aplicar no toca precios de venta. Con vigencia futura la lista queda programada.

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { InputMonto } from "@/components/ui/input-monto"
import { useConfirmar } from "@/components/ui/confirmar"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { ArrowLeft, CalendarClock, CheckCircle, FileText, Loader2, Trash2, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { fecha, hoyISO, moneda, porcentaje } from "@/lib/formato"
import { cant } from "@/lib/deposito/unidades"
import { esVigenciaFutura } from "@/lib/compras/lista-proveedor"
import type { FiltroLista, ItemVistaPrevia, VistaPreviaLista } from "@/lib/compras/listas-servidor"

const ESTADO_LISTA: Record<string, { texto: string; clase: string }> = {
    pendiente: { texto: "Pendiente", clase: "bg-blue-100 text-blue-800" },
    programada: { texto: "Programada", clase: "bg-violet-100 text-violet-800" },
    aplicada: { texto: "Aplicada", clase: "bg-green-100 text-green-800" },
    vencida: { texto: "Vencida", clase: "bg-red-100 text-red-800" },
    borrador: { texto: "Borrador", clase: "bg-gray-100 text-gray-800" },
}
const ESTADO_ITEM: Record<string, string> = { pendiente: "se aplica", revisar: "por revisar", ignorado: "no se aplica", aplicado: "aplicado", error: "con error" }

// Solo los descuentos que vienen en el archivo (los vacíos no se tocan y no se muestran)
const descuentos = (d: Array<number | null>) => {
    const vienen = d.filter((x): x is number => x != null)
    return vienen.length > 0 ? vienen.map((x) => `${cant(x)} %`).join(" + ") : "sin dato (no se tocan)"
}
const descuentosDe = (d: number[]) => (d.some((x) => x > 0) ? d.filter((x) => x > 0).map((x) => `${cant(x)} %`).join(" + ") : "sin descuento")

export default function DetalleListaPage() {
    const params = useParams()
    const listaId = params.id as string
    const router = useRouter()
    const { confirmar, dialogo } = useConfirmar()
    const [vista, setVista] = useState<VistaPreviaLista | null>(null)
    const [items, setItems] = useState<ItemVistaPrevia[]>([])
    const [error, setError] = useState<string | null>(null)
    const [cargando, setCargando] = useState(true)
    const [cargandoMas, setCargandoMas] = useState(false)
    const [trabajando, setTrabajando] = useState(false)
    const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null)
    const [umbral, setUmbral] = useState<number | null>(null)
    const [filtro, setFiltro] = useState<FiltroLista>("todos")
    const [resultado, setResultado] = useState<any>(null)

    // Trae el resumen de toda la lista y UNA página de renglones (ya filtrados en el servidor)
    const cargar = useCallback(async (op: { filtro?: FiltroLista; umbral?: number | null; pagina?: number } = {}) => {
        const pagina = op.pagina || 1
        const q = new URLSearchParams({ filtro: op.filtro || "todos", pagina: String(pagina) })
        if (op.umbral) q.set("umbral", String(op.umbral))
        try {
            const res = await fetch(`/api/listas-proveedores/${listaId}?${q}`, { cache: "no-store" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { setError(data.error || `No se pudo cargar la lista (error ${res.status})`); return }
            setError(null)
            setVista(data)
            setItems((prev) => (pagina > 1 ? [...prev, ...(data.items || [])] : data.items || []))
        } catch {
            setError("No se pudo cargar la lista: sin conexión con el servidor.")
        } finally {
            setCargando(false)
            setCargandoMas(false)
        }
    }, [listaId])

    useEffect(() => { if (listaId) cargar() }, [listaId, cargar])

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
    const recargar = () => cargar({ filtro, umbral })
    const cambiarFiltro = (f: FiltroLista) => { setFiltro(f); cargar({ filtro: f, umbral }) }

    const patch = async (cuerpo: Record<string, unknown>, okTexto?: string) => {
        const res = await fetch(`/api/listas-proveedores/${listaId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo guardar el cambio", { duration: 10000 }); return false }
        if (okTexto) toast.success(okTexto)
        await recargar()
        return true
    }
    const accionItem = (item: ItemVistaPrevia, accion: "confirmar" | "ignorar" | "incluir" | "confirmar_tope") => patch({ item_id: item.id, accion })

    const confirmarTope = async (i: ItemVistaPrevia) => {
        const c = i.cambio
        const ok = await confirmar({
            titulo: "¿Aplicar este cambio igual?",
            detalle: `${i.articulo?.sku} — ${i.articulo?.descripcion}\n\nCosto actual ${moneda(c?.actual.neto)} → nuevo ${moneda(c?.nuevo.neto)} por unidad (${(c?.variacion_pct ?? 0) > 0 ? "+" : ""}${porcentaje(c?.variacion_pct, 1)}).\n\n${c?.frena || ""}\n\nUn cambio así casi siempre es un error del archivo (un precio por bulto tomado como precio por unidad, una coma corrida). Confirmalo solo si el precio es ese de verdad.`,
            confirmar: "Sí, el precio es ese", peligro: true,
        })
        if (ok) accionItem(i, "confirmar_tope")
    }

    const cambiarPrecioPor = async (valor: "unidad" | "bulto") => {
        if (valor === vista.precio_por) return
        const ok = await confirmar({
            titulo: valor === "bulto" ? "¿El precio de esta lista es POR BULTO?" : "¿El precio de esta lista es POR UNIDAD?",
            detalle: valor === "bulto"
                ? "Cada precio del archivo se va a dividir por las unidades por bulto del artículo para sacar el costo por unidad. Los artículos sin unidades por bulto quedan para revisar.\n\nQueda guardado como la forma en que este proveedor manda sus listas."
                : "Cada precio del archivo se toma tal cual como costo por unidad.\n\nQueda guardado como la forma en que este proveedor manda sus listas.",
            confirmar: "Sí, cambiar",
        })
        if (ok) patch({ accion: "precio_por", valor }, "Listo: la vista previa se recalculó")
    }

    const aplicar = async (aplicarHoy: boolean) => {
        const programar = futura && !aplicarHoy
        const lineas: string[] = []
        if (programar) lineas.push(`La lista rige desde el ${fecha(lista.fecha_vigencia)}: queda PROGRAMADA y se aplica sola ese día, con los mismos controles. Hoy no cambia ningún precio.`)
        else lineas.push(`Se actualiza el costo (precio de lista y descuentos) de ${resumen.con_cambio} artículo(s). ${resumen.sin_cambio > 0 ? `${resumen.sin_cambio} ya estaban igual. ` : ""}Cada cambio queda en el historial de costo del artículo.`)
        lineas.push(`El precio del archivo se toma ${vista.precio_por === "bulto" ? "POR BULTO (se divide por las unidades por bulto de cada artículo)" : "POR UNIDAD"}.`)
        if (aplicarHoy && futura) lineas.push(`⚠ La lista dice que rige desde el ${fecha(lista.fecha_vigencia)} y la estás aplicando HOY.`)
        if (resumen.frenados > 0) lineas.push(`⚠ ${resumen.frenados} renglón(es) NO se aplican: cambian más de ${cant(vista.tope_pct)} % o no se puede sacar el precio por unidad. Quedan "por revisar" para confirmarlos uno por uno.`)
        if (resumen.lista_posterior > 0) lineas.push(`${resumen.lista_posterior} renglón(es) no se aplican porque ya hay una lista posterior aplicada para esos artículos.`)
        if (resumen.subas_grandes + resumen.bajas_grandes > 0) lineas.push(`⚠ ${resumen.subas_grandes} suba(s) y ${resumen.bajas_grandes} baja(s) de más de ${cant(vista.umbral_pct)} % SÍ se aplican (no llegan al tope). Miralas antes.`)
        if (resumen.por_revisar > 0) lineas.push(`Quedan ${resumen.por_revisar} renglón(es) por revisar: no se aplican, y la lista no queda como "aplicada" hasta resolverlos.`)
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
        const total = resumen.se_aplican + resumen.frenados + resumen.lista_posterior
        const acumulado = { aplicados: 0, sin_cambio: 0, para_revisar: 0, salteados: 0, errores: [] as any[], precios_venta: [] as any[], programada: false, aplicada: false }
        try {
            // De a 200 renglones por llamada, hasta que no quede ninguno (o algo falle)
            for (let vuelta = 0; vuelta < 500; vuelta++) {
                const res = await fetch(`/api/listas-proveedores/${listaId}/aplicar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aplicar_hoy: aplicarHoy, primera: vuelta === 0 }) })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) {
                    toast.error(`${data.error || `No se pudo aplicar la lista (error ${res.status})`}${vuelta > 0 ? ` Hasta acá se aplicaron ${acumulado.aplicados} artículo(s): volvé a tocar "Aplicar" para seguir con el resto.` : ""}`, { duration: 20000 })
                    break
                }
                if (vuelta === 0) acumulado.precios_venta = data.precios_venta || []
                acumulado.aplicados += Number(data.aplicados || 0)
                acumulado.sin_cambio += Number(data.sin_cambio || 0)
                acumulado.para_revisar += Number(data.para_revisar || 0)
                acumulado.salteados += Number(data.salteados_por_lista_posterior || 0)
                acumulado.errores.push(...(data.errores || []))
                acumulado.programada = !!data.programada
                acumulado.aplicada = !!data.aplicada
                const quedan = Number(data.quedan || 0)
                setAvance({ hechos: Math.max(0, total - quedan), total })
                if (data.programada || quedan === 0 || Number(data.procesados || 0) === 0) break
            }
            setResultado(acumulado)
            if (acumulado.programada) toast.success(`Lista programada para el ${fecha(lista.fecha_vigencia)}`)
            else if (acumulado.errores.length > 0) toast.warning(`Se aplicaron ${acumulado.aplicados} artículo(s) y ${acumulado.errores.length} renglón(es) fallaron: la lista NO quedó como aplicada.`, { duration: 15000 })
            else if (acumulado.para_revisar > 0) toast.warning(`Se aplicaron ${acumulado.aplicados} artículo(s). ${acumulado.para_revisar} quedaron por revisar (superan el tope): confirmalos uno por uno.`, { duration: 15000 })
            else toast.success(`Lista aplicada: ${acumulado.aplicados} artículo(s) actualizados`)
            await recargar()
        } finally {
            setTrabajando(false)
            setAvance(null)
        }
    }

    // Una lista que no cambió ningún costo se puede eliminar (pendiente, programada, o aplicada "sin cambios")
    const eliminar = async () => {
        const ok = await confirmar({
            titulo: "¿Eliminar esta lista?",
            detalle: `${lista.nombre || "Lista de precios"} — ${vista.proveedor_nombre || "sin proveedor"}\n\nSe borran la lista, sus ${resumen.total} renglón(es) y el archivo. No cambió el costo de ningún artículo, así que no queda nada que deshacer. No se puede recuperar.`,
            confirmar: "Eliminar lista", peligro: true,
        })
        if (!ok) return
        const res = await fetch(`/api/listas-proveedores/${listaId}`, { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo eliminar la lista", { duration: 12000 }); return }
        toast.success("Lista eliminada")
        router.push("/listas-proveedores")
    }

    const chip = (f: FiltroLista, texto: string, n: number, clase = "") => (
        <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} className={`h-7 ${filtro === f ? "" : clase}`} onClick={() => cambiarFiltro(f)}>{texto} ({n})</Button>
    )
    const ventaResultado: any[] = (resultado?.precios_venta || []).filter((v: any) => v.tipo === "desactualizado")
    const hayMas = items.length < vista.total_filtrados

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
                    {vista.archivos.map((a, i) => (
                        <a key={i} href={a.enlace} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" className="gap-2"><FileText className="h-4 w-4" /> {vista.archivos.length > 1 ? a.nombre : "Ver el archivo"}</Button>
                        </a>
                    ))}
                    {lista.estado === "programada" && <Button variant="outline" onClick={() => patch({ accion: "desprogramar" }, "La lista volvió a pendiente")}>Sacar de programada</Button>}
                    {vista.cambios_de_costo === 0 && !trabajando && (
                        <Button variant="outline" className="gap-2 text-red-700 border-red-300 hover:bg-red-50" onClick={eliminar} title="Esta lista no cambió ningún costo: se puede eliminar">
                            <Trash2 className="h-4 w-4" /> Eliminar lista
                        </Button>
                    )}
                    {editable && lista.estado !== "programada" && futura && (
                        <Button onClick={() => aplicar(false)} disabled={trabajando || resumen.se_aplican === 0} className="gap-2 bg-violet-600 hover:bg-violet-700">
                            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Programar para el {fecha(lista.fecha_vigencia)}
                        </Button>
                    )}
                    {editable && (
                        <Button onClick={() => aplicar(true)} disabled={trabajando || resumen.se_aplican + resumen.frenados === 0} variant={futura ? "outline" : "default"} className="gap-2">
                            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} {futura ? "Aplicar hoy igual" : "Aplicar la lista"}
                        </Button>
                    )}
                </div>
            </div>

            {avance && (
                <div className="p-3 border rounded-lg bg-muted/40 text-sm">
                    Aplicando la lista: {avance.hechos} de {avance.total} renglones. No cierres esta pantalla.
                    <div className="mt-2 h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${avance.total > 0 ? Math.round((avance.hechos / avance.total) * 100) : 0}%` }} /></div>
                </div>
            )}

            {/* En qué viene el precio y el tope de cambio */}
            <div className="p-3 border rounded-lg flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">El precio del archivo es:</span>
                    <Button size="sm" className="h-7" variant={vista.precio_por === "unidad" ? "default" : "outline"} disabled={!editable} onClick={() => cambiarPrecioPor("unidad")}>Por unidad</Button>
                    <Button size="sm" className="h-7" variant={vista.precio_por === "bulto" ? "default" : "outline"} disabled={!editable} onClick={() => cambiarPrecioPor("bulto")}>Por bulto / caja</Button>
                    <span className="text-muted-foreground">
                        {vista.precio_por === "bulto" ? "se divide por las unidades por bulto de cada artículo" : "se toma tal cual como costo por unidad"}
                        {vista.precio_por_proveedor ? "" : " · todavía no está guardado cómo manda las listas este proveedor: elegilo"}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="font-semibold">No aplicar sin confirmar cambios de más de</span>
                    <InputMonto decimales={0} soloPositivos className="h-8 w-16 rounded-md border px-2 text-sm tabular-nums" value={vista.tope_pct} disabled={!editable}
                        onChange={(n) => { if (n && n > 0 && n !== vista.tope_pct) patch({ accion: "tope", valor: n }) }} />
                    <span>%</span>
                </div>
            </div>

            {lista.estado === "aplicada" && (
                <div className="p-3 border rounded-lg bg-muted/40 text-sm">
                    Lista aplicada: {resumen.aplicados_con_cambio} artículo(s) cambiaron de costo y {resumen.aplicados_sin_cambio} ya estaban igual.
                    {vista.cambios_de_costo != null && vista.cambios_de_costo > 0 ? " No se puede eliminar: es el respaldo de esos cambios en el historial de costo." : ""}
                </div>
            )}
            {lista.estado === "programada" && (
                <div className="p-3 border border-violet-300 bg-violet-50 rounded-lg text-sm text-violet-900">
                    Esta lista está <strong>programada</strong>: se aplica sola el {fecha(lista.fecha_vigencia)}, con los mismos controles (lo que supere el tope queda por revisar, no se aplica). Hasta ese día no cambia ningún precio.
                </div>
            )}
            {resumen.frenados > 0 && editable && (
                <div className="p-3 border-2 border-orange-400 bg-orange-50 rounded-lg text-sm text-orange-900">
                    <strong>{resumen.frenados} renglón(es) no se van a aplicar sin confirmarlos uno por uno</strong>: el costo cambia más de {cant(vista.tope_pct)} %, o la lista viene por bulto y el artículo no tiene unidades por bulto. Si son muchos, lo más probable es que el precio del archivo venga {vista.precio_por === "bulto" ? "por unidad" : "por bulto"}: probá cambiarlo arriba. Filtro "No se aplican solos".
                </div>
            )}
            {resumen.con_error > 0 && (
                <div className="p-3 border-2 border-red-400 bg-red-50 rounded-lg text-sm text-red-900">
                    <strong>{resumen.con_error} renglón(es) no se pudieron aplicar.</strong> La lista no queda como aplicada hasta resolverlos: mirá el motivo en cada uno (filtro "Con error"), y tocá "Reintentar" o "No aplicar".
                </div>
            )}
            {ventaResultado.length > 0 && (
                <div className="p-3 border-2 border-amber-400 bg-amber-50 rounded-lg text-sm text-amber-900 space-y-1">
                    <p className="font-bold">Precios de venta para revisar ({ventaResultado.length})</p>
                    <p>El costo de estos artículos cambió y su precio de venta guardado NO se tocó: quedaron con otro margen que el de su ficha. Buscalos por código en <Link className="underline" href="/articulos">Artículos</Link>.</p>
                    <ul className="list-disc pl-5">
                        {ventaResultado.slice(0, 30).map((v) => (
                            <li key={v.articulo_id}>
                                <strong>{v.sku}</strong> — {v.descripcion}: precio base {moneda(v.precio_base_guardado)}; con el costo nuevo daría {moneda(v.precio_base_segun_costo)} ({v.diferencia_pct > 0 ? "+" : ""}{porcentaje(v.diferencia_pct, 1)})
                            </li>
                        ))}
                    </ul>
                    {ventaResultado.length > 30 && <p>…y {ventaResultado.length - 30} más.</p>}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Renglones</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{resumen.total}</div><div className="text-xs text-muted-foreground">{resumen.aplicados} ya aplicados</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Cambian el costo</CardTitle></CardHeader><CardContent>
                    {resumen.aplicados > 0 && resumen.se_aplican === 0 ? (
                        <><div className="text-xl font-bold">{resumen.aplicados_con_cambio}</div><div className="text-xs text-muted-foreground">cambiaron al aplicar · {resumen.aplicados_sin_cambio} ya estaban igual</div></>
                    ) : (
                        <><div className="text-xl font-bold">{resumen.con_cambio}</div><div className="text-xs text-muted-foreground">{resumen.sin_cambio} ya estaban igual{resumen.aplicados > 0 ? ` · ya aplicados: ${resumen.aplicados_con_cambio} cambiaron, ${resumen.aplicados_sin_cambio} igual` : ""}</div></>
                    )}
                </CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Subas / bajas de más de {cant(vista.umbral_pct)} %</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${resumen.subas_grandes + resumen.bajas_grandes > 0 ? "text-orange-600" : ""}`}>{resumen.subas_grandes} / {resumen.bajas_grandes}</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">No se aplican solos / por revisar</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${resumen.frenados + resumen.por_revisar > 0 ? "text-orange-600" : ""}`}>{resumen.frenados + resumen.lista_posterior} / {resumen.por_revisar}</div><div className="text-xs text-muted-foreground">{resumen.sin_articulo} sin artículo</div></CardContent></Card>
                <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Precio de venta a revisar</CardTitle></CardHeader><CardContent><div className={`text-xl font-bold ${resumen.venta_desactualizados > 0 ? "text-amber-600" : ""}`}>{resumen.venta_desactualizados}</div><div className="text-xs text-muted-foreground">{resumen.venta_cambian_solos} cambian solos</div></CardContent></Card>
            </div>

            <div className="flex gap-2 flex-wrap items-center">
                {chip("todos", "Todos", resumen.total)}
                {chip("cambian", "Cambian", resumen.con_cambio)}
                {chip("alertas", "Subas / bajas grandes", resumen.subas_grandes + resumen.bajas_grandes, "border-orange-300 text-orange-700")}
                {chip("frenados", "No se aplican solos", resumen.frenados + resumen.lista_posterior, "border-orange-300 text-orange-700")}
                {chip("venta", "Precio de venta", resumen.venta_desactualizados, "border-amber-300 text-amber-700")}
                {chip("revisar", "Por revisar", resumen.por_revisar, "border-amber-300 text-amber-700")}
                {chip("sin_articulo", "No se aplican", resumen.sin_articulo)}
                {resumen.con_error > 0 && chip("errores", "Con error", resumen.con_error, "border-red-300 text-red-700")}
                <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Avisar cambios de más de</span>
                    <InputMonto decimales={0} soloPositivos className="h-8 w-16 rounded-md border px-2 text-sm tabular-nums" value={umbral ?? vista.umbral_pct}
                        onChange={(n) => { setUmbral(n); if (n && n > 0) cargar({ filtro, umbral: n }) }} />
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
                                <TableHead className="text-right">Costo actual (por unidad)</TableHead>
                                <TableHead className="text-right">Costo nuevo (por unidad)</TableHead>
                                <TableHead className="text-right">Cambio</TableHead>
                                <TableHead>Precio de venta</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No hay renglones con ese filtro.</TableCell></TableRow>}
                            {items.map((i) => {
                                const c = i.cambio
                                const cambia = !!c && Object.keys(c.cambios).length > 0
                                const frenado = i.estado_item === "pendiente" && !!c?.frena && !i.lista_posterior
                                return (
                                    <TableRow key={i.id} className={i.estado_item === "ignorado" ? "opacity-60" : i.estado_item === "error" ? "bg-red-50" : frenado || i.lista_posterior ? "bg-orange-100/70" : c?.alerta ? "bg-orange-50/60" : ""}>
                                        <TableCell className="text-sm">
                                            <div className="font-medium">{i.codigo_proveedor ? `${i.codigo_proveedor} — ` : ""}{i.descripcion_proveedor || "(sin descripción)"}</div>
                                            <div className="text-xs text-muted-foreground">
                                                precio {i.archivo.precio_compra != null ? `${moneda(i.archivo.precio_compra)}${c && c.factor > 1 ? ` por bulto de ${cant(c.factor)} u` : ""}` : "sin dato (no se toca)"} · desc. {descuentos(i.archivo.descuentos)}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {i.articulo ? <><span className="font-mono">{i.articulo.sku}</span> — {i.articulo.descripcion}</> : i.sugerido ? (
                                                <div>
                                                    <div className="text-amber-700">¿{i.sugerido.sku} — {i.sugerido.descripcion}?</div>
                                                    {i.sugerido.otro_proveedor && <div className="text-xs font-semibold text-red-700">⚠ Artículo de otro proveedor ({i.sugerido.otro_proveedor})</div>}
                                                </div>
                                            ) : <span className="text-muted-foreground">sin artículo</span>}
                                            <div className="text-xs text-muted-foreground">{ESTADO_ITEM[i.estado_item] || i.estado_item}{i.confirmado_tope && i.estado_item === "pendiente" ? " (confirmado a mano)" : ""}{i.error ? `: ${i.error}` : ""}</div>
                                            {frenado && <div className="text-xs font-semibold text-orange-800">⚠ {c!.frena}</div>}
                                            {i.lista_posterior && i.estado_item === "pendiente" && <div className="text-xs font-semibold text-orange-800">No se aplica: ya hay una lista posterior aplicada — {i.lista_posterior}</div>}
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
                                            {editable && i.estado_item === "revisar" && !i.articulo && i.sugerido && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => accionItem(i, "confirmar")}>Es ese</Button>}
                                            {editable && i.articulo && c && (frenado || (i.estado_item === "revisar" && !!c.variacion_pct)) && c.factor >= 1 && !(c.frena || "").includes("unidades por bulto") && (
                                                <Button size="sm" variant="outline" className="h-7 mr-1 border-orange-400 text-orange-800" onClick={() => confirmarTope(i)}>Aplicar igual</Button>
                                            )}
                                            {editable && i.articulo && (i.estado_item === "error" || (i.estado_item === "revisar" && (c?.frena || "").includes("unidades por bulto"))) && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => accionItem(i, "incluir")}>Reintentar</Button>}
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
            {hayMas && (
                <div className="text-center">
                    <Button variant="outline" disabled={cargandoMas} onClick={() => { setCargandoMas(true); cargar({ filtro, umbral, pagina: Math.floor(items.length / vista.por_pagina) + 1 }) }}>
                        {cargandoMas ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Ver más ({items.length} de {vista.total_filtrados})
                    </Button>
                </div>
            )}
        </div>
    )
}
