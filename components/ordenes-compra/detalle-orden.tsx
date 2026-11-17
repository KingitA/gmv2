"use client"

// La orden de compra de un vistazo (E-09, E-12): qué se pide, cuánto, a qué precio, cuándo llega,
// cómo y cuándo se paga, si se le mandó al proveedor, y qué se puede hacer con ella.

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, FileSpreadsheet, FileText, Loader2, Pencil, Send, Truck } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { entero, fecha, fechaHora, moneda, numero, porcentaje } from "@/lib/formato"
import type { OrdenCompleta } from "@/lib/compras/orden-completa"
import { EstadoOC } from "./estado-oc"

const FORMA: Record<string, string> = { cheque: "cheque", transferencia: "transferencia", efectivo: "efectivo" }

interface Props {
  ordenId: string | null
  onCerrar: () => void
  onEditar: (id: string) => void
  onEnviar: (id: string) => void
  /** Algo cambió (se canceló): recargar el listado */
  onCambio: () => void
  /** Sube cuando hay que volver a leer la orden (después de editar o enviar) */
  version?: number
}

export function DetalleOrden({ ordenId, onCerrar, onEditar, onEnviar, onCambio, version = 0 }: Props) {
  const [oc, setOc] = useState<OrdenCompleta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [cancelando, setCancelando] = useState(false)

  const cargar = useCallback(async (id: string) => {
    setError(null)
    try {
      const r = await fetch(`/api/ordenes-compra/${id}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error || "No se pudo leer la orden."); return }
      setOc(d)
    } catch { setError("No se pudo leer la orden. Revisá la conexión.") }
  }, [])

  useEffect(() => {
    if (!ordenId) { setOc(null); return }
    setOc((actual) => (actual?.orden.id === ordenId ? actual : null))
    cargar(ordenId)
  }, [ordenId, version, cargar])

  const cancelar = async () => {
    if (!oc || cancelando) return
    setCancelando(true)
    try {
      const r = await fetch(`/api/ordenes-compra/${oc.orden.id}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error || "No se pudo cancelar la orden.", { duration: 10000 }); return }
      toast.success(`Orden ${oc.orden.numero_orden} cancelada.`)
      if (d.estaba_enviada) toast.warning("La orden ya se le había mandado al proveedor: avisale que quedó sin efecto.", { duration: 12000 })
      setConfirmarCancelar(false); setMotivo("")
      onCambio()
      cargar(oc.orden.id)
    } finally { setCancelando(false) }
  }

  const o = oc?.orden
  const t = oc?.totales
  const hayNegro = !!t && t.total_negro > 0
  const enRecepcion = !!o && ["recibida_parcial", "recibida_completa", "recibida", "finalizada"].includes(o.estado)

  return (
    <>
      <Dialog open={!!ordenId} onOpenChange={(a) => { if (!a) onCerrar() }}>
        <DialogContent className="flex max-h-[94vh] w-full flex-col gap-0 p-0 sm:max-w-6xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex flex-wrap items-center gap-3">
              {oc ? <>Orden {o!.numero_orden} <span className="font-normal text-muted-foreground">— {oc.proveedor.nombre}</span> <EstadoOC estado={o!.estado} /></> : "Orden de compra"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
            {!oc && !error && <CargaProgreso mensajes={MENSAJES.ordenesCompra} />}

            {oc && o && t && (
              <>
                {o.estado === "cancelada" && (
                  <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <Ban className="h-4 w-4 shrink-0" />
                    <span>Cancelada{o.cancelada_at ? ` el ${fechaHora(o.cancelada_at)}` : ""}.{o.motivo_cancelacion ? ` Motivo: ${o.motivo_cancelacion}` : ""}</span>
                  </div>
                )}
                {o.cambio_sin_enviar && o.estado !== "cancelada" && (
                  <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>La orden se modificó después de mandársela al proveedor: tiene una versión vieja. Reenviala.</span>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Entrega</div>
                    <div className="text-lg font-semibold">{o.fecha_estimada_recepcion ? fecha(o.fecha_estimada_recepcion) : "Sin fecha"}</div>
                    <div className="text-xs text-muted-foreground">Fecha estimada. Creada el {fecha(o.fecha_orden)}{o.creada_por ? ` por ${o.creada_por}` : ""}.</div>
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Cómo se paga</div>
                    {oc.condiciones.map((c) => (
                      <div key={c.canal} className="text-sm">
                        {oc.condiciones.length > 1 && <span className="font-semibold">{c.canal === "blanco" ? "Con factura: " : "Sin factura: "}</span>}
                        {c.texto}
                      </div>
                    ))}
                    {(o.acuerdo_pago.blanco.de_legado || o.acuerdo_pago.negro?.de_legado) && (
                      <div className="mt-1 text-xs font-medium text-amber-700">Acuerdo de pago sin cargar: el plazo salió del dato viejo de la ficha del proveedor.</div>
                    )}
                    {o.acuerdo_de_ficha && <div className="mt-1 text-xs text-muted-foreground">Orden anterior al cambio: se muestra el acuerdo de la ficha del proveedor.</div>}
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Send className="h-3.5 w-3.5" /> Envío al proveedor</div>
                    {o.enviada_at ? (
                      <>
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-green-700"><CheckCircle2 className="h-4 w-4" /> Enviada el {fechaHora(o.enviada_at)}</div>
                        <div className="text-xs text-muted-foreground">
                          A {o.enviada_a || "—"}{o.enviada_cc ? ` (copia: ${o.enviada_cc})` : ""}{o.enviada_por ? ` · por ${o.enviada_por}` : ""}{o.envios > 1 ? ` · ${o.envios} envíos` : ""}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm font-semibold text-amber-700">Todavía no se le mandó al proveedor</div>
                    )}
                  </div>
                </div>

                {/* Vencimientos que generó la orden */}
                <div className="rounded-lg border p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cuándo se paga (vencimientos estimados en el calendario)</div>
                  {oc.pagos.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {oc.pagos.map((p) => (
                        <div key={p.id} className="rounded-md border border-dashed border-amber-400 bg-amber-50 px-3 py-1.5 text-sm">
                          <span className="font-semibold">{fecha(p.fecha)}</span> · {moneda(p.monto)}
                          {p.forma_pago ? ` · ${FORMA[p.forma_pago] || p.forma_pago}` : ""}
                          {hayNegro && oc.condiciones.length > 1 ? ` · ${p.canal === "blanco" ? "con factura" : "sin factura"}` : ""}
                          <span className="ml-1 text-xs text-amber-800">estimado</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {o.estado === "cancelada" ? "La orden está cancelada: no tiene vencimientos."
                        : enRecepcion ? "Los vencimientos estimados ya se reemplazaron por los de las facturas (o la orden es anterior a este cambio)."
                        : "Esta orden no tiene vencimientos estimados (es anterior a este cambio). Se generan al editarla y guardarla."}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">
                    Fecha estimada de entrega + los días acordados (si esa fecha ya pasó, desde el día en que se guardó). Cuando se valida la factura se reemplazan por el vencimiento real.
                  </div>
                </div>

                {/* Renglones */}
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artículo</TableHead>
                        <TableHead className="text-right">Se pide</TableHead>
                        <TableHead className="text-right">Lista por unidad</TableHead>
                        <TableHead className="text-center">Descuentos</TableHead>
                        <TableHead className="text-right">Neto por unidad</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {oc.renglones.map((r) => {
                        const descs = r.descuentos.filter((d) => d > 0)
                        return (
                          <TableRow key={r.articulo_id}>
                            <TableCell>
                              <div className="font-medium">{r.descripcion}</div>
                              <div className="text-xs text-muted-foreground">
                                {r.sku ? `SKU ${r.sku}` : ""}{r.ean13 ? ` · EAN ${r.ean13}` : ""}
                                {r.iva_compras === "adquisicion_stock" && <span className="ml-1.5 rounded bg-neutral-200 px-1 text-neutral-700">sin factura</span>}
                                {r.iva_compras === "mixto" && <span className="ml-1.5 rounded bg-amber-100 px-1 text-amber-800">mitad con factura</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div className="font-semibold">{numero(r.cantidad_pedida, 0, 2)} {r.tipo_cantidad === "bulto" ? (r.cantidad_pedida === 1 ? "bulto" : "bultos") : "u"}</div>
                              {r.tipo_cantidad === "bulto" && (
                                <div className={`text-xs ${r.unidades_por_bulto > 1 ? "text-muted-foreground" : "font-semibold text-red-600"}`}>
                                  {r.unidades_por_bulto > 1 ? `× ${entero(r.unidades_por_bulto)} = ${entero(r.unidades)} u` : "sin unidades por bulto en la ficha"}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{moneda(r.precio_unitario)}</TableCell>
                            <TableCell className="text-center tabular-nums">{descs.length ? descs.map((d) => porcentaje(d)).join(" + ") : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div>{moneda(r.precio_neto)}</div>
                              {r.precio_neto_bulto != null && <div className="text-xs text-muted-foreground">{moneda(r.precio_neto_bulto)} el bulto</div>}
                              {r.difiere_de_ficha && r.precio_neto_ficha != null && (
                                <div className="text-xs font-medium text-amber-700" title="El precio pactado en esta orden no es el que tenía el artículo en su ficha. La ficha no se modifica: el costo lo actualiza la factura validada.">
                                  ficha: {moneda(r.precio_neto_ficha)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{moneda(r.total)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-xl text-sm">
                    {o.observaciones && <><span className="font-semibold">Observaciones: </span>{o.observaciones}</>}
                  </div>
                  <div className="w-full max-w-sm space-y-1 rounded-lg border p-3 text-sm tabular-nums">
                    <div className="flex justify-between"><span>{entero(t.renglones)} artículos · {entero(t.unidades)} unidades</span></div>
                    <div className="flex justify-between"><span>Total sin impuestos</span><span className="font-medium">{moneda(t.neto)}</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>IVA 21 %{hayNegro ? ` (sobre ${moneda(t.neto_blanco)})` : ""}</span><span>{moneda(t.iva)}</span></div>
                    {t.percepciones > 0 && <div className="flex justify-between text-muted-foreground"><span>Percepciones (estimadas)</span><span>{moneda(t.percepciones)}</span></div>}
                    <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total estimado</span><span>{moneda(t.total)}</span></div>
                    {hayNegro && <div className="text-xs text-muted-foreground">Con factura {moneda(t.total_blanco)} · sin factura {moneda(t.total_negro)}</div>}
                  </div>
                </div>
              </>
            )}
          </div>

          {oc && o && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-6 py-3">
              <div className="flex flex-wrap gap-2">
                {oc.puede.cancelar && (
                  <Button variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmarCancelar(true)}>
                    <Ban className="mr-1.5 h-4 w-4" /> Cancelar la orden
                  </Button>
                )}
                {!oc.puede.cancelar && o.estado !== "cancelada" && oc.puede.motivo && <span className="self-center text-xs text-muted-foreground">{oc.puede.motivo}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => window.open(`/api/ordenes-compra/${o.id}/pdf?ver=1`, "_blank")}><FileText className="mr-1.5 h-4 w-4" /> PDF</Button>
                <Button variant="outline" onClick={() => window.open(`/api/ordenes-compra/${o.id}/pdf?formato=xlsx`, "_blank")}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel</Button>
                {o.estado !== "cancelada" && (
                  <Button variant="outline" onClick={() => { window.location.href = `/ordenes-compra/${o.id}/verificacion` }}>
                    {enRecepcion ? "Verificación" : "Cargar comprobante"}
                  </Button>
                )}
                {oc.puede.editar && <Button variant="outline" onClick={() => onEditar(o.id)}><Pencil className="mr-1.5 h-4 w-4" /> Editar</Button>}
                {oc.puede.enviar && <Button onClick={() => onEnviar(o.id)}><Send className="mr-1.5 h-4 w-4" /> {o.envios > 0 ? "Reenviar al proveedor" : "Enviar al proveedor"}</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmarCancelar} onOpenChange={(a) => { if (!cancelando) setConfirmarCancelar(a) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar la orden {o?.numero_orden}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>La orden queda en el listado como <b>cancelada</b> (no se borra) y se revierte todo lo que generó:</p>
                <ul className="list-inside list-disc">
                  <li>la deuda provisoria en la cuenta corriente de {oc?.proveedor.nombre}{t ? ` (${moneda(t.total)})` : ""};</li>
                  <li>la mercadería “en camino”;</li>
                  <li>{oc && oc.pagos.length > 0 ? `${oc.pagos.length} vencimiento(s) estimado(s) del calendario` : "los vencimientos estimados del calendario"}.</li>
                </ul>
                {o?.enviada_at && <p className="font-medium text-amber-700">Ya se le mandó al proveedor: acordate de avisarle que queda sin efecto.</p>}
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" rows={2} className="mt-2" />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando}>No, dejarla</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={cancelando} onClick={(e) => { e.preventDefault(); cancelar() }}>
              {cancelando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelando…</> : "Sí, cancelar la orden"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
