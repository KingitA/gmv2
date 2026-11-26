"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, Loader2 } from "lucide-react"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"
import { moneda, numero } from "@/lib/formato"
import { articulosQueCoinciden, coincidencia, pedidoDe } from "@/lib/compras/coincidencia-oc"
import type { ArticuloDeLaOrden } from "@/lib/compras/vincular-renglon"

// "Vincular renglones de la factura" (maqueta docs/maquetas/vinculacion-oc14.html, aprobada por
// Juan 26/11): una fila por renglón de factura sin vincular, con el artículo de ESTA orden que
// coincide en cantidad y precio por bulto (lib/compras/coincidencia-oc.ts) ya propuesto.
// Confirmar usa el PATCH de /api/comprobantes-compra/[id]/detalle, que aprende la equivalencia
// (la próxima factura del mismo proveedor matchea sola). Los que coinciden con UN SOLO artículo
// de la orden se vinculan solos (POST accion auto_vincular, y la lectura del comprobante) y
// quedan abajo, "vinculados automáticamente", para poder cambiarlos.

/** Artículo elegido para un renglón: de la orden o del catálogo */
interface Elegido {
    id: string
    sku: string | null
    descripcion: string
    imagen_url: string | null
    marca: string | null
    unidades_por_bulto: number | null
}

const deOrden = (a: ArticuloDeLaOrden): Elegido => ({
    id: a.articulo_id, sku: a.sku, descripcion: a.descripcion, imagen_url: a.imagen_url, marca: a.marca, unidades_por_bulto: a.unidades_por_bulto ?? null,
})
const deCatalogo = (a: any): Elegido => ({
    id: a.id,
    sku: a.sku ?? null,
    descripcion: a.descripcion || "—",
    imagen_url: typeof a.imagen_url === "string" && a.imagen_url.trim() ? a.imagen_url : null,
    marca: typeof a.marca === "string" ? a.marca : a.marca?.descripcion ?? null,
    unidades_por_bulto: a.unidades_por_bulto ?? null,
})

const renglonFactura = (row: any) => ({ cantidad: Number(row.cantidad_facturada || 0), precio: Number(row.precio_unitario || 0) })
const cant = (n: number) => numero(n, 0, 4)

function Foto({ url }: { url: string | null }) {
    if (!url) return <div className="h-8 w-8 shrink-0 rounded bg-muted" />
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded object-cover bg-muted" />
}

function Marca({ marca }: { marca: string | null }) {
    if (!marca) return null
    return <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-bold uppercase text-indigo-800">{marca}</span>
}

function textoPedido(a: ArticuloDeLaOrden) {
    const { bultos, upb, unidades } = pedidoDe(a)
    return upb > 1 ? `pedido ${cant(bultos)} bul × ${cant(upb)} u` : `pedido ${cant(unidades)} u`
}

/** Elegir el artículo de un renglón: primero los de esta orden, después todo el catálogo */
function ElegirArticulo({
    row, orden, elegido, onElegir, disabled,
}: {
    row: any
    orden: ArticuloDeLaOrden[]
    elegido: Elegido | null
    onElegir: (a: Elegido) => void
    disabled?: boolean
}) {
    const [abierto, setAbierto] = useState(false)
    const enOrden = elegido ? orden.find((a) => a.articulo_id === elegido.id) : undefined
    // Los que coinciden van primero
    const coinciden = new Set(articulosQueCoinciden(renglonFactura(row), orden).map((a) => a.articulo_id))
    const lista = [...orden].sort((a, b) => Number(coinciden.has(b.articulo_id)) - Number(coinciden.has(a.articulo_id)))
    const elegir = (a: Elegido) => { onElegir(a); setAbierto(false) }

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className="flex w-full min-w-72 items-center gap-2 rounded-md border bg-background px-2 py-1 text-left hover:border-blue-300 disabled:opacity-60"
                >
                    {elegido ? (
                        <>
                            <Foto url={elegido.imagen_url} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{elegido.descripcion}<Marca marca={elegido.marca} /></div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                    SKU {elegido.sku || "—"}
                                    {enOrden ? <> · {textoPedido(enOrden)} · {moneda(Number(enOrden.precio_unitario) * pedidoDe(enOrden).upb)} el bulto</> : " · no está en la orden"}
                                </div>
                            </div>
                        </>
                    ) : (
                        <span className="flex-1 py-1.5 text-sm text-muted-foreground">Elegí el artículo…</span>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[28rem] p-0">
                {lista.length > 0 && (
                    <div className="max-h-72 overflow-y-auto">
                        <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase text-muted-foreground">De esta orden</div>
                        {lista.map((a) => (
                            <button
                                type="button"
                                key={a.articulo_id}
                                onClick={() => elegir(deOrden(a))}
                                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent ${elegido?.id === a.articulo_id ? "bg-accent" : ""}`}
                            >
                                <Foto url={a.imagen_url} />
                                <span className="min-w-0 flex-1 truncate text-sm">{a.descripcion}<Marca marca={a.marca} /></span>
                                {coinciden.has(a.articulo_id) && <span className="text-[11px] font-semibold text-green-700">coincide</span>}
                                <span className="whitespace-nowrap text-[11px] text-muted-foreground">{textoPedido(a).replace("pedido ", "")}</span>
                            </button>
                        ))}
                    </div>
                )}
                <div className="border-t p-3">
                    <div className="pb-1 text-[11px] font-bold uppercase text-muted-foreground">Otro artículo del catálogo</div>
                    <EntitySearchSelect
                        entity="articulos"
                        compact
                        value={null}
                        onSelect={(item: any) => item && elegir(deCatalogo(item))}
                        placeholder="Buscar por descripción, SKU o marca…"
                        renderItem={(item: any) => <ArticuloResultRow articulo={item} size="sm" />}
                    />
                </div>
            </PopoverContent>
        </Popover>
    )
}

function Coincide({ row, orden, elegido }: { row: any; orden: ArticuloDeLaOrden[]; elegido: Elegido | null }) {
    if (!elegido) return <span className="text-xs text-muted-foreground">Elegí el artículo</span>
    const a = orden.find((x) => x.articulo_id === elegido.id)
    const forma = a ? coincidencia(renglonFactura(row), a) : null
    if (forma) {
        return (
            <div className="whitespace-nowrap text-xs font-semibold text-green-700">
                ✓ Coincide
                <div className="font-normal text-muted-foreground">misma cantidad y precio {forma === "bulto" ? "por bulto" : "por unidad"}</div>
            </div>
        )
    }
    return (
        <div className="whitespace-nowrap text-xs font-semibold text-amber-700">
            ⚠ No coincide
            <div className="font-normal text-muted-foreground">{a ? "cantidad o precio distintos" : "no está en la orden"}</div>
        </div>
    )
}

export function RevisarMatches({
    comprobantes,
    onResolved,
}: {
    comprobantes: any[]
    onResolved?: () => void
}) {
    const [filas, setFilas] = useState<any[]>([])
    const [orden, setOrden] = useState<ArticuloDeLaOrden[]>([])
    const [loading, setLoading] = useState(false)
    const [trabajando, setTrabajando] = useState<string | null>(null)
    const [seleccion, setSeleccion] = useState<Record<string, Elegido | null>>({})
    const [error, setError] = useState<string | null>(null)
    const [porQuitar, setPorQuitar] = useState<string | null>(null)
    // El vínculo automático se pide UNA vez por comprobante (para los leídos antes de que existiera)
    const autoPedido = useRef<Set<string>>(new Set())

    // Se vuelve a pedir solo cuando cambian los comprobantes de verdad (cuáles son y en qué estado
    // están), no cada vez que la pantalla de arriba se vuelve a dibujar con una lista nueva.
    const clave = comprobantes.map((c) => `${c.id}:${c.estado}:${c.updated_at || ""}`).join("|")
    const cargar = useCallback(async () => {
        if (comprobantes.length === 0) {
            setFilas([])
            return
        }
        setLoading(true)
        try {
            const leer = async (comp: any) => {
                const res = await fetch(`/api/comprobantes-compra/${comp.id}/detalle?con_orden=1`)
                if (!res.ok) return { filas: [] as any[], orden: [] as ArticuloDeLaOrden[] }
                const data = await res.json()
                return { filas: (data.filas || []) as any[], orden: (data.orden || []) as ArticuloDeLaOrden[] }
            }
            let autoVinculados = 0
            const listas = await Promise.all(
                comprobantes.map(async (comp) => {
                    let r = await leer(comp)
                    const editable = !["validado", "cerrado"].includes(comp.estado)
                    const hayPendientes = r.filas.some((f) => !f.articulo_id && (f.match_estado === "sin_match" || f.match_estado === "sugerido"))
                    if (editable && hayPendientes && !autoPedido.current.has(comp.id)) {
                        autoPedido.current.add(comp.id)
                        const res = await fetch(`/api/comprobantes-compra/${comp.id}/detalle`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accion: "auto_vincular" }),
                        }).catch(() => null)
                        const data = res?.ok ? await res.json().catch(() => ({})) : {}
                        if (Number(data?.vinculados || 0) > 0) {
                            autoVinculados += Number(data.vinculados)
                            r = await leer(comp)
                        }
                    }
                    return { ...r, filas: r.filas.map((f) => ({ ...f, comprobante: comp, editable })) }
                })
            )
            setFilas(listas.flatMap((l) => l.filas))
            setOrden(listas.find((l) => l.orden.length > 0)?.orden || [])
            if (autoVinculados > 0) onResolved?.()
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave])

    useEffect(() => {
        cargar()
    }, [cargar])

    const pendientes = filas.filter((r) => !r.articulo_id && ["sugerido", "sin_match", "auto_oc"].includes(r.match_estado))
    const automaticos = filas.filter((r) => r.articulo_id && r.match_estado === "auto_oc" && r.editable)

    // Propuesta: el único artículo de la orden que coincide; si no, la sugerencia del matching
    // solo si es un artículo de la orden. Lo que la persona eligió manda.
    const propuesta = (row: any): Elegido | null => {
        const c = articulosQueCoinciden(renglonFactura(row), orden)
        if (c.length === 1) return deOrden(c[0])
        if (c.length === 0 && row.articulo_sugerido_id) {
            const s = orden.find((a) => a.articulo_id === row.articulo_sugerido_id)
            if (s) return deOrden(s)
        }
        return null
    }
    const elegidoDe = (row: any): Elegido | null => (row.id in seleccion ? seleccion[row.id] : propuesta(row))
    const paraConfirmar = pendientes.filter((r) => !!elegidoDe(r))

    const vincular = async (row: any, articuloId: string) => {
        const res = await fetch(`/api/comprobantes-compra/${row.comprobante.id}/detalle`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ detalle_id: row.id, articulo_id: articuloId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Error al vincular el renglón")
    }

    // Uno por uno (no a la vez): dos renglones del mismo artículo suman a la misma línea de recepción
    const confirmarTodos = async () => {
        setTrabajando("todos")
        setError(null)
        try {
            for (const row of paraConfirmar) {
                const a = elegidoDe(row)
                if (a) await vincular(row, a.id)
            }
        } catch (e: any) {
            setError(e?.message || "Error de conexión")
        } finally {
            setTrabajando(null)
            setSeleccion({})
            await cargar()
            onResolved?.()
        }
    }

    // Cambiar un vínculo automático: re-vincula (resta de la línea vieja, suma a la nueva y aprende)
    const cambiarAutomatico = async (row: any, a: Elegido) => {
        if (a.id === row.articulo_id) return
        setTrabajando(row.id)
        setError(null)
        try {
            await vincular(row, a.id)
        } catch (e: any) {
            setError(e?.message || "Error de conexión")
        } finally {
            setTrabajando(null)
            await cargar()
            onResolved?.()
        }
    }

    // Renglón que no es mercadería (flete, un cargo): se marca y queda discriminado en el
    // comprobante (no se borra; la deuda sigue siendo el total de la factura).
    // Validar el comprobante exige que no quede ninguno sin vincular (E-32).
    const quitar = async (row: any) => {
        setTrabajando(row.id)
        setError(null)
        try {
            const res = await fetch(`/api/comprobantes-compra/${row.comprobante.id}/detalle`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ detalle_id: row.id }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setError(data.error || "No se pudo marcar el renglón")
                return
            }
            setFilas((prev) => prev.filter((p) => p.id !== row.id))
            onResolved?.()
        } catch {
            setError("Error de conexión")
        } finally {
            setTrabajando(null)
            setPorQuitar(null)
        }
    }

    if (pendientes.length === 0 && automaticos.length === 0) return null
    const variosComprobantes = new Set([...pendientes, ...automaticos].map((r) => r.comprobante.id)).size > 1
    const ocupado = trabajando !== null || loading

    const celdasFactura = (row: any) => (
        <>
            <TableCell className="min-w-56 whitespace-normal">
                <div className="text-sm font-semibold">{row.descripcion_proveedor || "(sin descripción)"}</div>
                <div className="text-xs text-muted-foreground">
                    {row.codigo_proveedor ? `Cód. proveedor ${row.codigo_proveedor}` : "Sin código"}
                    {variosComprobantes && ` · ${row.comprobante.tipo_comprobante} ${row.comprobante.numero_comprobante}`}
                </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{cant(Number(row.cantidad_facturada || 0))}</TableCell>
            <TableCell className="text-right tabular-nums">{moneda(Number(row.precio_unitario || 0))}</TableCell>
            <TableCell className="px-0 text-center text-muted-foreground">→</TableCell>
        </>
    )

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
                <h3 className="text-[15px] font-semibold">Vincular renglones de la factura</h3>
                {pendientes.length > 0 ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{pendientes.length} sin vincular</span>
                ) : (
                    <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">todo vinculado</span>
                )}
                <span className="text-xs text-muted-foreground">
                    El sistema propone el artículo de la orden que coincide en cantidad y precio por bulto. Lo que confirmes queda aprendido para las próximas facturas de este proveedor.
                </span>
            </div>

            {error && (
                <Alert variant="destructive" className="m-3 w-auto">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {pendientes.length > 0 && (
                <>
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40">
                                <TableHead className="text-xs">En la factura</TableHead>
                                <TableHead className="text-right text-xs">Cant.</TableHead>
                                <TableHead className="text-right text-xs">Precio</TableHead>
                                <TableHead className="px-0" />
                                <TableHead className="text-xs">Artículo de la orden</TableHead>
                                <TableHead className="text-xs">¿Coincide?</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pendientes.map((row) => {
                                const elegido = elegidoDe(row)
                                return (
                                    <TableRow key={row.id}>
                                        {celdasFactura(row)}
                                        <TableCell className="min-w-72">
                                            <ElegirArticulo
                                                row={row}
                                                orden={orden}
                                                elegido={elegido}
                                                disabled={ocupado}
                                                onElegir={(a) => setSeleccion((prev) => ({ ...prev, [row.id]: a }))}
                                            />
                                        </TableCell>
                                        <TableCell><Coincide row={row} orden={orden} elegido={elegido} /></TableCell>
                                        <TableCell className="text-right">
                                            {porQuitar === row.id ? (
                                                <span className="inline-flex items-center gap-1">
                                                    <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={ocupado} onClick={() => quitar(row)}>
                                                        Sí, no es mercadería
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPorQuitar(null)}>No</Button>
                                                </span>
                                            ) : (
                                                <Button size="sm" variant="link" className="h-7 px-1 text-xs text-red-700" disabled={ocupado} onClick={() => setPorQuitar(row.id)}>
                                                    No es mercadería
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span className="text-xs text-muted-foreground">¿Un renglón es flete o un cargo? Tocá “No es mercadería” en esa línea.</span>
                        <Button size="sm" disabled={ocupado || paraConfirmar.length === 0} onClick={confirmarTodos}>
                            {trabajando === "todos" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                            Confirmar {paraConfirmar.length === 1 ? "1" : `los ${paraConfirmar.length}`}
                        </Button>
                    </div>
                </>
            )}

            {automaticos.length > 0 && (
                <Collapsible className="border-t">
                    <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40">
                        <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
                        <span className="font-semibold text-green-700">
                            {automaticos.length === 1 ? "1 renglón vinculado automático" : `${automaticos.length} renglones vinculados automáticos`}
                        </span>
                        <span>· coincidían con un solo artículo de la orden. Si alguno está mal, cambialo.</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Table>
                            <TableBody>
                                {automaticos.map((row) => {
                                    const a = orden.find((x) => x.articulo_id === row.articulo_id)
                                    const elegido: Elegido | null = a
                                        ? deOrden(a)
                                        : row.articulo ? deCatalogo(row.articulo) : null
                                    return (
                                        <TableRow key={row.id}>
                                            {celdasFactura(row)}
                                            <TableCell className="min-w-72">
                                                <ElegirArticulo
                                                    row={row}
                                                    orden={orden}
                                                    elegido={elegido}
                                                    disabled={ocupado}
                                                    onElegir={(nuevo) => cambiarAutomatico(row, nuevo)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                {trabajando === row.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                ) : (
                                                    <span className="whitespace-nowrap rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-700">
                                                        vinculado automático
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell />
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </CollapsibleContent>
                </Collapsible>
            )}
        </Card>
    )
}
