"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { InputMonto } from "@/components/ui/input-monto"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Scale } from "lucide-react"
import { toast } from "sonner"
import { moneda } from "@/lib/formato"
import { cant } from "@/lib/deposito/unidades"
import { reclamablePorDevolucion, type Importe } from "@/lib/compras/diferencias"
import type { FilaVerificacion } from "@/lib/compras/verificacion"

// Ventana "Resolver diferencia" (E-94, E-44, E-43).
// Abre en lo que la línea tiene sin resolver (precio, cantidad o las dos, en una sola pasada),
// muestra pedido / recibido / facturado con precios NETOS, el importe con IVA y, antes de
// confirmar, qué va a pasar con el stock, el costo y la cuenta corriente. La cuenta es la del
// servidor (viene en la fila); acá solo se elige a quién se imputa.

type DestinoPrecio = "empresa" | "proveedor" | "descuento_fuera_factura"
type DestinoCantidad = "empresa" | "proveedor" | "transporte" | "devolver"

const pesos = (i: Importe) => `${moneda(i.total)} (${moneda(i.neto)} neto + ${moneda(i.iva)} de IVA)`

function Opcion({ activa, onClick, titulo, detalle }: { activa: boolean; onClick: () => void; titulo: string; detalle: string }) {
    return (
        <button type="button" onClick={onClick}
            className={`text-left p-3 rounded-lg border-2 transition-colors ${activa ? "border-primary bg-muted" : "border-muted hover:border-muted-foreground/30"}`}>
            <div className="font-semibold text-sm">{titulo}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{detalle}</div>
        </button>
    )
}

export function ResolverDiferencia({ fila, filasOC, transportes, ordenId, onCerrar, onHecho }: {
    fila: FilaVerificacion
    /** Artículos de la orden, para "en realidad era este otro artículo" */
    filasOC: FilaVerificacion[]
    transportes: Array<{ id: string; nombre: string }>
    ordenId: string
    onCerrar: () => void
    onHecho: () => void
}) {
    const { dif } = fila
    const conPrecio = fila.banderas.includes("precio") && !!dif.precio
    const conCantidad = fila.banderas.includes("cantidad") && !!dif.cantidad
    const noPedido = fila.banderas.includes("no_pedido")
    const pendiente = fila.banderas.includes("pendiente")
    const sobrante = conCantidad && dif.cantidad!.tipo === "sobrante"

    const [destinoPrecio, setDestinoPrecio] = useState<DestinoPrecio | "">("")
    const [destinoCantidad, setDestinoCantidad] = useState<DestinoCantidad | "">("")
    const [transporte, setTransporte] = useState(transportes[0]?.id || "")
    const [rechazo, setRechazo] = useState<number | null>(null) // unidades que entraron y se devuelven, además del faltante
    const [descripcion, setDescripcion] = useState("")
    const [guardando, setGuardando] = useState(false)

    // "No era ese artículo, era este" — re-vincula líneas y aprende la equivalencia
    const [vincularDestino, setVincularDestino] = useState("")
    const [vincularEan, setVincularEan] = useState("")
    const [vincularDesc, setVincularDesc] = useState("")
    const [vincularBulto, setVincularBulto] = useState("")
    const [vincularAprender, setVincularAprender] = useState(true)

    // Unidades que salen del stock según lo elegido
    const devolver = useMemo(() => {
        if (destinoCantidad === "devolver") return noPedido ? dif.recibido_unidades : sobrante ? dif.cantidad!.unidades : 0
        if (destinoCantidad === "proveedor" && rechazo && rechazo > 0) return Math.min(rechazo, dif.recibido_unidades)
        return 0
    }, [destinoCantidad, rechazo, noPedido, sobrante, dif])
    const reclamoDevolucion = devolver > 0 ? reclamablePorDevolucion(dif, devolver) : null

    // ── Vista previa: qué va a pasar ──
    const previa: string[] = []
    if (conPrecio && destinoPrecio) {
        const p = dif.precio!
        if (destinoPrecio === "empresa") {
            previa.push(`Costo del artículo: pasa a ser el de la factura (lista ${moneda(dif.factura!.lista_unidad)}${dif.factura!.descuentos.some((d) => d > 0) ? ` con ${dif.factura!.descuentos.filter((d) => d > 0).map((d) => `${cant(d)} %`).join(" + ")} de descuento` : ""} = ${moneda(dif.factura!.neto_unidad)} neto por unidad).`)
            previa.push("Cuenta corriente del proveedor: sin cambios (se paga lo facturado).")
        } else {
            previa.push(`Queda una nota de crédito ESPERADA del proveedor por ${pesos(p)}${destinoPrecio === "descuento_fuera_factura" ? ", por descuento que llega fuera de la factura" : ""}.`)
            previa.push("Cuenta corriente del proveedor: no cambia hasta que llegue la nota de crédito. Costo del artículo: no cambia.")
        }
    }
    if ((conCantidad || noPedido) && destinoCantidad) {
        if (destinoCantidad === "empresa") {
            previa.push(noPedido ? "El artículo queda aceptado como recibido (no estaba en la orden)." : sobrante ? "El sobrante queda aceptado: la mercadería se queda en el stock." : "La empresa asume el faltante: no se reclama nada.")
            previa.push("Stock y cuenta corriente: sin cambios.")
        } else if (destinoCantidad === "transporte") {
            previa.push(`Se le cargan ${pesos(dif.cantidad!)} al transporte en su cuenta corriente.`)
            previa.push("Stock: sin cambios (solo entró lo que se contó).")
        } else if (destinoCantidad === "proveedor") {
            const imp = reclamoDevolucion && devolver > 0 ? reclamoDevolucion : dif.cantidad!
            previa.push(`Queda una nota de crédito ESPERADA del proveedor por ${pesos(imp)}.`)
            previa.push(devolver > 0
                ? `Stock: BAJA ${cant(devolver)} u (mercadería que entró y se devuelve). El faltante no toca el stock.`
                : "Stock: sin cambios (el faltante nunca entró). Cuenta corriente: no cambia hasta que llegue la nota de crédito.")
        } else if (destinoCantidad === "devolver") {
            previa.push(`Stock: BAJA ${cant(devolver)} u (se devuelve al proveedor).`)
            previa.push(reclamoDevolucion && reclamoDevolucion.total > 0
                ? `Queda una nota de crédito ESPERADA por ${pesos(reclamoDevolucion)} (estaba facturado).`
                : "No estaba facturado: no se genera nota de crédito.")
        }
    }

    // Con dos diferencias se pueden resolver las dos juntas o una sola ahora
    const faltaElegir = !destinoPrecio && !destinoCantidad && !vincularDestino
    const faltaTransporte = destinoCantidad === "transporte" && !transporte
    const hayAlgoParaResolver = conPrecio || conCantidad || noPedido

    async function confirmar() {
        setGuardando(true)
        try {
            // Era otro artículo: se re-vincula y listo (no hay nada más que imputar)
            if (noPedido && vincularDestino) {
                const res = await fetch(`/api/ordenes-compra/${ordenId}/vincular-articulo`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        articulo_origen_id: fila.articulo_id,
                        articulo_destino_id: vincularDestino,
                        aprender: vincularAprender,
                        nuevo_ean: vincularEan || null,
                        nueva_descripcion: vincularDesc || null,
                        unidades_por_bulto: vincularBulto ? parseInt(vincularBulto) : null,
                    }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) { toast.error(data.error || "No se pudo vincular"); return }
                toast.success(`Vinculado: ${data.lineas_comprobante} renglón(es) de comprobante y ${data.items_recepcion} de recepción${data.equivalencia_aprendida ? " · equivalencia aprendida" : ""}`)
                onHecho()
                return
            }

            if (!fila.recepcion_item_id || !fila.recepcion_id) {
                toast.error("Este artículo no tiene línea en la recepción: no hay sobre qué resolver.")
                return
            }
            const decisions: any[] = []
            if (conPrecio && destinoPrecio) decisions.push({ item_id: fila.recepcion_item_id, tipo: "precio", destino: destinoPrecio, descripcion: descripcion || undefined })
            if ((conCantidad || noPedido) && destinoCantidad) {
                // "devolver": al proveedor con nota de crédito si estaba facturado; si no, solo sale del stock
                const destino = destinoCantidad === "devolver" ? (reclamoDevolucion && reclamoDevolucion.total > 0 ? "proveedor" : "empresa") : destinoCantidad
                decisions.push({
                    item_id: fila.recepcion_item_id, tipo: "cantidad", destino,
                    transporte_id: destinoCantidad === "transporte" ? transporte : undefined,
                    devolver_unidades: devolver > 0 ? devolver : undefined,
                    descripcion: descripcion || undefined,
                })
            }
            if (decisions.length === 0) return

            const res = await fetch(`/api/recepciones/${fila.recepcion_id}/cerrar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decisions }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok && !data.results) { toast.error(`No se resolvió: ${data.error || `error ${res.status}`}`, { duration: 12000 }); return }
            const resultados: any[] = data.results || []
            for (const r of resultados) {
                if (r.error) toast.error(r.error, { duration: 15000 })
                else if (r.mensaje) (r.ya_resuelta ? toast.warning : toast.success)(r.mensaje, { duration: 10000 })
            }
            // Aunque una de las dos falle, lo que sí se resolvió ya está: se refresca
            if (resultados.some((r) => !r.error)) onHecho()
        } finally {
            setGuardando(false)
        }
    }

    const celda = "px-2 py-1 text-right font-mono"
    return (
        <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Scale className="h-5 w-5 text-orange-500" /> Resolver diferencia
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="p-3 bg-muted rounded-lg text-sm">
                        <p className="font-semibold">{fila.descripcion}</p>
                        <p className="text-muted-foreground font-mono text-xs">{fila.sku}</p>
                        <table className="mt-2 w-full text-xs">
                            <thead>
                                <tr className="text-muted-foreground">
                                    <th className="text-left font-normal px-2 py-1"></th>
                                    <th className="text-right font-normal px-2 py-1">Unidades</th>
                                    <th className="text-right font-normal px-2 py-1">Precio neto por unidad</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td className="px-2 py-1">Orden de compra</td><td className={celda}>{dif.oc ? cant(dif.oc.unidades) : "no pedido"}</td><td className={celda}>{dif.oc ? moneda(dif.oc.neto_unidad) : "—"}</td></tr>
                                <tr><td className="px-2 py-1">Recibido en depósito</td><td className={celda}>{cant(dif.recibido_unidades)}</td><td className={celda}>—</td></tr>
                                <tr><td className="px-2 py-1">Facturado</td><td className={celda}>{dif.factura ? cant(dif.factura.unidades) : "sin factura"}{dif.factura && dif.factura.bonificadas > 0 ? ` (${cant(dif.factura.bonificadas)} sin cargo)` : ""}</td><td className={celda}>{dif.factura && dif.factura.neto_unidad > 0 ? moneda(dif.factura.neto_unidad) : "—"}</td></tr>
                            </tbody>
                        </table>
                    </div>

                    {conPrecio && (
                        <div className="space-y-2">
                            <Label>Diferencia de PRECIO: {moneda(dif.precio!.por_unidad)} por unidad × {cant(dif.precio!.unidades)} u = <strong>{pesos(dif.precio!)}</strong></Label>
                            <p className="text-xs text-muted-foreground">
                                {dif.precio!.a_favor === "nuestro" ? "La factura vino más cara que lo acordado en la orden." : "La factura vino MÁS BARATA que la orden: no hay nada para reclamar."}
                            </p>
                            <div className="grid gap-2">
                                <Opcion activa={destinoPrecio === "empresa"} onClick={() => setDestinoPrecio("empresa")}
                                    titulo="Aceptar el precio facturado" detalle="El costo del artículo pasa a ser el de la factura. No se reclama nada." />
                                {dif.precio!.a_favor === "nuestro" && <>
                                    <Opcion activa={destinoPrecio === "proveedor"} onClick={() => setDestinoPrecio("proveedor")}
                                        titulo="Reclamar al proveedor" detalle="Queda una nota de crédito esperada por la diferencia. El costo no cambia." />
                                    <Opcion activa={destinoPrecio === "descuento_fuera_factura"} onClick={() => setDestinoPrecio("descuento_fuera_factura")}
                                        titulo="Descuento fuera de factura" detalle="El proveedor factura sin el descuento y manda la nota de crédito a fin de mes o trimestre. Queda como nota de crédito esperada." />
                                </>}
                            </div>
                        </div>
                    )}

                    {conCantidad && !sobrante && (
                        <div className="space-y-2">
                            <Label>FALTANTE: se facturaron {cant(dif.cantidad!.unidades)} u que no llegaron = <strong>{pesos(dif.cantidad!)}</strong></Label>
                            <div className="grid gap-2">
                                <Opcion activa={destinoCantidad === "proveedor"} onClick={() => setDestinoCantidad("proveedor")}
                                    titulo="Reclamar al proveedor" detalle="Nota de crédito esperada por lo facturado y no recibido. No toca el stock." />
                                <Opcion activa={destinoCantidad === "transporte"} onClick={() => setDestinoCantidad("transporte")}
                                    titulo="Cargar al transporte" detalle="Se le carga el importe en su cuenta corriente. No toca el stock." />
                                <Opcion activa={destinoCantidad === "empresa"} onClick={() => setDestinoCantidad("empresa")}
                                    titulo="La empresa lo asume" detalle="Se da por perdido. Sin movimientos." />
                            </div>
                            {destinoCantidad === "transporte" && (
                                <div className="space-y-1">
                                    <Label className="text-xs">Transporte responsable</Label>
                                    <Select value={transporte} onValueChange={setTransporte}>
                                        <SelectTrigger><SelectValue placeholder="Elegir transporte…" /></SelectTrigger>
                                        <SelectContent>{transportes.map((t) => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}</SelectContent>
                                    </Select>
                                    {transportes.length === 0 && <p className="text-xs text-red-600">No hay transportes activos cargados.</p>}
                                </div>
                            )}
                            {destinoCantidad === "proveedor" && dif.recibido_unidades > 0 && (
                                <div className="space-y-1 border rounded-md p-2">
                                    <Label className="text-xs">Además, ¿se DEVUELVE mercadería que sí entró? (rota, vencida, equivocada)</Label>
                                    <div className="flex items-center gap-2">
                                        <InputMonto decimales={2} soloPositivos className="w-32" value={rechazo} onChange={setRechazo} />
                                        <span className="text-xs text-muted-foreground">unidades (de las {cant(dif.recibido_unidades)} recibidas). Vacío = no se devuelve nada. Esas unidades SÍ salen del stock.</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {sobrante && (
                        <div className="space-y-2">
                            <Label>SOBRANTE: llegaron {cant(dif.cantidad!.unidades)} u más de las facturadas</Label>
                            <div className="grid gap-2">
                                <Opcion activa={destinoCantidad === "empresa"} onClick={() => setDestinoCantidad("empresa")}
                                    titulo="Aceptar el sobrante" detalle="Se queda en el stock. Si el proveedor lo factura después, se carga esa factura como un comprobante más." />
                                <Opcion activa={destinoCantidad === "devolver"} onClick={() => setDestinoCantidad("devolver")}
                                    titulo="Devolver el sobrante" detalle={`Salen ${cant(dif.cantidad!.unidades)} u del stock. No estaba facturado: sin nota de crédito.`} />
                            </div>
                        </div>
                    )}

                    {noPedido && !conCantidad && (
                        <div className="space-y-2">
                            <Label>NO PEDIDO: este artículo llegó o se facturó y no estaba en la orden</Label>
                            <div className="grid gap-2">
                                <Opcion activa={destinoCantidad === "empresa" && !vincularDestino} onClick={() => { setDestinoCantidad("empresa"); setVincularDestino("") }}
                                    titulo="Aceptarlo" detalle={dif.factura ? `Se queda en el stock, al precio facturado (${moneda(dif.factura.neto_unidad)} neto por unidad).` : "Se queda en el stock. Todavía no está facturado."} />
                                {dif.recibido_unidades > 0 && (
                                    <Opcion activa={destinoCantidad === "devolver" && !vincularDestino} onClick={() => { setDestinoCantidad("devolver"); setVincularDestino("") }}
                                        titulo="Devolverlo" detalle={`Salen ${cant(dif.recibido_unidades)} u del stock${dif.factura ? " y queda una nota de crédito esperada por lo facturado" : ""}.`} />
                                )}
                            </div>
                            <div className="border rounded-md p-3 space-y-2">
                                <Label className="text-xs">O en realidad era OTRO artículo de la orden (duplicado en la base, o el proveedor cambió el código):</Label>
                                <Select value={vincularDestino || "ninguno"} onValueChange={(v) => { setVincularDestino(v === "ninguno" ? "" : v); if (v !== "ninguno") setDestinoCantidad("") }}>
                                    <SelectTrigger><SelectValue placeholder="Elegir el artículo correcto…" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ninguno">— no, es este —</SelectItem>
                                        {filasOC.filter((r) => r.articulo_id !== fila.articulo_id).map((r) => (
                                            <SelectItem key={r.articulo_id} value={r.articulo_id}>{r.sku} — {r.descripcion} (pedido: {cant(r.dif.oc?.unidades ?? 0)} u)</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {vincularDestino && (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div><Label className="text-xs">Actualizar EAN13 (opcional)</Label><Input value={vincularEan} onChange={(e) => setVincularEan(e.target.value)} placeholder="nuevo código de barras" /></div>
                                            <div><Label className="text-xs">Unidades por bulto (opcional)</Label><Input inputMode="numeric" value={vincularBulto} onChange={(e) => setVincularBulto(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ej. 12" /></div>
                                            <div className="col-span-2"><Label className="text-xs">Actualizar descripción (opcional)</Label><Input value={vincularDesc} onChange={(e) => setVincularDesc(e.target.value)} placeholder="dejar vacío para no tocarla" /></div>
                                        </div>
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input type="checkbox" className="h-4 w-4" checked={vincularAprender} onChange={(e) => setVincularAprender(e.target.checked)} />
                                            Aprender la equivalencia (los próximos comprobantes del proveedor se vinculan solos)
                                        </label>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {pendiente && (
                        <div className="p-3 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-900">
                            <strong>Faltan recibir {cant(dif.pendiente_oc)} u</strong> de lo pedido (no llegaron y no se facturaron). No hay plata en juego:
                            el depósito las puede recibir en otra entrega sobre esta misma orden; si no van a llegar, la orden se cierra sin el resto al
                            finalizarla, o se vuelven a pedir con "Generar OC con faltantes".
                        </div>
                    )}

                    {hayAlgoParaResolver && (
                        <div className="space-y-1">
                            <Label className="text-xs">Observaciones (opcional)</Label>
                            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle para el reclamo…" />
                        </div>
                    )}

                    {previa.length > 0 && (
                        <div className="p-3 border border-sky-300 bg-sky-50 rounded-lg text-sm text-sky-900">
                            <p className="font-semibold mb-1">Qué va a pasar al confirmar</p>
                            <ul className="list-disc pl-5 space-y-0.5">{previa.map((p, i) => <li key={i}>{p}</li>)}</ul>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCerrar}>{hayAlgoParaResolver ? "Cancelar" : "Cerrar"}</Button>
                    {hayAlgoParaResolver && (
                        <Button onClick={confirmar} disabled={guardando || faltaElegir || faltaTransporte}>
                            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : vincularDestino ? "Vincular artículo" : "Confirmar"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
