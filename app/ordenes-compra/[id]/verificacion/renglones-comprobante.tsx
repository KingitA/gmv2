"use client"

// Renglones de un comprobante de compra: verlos, agregar uno a mano, corregirlo o borrarlo.
// Prueba en producción del 18/11:
//   · "agregar un renglón" tomaba la cantidad en la unidad de la orden (bultos) sin decirlo:
//     ahora se ELIGE la unidad y se ve a cuántas unidades equivale y el importe antes de guardar;
//   · no se podía corregir ni borrar un renglón: había que borrar el comprobante entero.
// La cuenta que se muestra es la misma que hace el servidor (lib/compras/renglon-manual.ts).

import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { InputMonto } from "@/components/ui/input-monto"
import { useConfirmar } from "@/components/ui/confirmar"
import { Edit, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { moneda } from "@/lib/formato"
import { cant } from "@/lib/deposito/unidades"
import { cuentaRenglon, faltaEnRenglon, type UnidadRenglon } from "@/lib/compras/renglon-manual"

interface Linea {
    id: string; articulo_id: string | null; sku: string | null; descripcion: string | null; descripcion_proveedor: string | null
    unidades_por_bulto: number | null; cantidad: number; unidad: UnidadRenglon; precio_unitario: number; descuentos: number[]
    match_estado: string | null; importe: number
}
interface ArticuloOC {
    articulo_id: string; sku: string | null; descripcion: string | null; unidades_por_bulto: number | null
    cantidad_pedida: number; tipo_cantidad: string; precio_unitario: number; descuentos: number[]
}
interface Datos { editable: boolean; tipo_descuento: string; articulos_oc: ArticuloOC[]; lineas: Linea[] }

interface Form {
    /** null = renglón nuevo */
    linea_id: string | null
    articulo_id: string
    cantidad: number | null
    unidad: UnidadRenglon | ""
    precio: number | null
    d1: number | null; d2: number | null; d3: number | null; d4: number | null
}
const formVacio = (): Form => ({ linea_id: null, articulo_id: "", cantidad: null, unidad: "", precio: null, d1: null, d2: null, d3: null, d4: null })

const ESTADO: Record<string, string> = { manual: "a mano", auto: "leído", sugerido: "sin confirmar", sin_match: "sin artículo", no_mercaderia: "no es mercadería" }

export function RenglonesComprobante({ comprobante, soloLectura, abrirEnAgregar, onCerrar, onCambio }: {
    comprobante: { id: string; tipo_comprobante: string; numero_comprobante: string } | null
    soloLectura?: boolean
    /** Abrir directamente con el formulario de "agregar renglón" */
    abrirEnAgregar?: boolean
    onCerrar: () => void
    onCambio: () => void
}) {
    const { confirmar, dialogo } = useConfirmar()
    const [datos, setDatos] = useState<Datos | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [form, setForm] = useState<Form | null>(null)
    const [guardando, setGuardando] = useState(false)
    const id = comprobante?.id

    const cargar = useCallback(async () => {
        if (!id) return
        setError(null)
        try {
            const res = await fetch(`/api/comprobantes-compra/${id}/lineas`)
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { setError(data.error || `No se pudieron cargar los renglones (error ${res.status})`); return }
            setDatos(data)
        } catch {
            setError("No se pudieron cargar los renglones: sin conexión.")
        }
    }, [id])

    useEffect(() => {
        setDatos(null)
        setForm(id && abrirEnAgregar ? formVacio() : null)
        cargar()
    }, [id, abrirEnAgregar, cargar])

    if (!comprobante) return null
    const editable = !!datos?.editable && !soloLectura

    // Unidades por bulto del artículo del formulario (de la orden, o del renglón que se corrige)
    const lineaEditada = form?.linea_id ? datos?.lineas.find((l) => l.id === form.linea_id) : null
    const artOC = form ? datos?.articulos_oc.find((a) => a.articulo_id === form.articulo_id) : null
    const upb = lineaEditada?.unidades_por_bulto ?? artOC?.unidades_por_bulto ?? null
    const hayBulto = Number(upb || 0) > 1
    const renglon = form && form.unidad ? { cantidad: form.cantidad ?? 0, unidad: form.unidad, precio_unitario: form.precio ?? 0, descuentos: [form.d1 ?? 0, form.d2 ?? 0, form.d3 ?? 0, form.d4 ?? 0] } : null
    const falta = form ? (!form.linea_id && !form.articulo_id ? "Elegí el artículo." : faltaEnRenglon(renglon ?? { cantidad: form.cantidad ?? 0 }, upb)) : null
    const cuenta = renglon && !falta ? cuentaRenglon(renglon, upb, datos?.tipo_descuento) : null

    const editar = (l: Linea) => setForm({
        linea_id: l.id, articulo_id: l.articulo_id || "", cantidad: l.cantidad, unidad: l.unidad, precio: l.precio_unitario,
        d1: l.descuentos[0] || null, d2: l.descuentos[1] || null, d3: l.descuentos[2] || null, d4: l.descuentos[3] || null,
    })

    const guardar = async () => {
        if (!form || !renglon || falta) { toast.error(falta || "Completá el renglón"); return }
        setGuardando(true)
        try {
            const res = await fetch(`/api/comprobantes-compra/${comprobante.id}/lineas`, {
                method: form.linea_id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    linea_id: form.linea_id, articulo_id: form.articulo_id, cantidad: renglon.cantidad, unidad: renglon.unidad, precio_unitario: renglon.precio_unitario,
                    descuento1: renglon.descuentos[0], descuento2: renglon.descuentos[1], descuento3: renglon.descuentos[2], descuento4: renglon.descuentos[3],
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || "No se pudo guardar el renglón", { duration: 10000 }); return }
            toast.success(form.linea_id ? "Renglón corregido" : "Renglón agregado")
            setForm(null)
            await cargar()
            onCambio()
        } finally {
            setGuardando(false)
        }
    }

    const borrar = async (l: Linea) => {
        const ok = await confirmar({
            titulo: "¿Borrar este renglón?",
            detalle: `${l.sku ? `${l.sku} — ` : ""}${l.descripcion || "(sin descripción)"}: ${cant(l.cantidad)} ${l.unidad === "bulto" ? "bulto(s)" : "unidad(es)"} por ${moneda(l.importe)}.\n\nSe saca del comprobante y se descuenta de lo documentado en la recepción. Queda anotado quién lo borró.`,
            confirmar: "Borrar renglón", peligro: true,
        })
        if (!ok) return
        const res = await fetch(`/api/comprobantes-compra/${comprobante.id}/lineas`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linea_id: l.id }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo borrar el renglón", { duration: 10000 }); return }
        toast.success("Renglón borrado")
        await cargar()
        onCambio()
    }

    const total = (datos?.lineas || []).reduce((s, l) => s + l.importe, 0)
    const campo = "h-auto w-full rounded-md border px-2 py-1.5 text-sm tabular-nums"

    return (
        <Dialog open onOpenChange={(abierto) => { if (!abierto) onCerrar() }}>
            {dialogo}
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Renglones — {comprobante.tipo_comprobante} {comprobante.numero_comprobante}</DialogTitle>
                </DialogHeader>

                {error && <p className="text-sm text-red-700">{error}</p>}
                {!datos && !error && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando renglones…</p>}

                {datos && (
                    <>
                        <div className="border rounded-md overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                    <tr>
                                        <th className="text-left px-2 py-1.5">Artículo</th>
                                        <th className="text-right px-2 py-1.5">Cantidad</th>
                                        <th className="text-right px-2 py-1.5">Precio lista</th>
                                        <th className="text-right px-2 py-1.5">Desc.</th>
                                        <th className="text-right px-2 py-1.5">Importe</th>
                                        <th className="px-2 py-1.5" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {datos.lineas.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">Este comprobante no tiene renglones.</td></tr>}
                                    {datos.lineas.map((l) => (
                                        <tr key={l.id} className="border-t">
                                            <td className="px-2 py-1.5">
                                                <div className="font-medium">{l.sku ? `${l.sku} — ` : ""}{l.descripcion || "(sin descripción)"}</div>
                                                <div className="text-xs text-muted-foreground">{ESTADO[l.match_estado || ""] || l.match_estado || ""}</div>
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                                {cant(l.cantidad)} {l.unidad === "bulto" ? "bulto(s)" : "u"}
                                                {l.unidad === "bulto" && Number(l.unidades_por_bulto || 0) > 1 && <div className="text-xs text-muted-foreground">= {cant(l.cantidad * Number(l.unidades_por_bulto))} u</div>}
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{moneda(l.precio_unitario)}{l.unidad === "bulto" ? <span className="text-xs text-muted-foreground"> /bulto</span> : null}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{l.descuentos.filter((d) => d > 0).map((d) => `${cant(d)} %`).join(" + ") || "—"}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">{moneda(l.importe)}</td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                                {editable && (
                                                    <>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Corregir este renglón" onClick={() => editar(l)}><Edit className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Borrar este renglón" onClick={() => borrar(l)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                {datos.lineas.length > 0 && (
                                    <tfoot>
                                        <tr className="border-t bg-muted/30">
                                            <td colSpan={4} className="px-2 py-1.5 text-right text-xs text-muted-foreground">Suma de los renglones (neto)</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums font-bold">{moneda(total)}</td>
                                            <td />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        {!editable && <p className="text-xs text-muted-foreground">{soloLectura ? "La orden está cerrada: los renglones se pueden mirar, no cambiar." : "El comprobante ya está validado: los renglones no se pueden cambiar."}</p>}

                        {editable && !form && (
                            <div><Button variant="outline" size="sm" onClick={() => setForm(formVacio())}><Plus className="h-4 w-4 mr-1" /> Agregar un renglón</Button></div>
                        )}

                        {editable && form && (
                            <div className="border-2 border-blue-200 rounded-lg p-3 space-y-3 bg-blue-50/40">
                                <p className="text-sm font-semibold">{form.linea_id ? "Corregir renglón" : "Agregar un renglón"} <span className="font-normal text-muted-foreground">— cargalo como figura en el comprobante</span></p>

                                {form.linea_id ? (
                                    <p className="text-sm">{lineaEditada?.sku ? `${lineaEditada.sku} — ` : ""}{lineaEditada?.descripcion || "(sin descripción)"}</p>
                                ) : (
                                    <div>
                                        <label className="text-xs font-medium">Artículo (de la orden)</label>
                                        <select className="w-full rounded-md border px-2 py-1.5 text-sm bg-white" value={form.articulo_id}
                                            onChange={(e) => setForm({ ...form, articulo_id: e.target.value, unidad: "" })}>
                                            <option value="">Elegir artículo…</option>
                                            {datos.articulos_oc.map((a) => <option key={a.articulo_id} value={a.articulo_id}>{a.sku} — {a.descripcion}</option>)}
                                        </select>
                                        {artOC && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                En la orden: {cant(artOC.cantidad_pedida)} {artOC.tipo_cantidad === "unidad" ? "unidad(es)" : `bulto(s)${Number(artOC.unidades_por_bulto || 0) > 1 ? ` de ${cant(artOC.unidades_por_bulto)} u` : ""}`} a {moneda(artOC.precio_unitario)} de lista por unidad
                                                {artOC.descuentos.some((d) => d > 0) ? ` con ${artOC.descuentos.filter((d) => d > 0).map((d) => `${cant(d)} %`).join(" + ")}` : ""}. (Es solo una referencia: no se copia.)
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div>
                                    <label className="text-xs font-medium">¿En qué está la cantidad y el precio?</label>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        <Button type="button" size="sm" variant={form.unidad === "unidad" ? "default" : "outline"} onClick={() => setForm({ ...form, unidad: "unidad" })}>Unidades</Button>
                                        <Button type="button" size="sm" variant={form.unidad === "bulto" ? "default" : "outline"} disabled={!hayBulto} onClick={() => setForm({ ...form, unidad: "bulto" })}>
                                            {hayBulto ? `Bultos de ${cant(upb)} u` : "Bultos (el artículo no tiene unidades por bulto)"}
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs font-medium">Cantidad {form.unidad === "bulto" ? "(bultos)" : form.unidad === "unidad" ? "(unidades)" : ""}</label>
                                        <InputMonto decimales={3} soloPositivos className={campo} value={form.cantidad} onChange={(n) => setForm({ ...form, cantidad: n })} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium">Precio de lista {form.unidad === "bulto" ? "por bulto" : form.unidad === "unidad" ? "por unidad" : ""} (sin descuentos, sin IVA)</label>
                                        <InputMonto decimales={4} soloPositivos className={campo} value={form.precio} onChange={(n) => setForm({ ...form, precio: n })} />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium">Descuentos del renglón, en % ({datos.tipo_descuento === "sobre_lista" ? "se suman y se aplican sobre la lista" : "en cascada, uno sobre el otro"}). Si el comprobante trae el precio ya neto, dejalos vacíos.</label>
                                    <div className="grid grid-cols-4 gap-2 mt-1">
                                        {(["d1", "d2", "d3", "d4"] as const).map((k, i) => (
                                            <InputMonto key={k} decimales={2} soloPositivos placeholder={`D${i + 1}`} className={campo} value={form[k]} onChange={(n) => setForm({ ...form, [k]: n })} />
                                        ))}
                                    </div>
                                </div>

                                <div className={`rounded-md p-2 text-sm ${cuenta ? "bg-white border" : "bg-amber-50 border border-amber-200 text-amber-900"}`}>
                                    {cuenta ? (
                                        <>
                                            <div>
                                                {cant(renglon!.cantidad)} {renglon!.unidad === "bulto" ? `bulto(s) de ${cant(upb)} u = ` : "unidad(es)"}
                                                {renglon!.unidad === "bulto" && <strong>{cant(cuenta.unidades)} unidades</strong>}
                                                {" · "}neto {moneda(cuenta.neto)} {renglon!.unidad === "bulto" ? `por bulto (${moneda(cuenta.neto_por_unidad)} por unidad)` : "por unidad"}
                                            </div>
                                            <div className="text-base">Importe del renglón: <strong>{moneda(cuenta.importe)}</strong> <span className="text-xs text-muted-foreground">(neto, sin IVA)</span></div>
                                        </>
                                    ) : (falta || "Completá el renglón para ver el importe.")}
                                </div>

                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setForm(null)}>Cancelar</Button>
                                    <Button size="sm" disabled={guardando || !cuenta} onClick={guardar}>{guardando ? "Guardando…" : form.linea_id ? "Guardar corrección" : "Agregar renglón"}</Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
