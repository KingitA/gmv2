"use client"

// Formulario ÚNICO de vencimientos (pago a proveedor, gasto, servicio, impuesto…),
// para crear y para editar. Reemplaza a los 3 altas y 2 ediciones que había
// (calendario de pagos, lista de /vencimientos, "Nuevo gasto" y "Editar pago" de
// /finanzas), pedido del dueño 08/10/2026. Guarda con la API de siempre:
// POST /api/vencimientos (alta, con la serie si se repite), PUT (edición),
// DELETE (cancelar), POST /api/vencimientos/[id]/recalcular.

import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react"
import { CalendarClock, Landmark, Loader2, Receipt, Repeat } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { Campo, Campos } from "@/components/ficha/ficha"
import { CATEGORIAS_GASTO } from "@/lib/finanzas/categorias-gasto"
import { tiposVisibles } from "@/lib/finanzas/tipos-reservados"
import { useMisRoles } from "@/lib/hooks/useMisRoles"
import { formatCurrency, todayArgentina } from "@/lib/utils"

export interface VencimientoForm {
  id: string
  tipo?: string | null
  proveedor_id?: string | null
  proveedores?: { id?: string; nombre?: string | null } | null
  concepto?: string | null
  monto: number
  fecha_vencimiento: string
  fecha_validez?: string | null
  forma_pago?: string | null
  modalidad?: string | null
  descuentos_aplicados?: boolean | null
  es_estimado?: boolean | null
  observaciones?: string | null
  dias_alerta?: number | null
  recurrencia?: string | null
}

const RECURRENCIAS = [
  { v: "ninguna", l: "No se repite (pago único)" },
  { v: "mensual", l: "Todos los meses" },
  { v: "bimestral", l: "Cada 2 meses" },
  { v: "trimestral", l: "Cada 3 meses" },
  { v: "semestral", l: "Cada 6 meses" },
  { v: "anual", l: "Una vez al año" },
]

/**
 * Lee montos escritos de cualquier forma: "1.234,50" · "1234,5" · "1234.50" · "1234".
 * Con coma, la coma es el decimal y los puntos son miles. Sin coma, un punto
 * con 1 o 2 decimales es el decimal; con 3 cifras después es separador de miles.
 */
export function leerMonto(texto: string): number | null {
  const t = texto.trim().replace(/\s|\$/g, "")
  if (!t) return null
  let n: string
  if (t.includes(",")) n = t.replace(/\./g, "").replace(",", ".")
  else if (/^\d+\.\d{1,2}$/.test(t)) n = t
  else n = t.replace(/\./g, "")
  if (!/^\d+(\.\d+)?$/.test(n)) return null
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Si viene, se edita; si no, es un alta. */
  venc?: VencimientoForm | null
  /** Para el alta: con qué arranca ("factura" para pagos a proveedor, otro tipo para gastos). */
  tipoInicial?: string
  /** Para el alta: si arranca repitiéndose (ej. "mensual" para servicios). */
  recurrenciaInicial?: string
  onSaved?: () => void
  /** Si se marca pagado con forma "cheque": el calendario abre la elección de cheques. */
  onPagadoConCheque?: (venc: VencimientoForm) => void
}

export function FormVencimientoDialog({ open, onOpenChange, venc, tipoInicial = "factura", recurrenciaInicial = "ninguna", onSaved, onPagadoConCheque }: Props) {
  const { roles } = useMisRoles()
  const tipos = tiposVisibles(CATEGORIAS_GASTO, roles)
  const editando = !!venc

  const [tipo, setTipo] = useState(tipoInicial)
  const [proveedor, setProveedor] = useState<{ id: string; nombre: string } | null>(null)
  const [concepto, setConcepto] = useState("")
  const [monto, setMonto] = useState("")
  const [estimado, setEstimado] = useState(false)
  const [fecha, setFecha] = useState(todayArgentina())
  const [validez, setValidez] = useState("")
  const [forma, setForma] = useState("transferencia")
  const [modalidad, setModalidad] = useState("deposito")
  const [descuentos, setDescuentos] = useState(false)
  const [recurrencia, setRecurrencia] = useState(recurrenciaInicial)
  const [hasta, setHasta] = useState("")
  const [diasAlerta, setDiasAlerta] = useState("3")
  const [observaciones, setObservaciones] = useState("")
  const [saving, setSaving] = useState(false)

  // Cada vez que se abre: con los datos del vencimiento o limpio
  useEffect(() => {
    if (!open) return
    if (venc) {
      setTipo(venc.tipo || "factura")
      setProveedor(venc.proveedor_id ? { id: venc.proveedor_id, nombre: venc.proveedores?.nombre || "Proveedor" } : null)
      setConcepto(venc.concepto || "")
      setMonto(venc.monto != null ? String(Number(venc.monto)).replace(".", ",") : "")
      setEstimado(!!venc.es_estimado)
      setFecha(venc.fecha_vencimiento || todayArgentina())
      setValidez(venc.fecha_validez || "")
      setForma(venc.forma_pago || "transferencia")
      setModalidad(venc.modalidad || "deposito")
      setDescuentos(!!venc.descuentos_aplicados)
      setRecurrencia("ninguna")
      setHasta("")
      setDiasAlerta(String(venc.dias_alerta ?? 3))
      setObservaciones(venc.observaciones || "")
    } else {
      setTipo(tipoInicial)
      setProveedor(null)
      setConcepto("")
      setMonto("")
      setEstimado(false)
      setFecha(todayArgentina())
      setValidez("")
      setForma("transferencia")
      setModalidad("deposito")
      // Gastos sin proveedor: no hay NC que esperar (como hacía "Nuevo gasto")
      setDescuentos(tipoInicial !== "factura")
      setRecurrencia(recurrenciaInicial)
      setHasta("")
      setDiasAlerta("3")
      setObservaciones("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, venc?.id])

  const montoNum = useMemo(() => leerMonto(monto), [monto])
  const titulo = editando ? (venc?.proveedores?.nombre || venc?.concepto || "Vencimiento") : "Nuevo pago o gasto"

  const guardar = async (e?: FormEvent) => {
    e?.preventDefault()
    if (montoNum === null || montoNum <= 0) { toast.error("Monto inválido"); return }
    const conceptoFinal = concepto.trim() || proveedor?.nombre || ""
    if (!conceptoFinal) { toast.error("Poné un concepto o elegí un proveedor"); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { toast.error("Fecha de pago inválida"); return }
    setSaving(true)
    try {
      const datos = {
        proveedor_id: proveedor?.id || null,
        tipo,
        concepto: conceptoFinal,
        monto: montoNum,
        fecha_vencimiento: fecha,
        fecha_validez: validez || null,
        forma_pago: forma,
        modalidad,
        descuentos_aplicados: descuentos,
        es_estimado: estimado,
        observaciones: observaciones.trim() || null,
        ...(!editando || diasAlerta !== String(venc?.dias_alerta ?? 3) ? { dias_alerta: diasAlerta === "" ? 3 : Math.max(0, Number(diasAlerta) || 0) } : {}),
      }
      const body = editando
        ? { id: venc!.id, ...datos }
        : { ...datos, recurrencia: recurrencia === "ninguna" ? null : recurrencia, recurrencia_hasta: recurrencia !== "ninguna" && hasta ? hasta : null }
      const res = await fetch("/api/vencimientos", {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "No se pudo guardar")
      toast.success(editando ? "Vencimiento guardado" : recurrencia === "ninguna" ? "Vencimiento agendado" : "Serie agendada: las próximas cuotas se generan solas")
      onOpenChange(false)
      onSaved?.()
    } catch (err: any) {
      toast.error(err?.message || "No se pudo guardar")
    } finally {
      setSaving(false)
    }
  }

  const eliminar = async () => {
    if (!venc || !confirm(`¿Eliminar "${titulo}"? Queda cancelado (no se borra el registro).`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vencimientos?id=${venc.id}`, { method: "DELETE" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success("Vencimiento cancelado")
      onOpenChange(false)
      onSaved?.()
    } catch (err: any) {
      toast.error(err?.message || "No se pudo eliminar")
    } finally {
      setSaving(false)
    }
  }

  const recalcular = async () => {
    if (!venc) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vencimientos/${venc.id}/recalcular`, { method: "POST" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      const partes = [
        d.forma_pago ? `forma: ${d.forma_pago}` : null,
        d.modalidad ? `modalidad: ${d.modalidad}` : null,
        d.fecha_vencimiento ? `vence: ${d.fecha_vencimiento.split("-").reverse().join("/")}` : null,
        d.fecha_validez ? `validez cheques: ${d.fecha_validez.split("-").reverse().join("/")}` : null,
      ].filter(Boolean)
      toast.success(`Recalculado desde la ficha del proveedor — ${partes.join(" · ")}`)
      onOpenChange(false)
      onSaved?.()
    } catch (err: any) {
      toast.error(err?.message || "No se pudo recalcular")
    } finally {
      setSaving(false)
    }
  }

  const marcarPagado = async () => {
    if (!venc) return
    const aviso = venc.proveedor_id
      ? `Es un pago a proveedor. Marcado así (sin orden de pago) NO descuenta de la caja ni del banco, NO lo registra en la cuenta corriente del proveedor y NO calcula la retención de Ganancias: queda como "pagado sin OP".\n\n¿Marcarlo pagado igual?`
      : `¿Marcar "${titulo}" como pagado?`
    if (!confirm(aviso)) return
    setSaving(true)
    try {
      const res = await fetch("/api/vencimientos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: venc.id, estado: "pagado" }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      onOpenChange(false)
      onSaved?.()
      if (forma === "cheque" && onPagadoConCheque) onPagadoConCheque({ ...venc, forma_pago: "cheque" })
      else toast.success(forma === "cheque"
        ? "Pago marcado. Registrá con qué cheques fue desde el calendario (para descargarlos de cartera)."
        : "Pago marcado como pagado")
    } catch (err: any) {
      toast.error(err?.message || "No se pudo marcar")
    } finally {
      setSaving(false)
    }
  }

  const esProveedor = tipo === "factura"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,880px)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="text-lg font-bold tracking-tight text-azul-900">{editando ? `Editar — ${titulo}` : titulo}</DialogTitle>
          <p className="mt-0.5 text-[13px] text-neutro-500">Factura de proveedor, servicio, impuesto o cualquier gasto con fecha.</p>
        </div>

        <form id="form-vencimiento" onSubmit={guardar} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <Bloque icono={Receipt} titulo="Qué se paga">
            <Campos cols={2}>
              <Campo label="Tipo">
                <Select value={tipo} onValueChange={(v) => { setTipo(v); if (!editando) setDescuentos(v !== "factura") }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{tipos.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </Campo>
              <Campo label="Proveedor" nota={esProveedor ? undefined : "opcional"}>
                <EntitySearchSelect
                  entity="proveedores"
                  placeholder={esProveedor ? "Buscar proveedor…" : "Sin proveedor"}
                  value={proveedor}
                  onSelect={(p: any) => setProveedor(p ? { id: p.id, nombre: p.nombre } : null)}
                />
              </Campo>
              <Campo label="Concepto" nota={proveedor ? "si lo dejás vacío, va el nombre del proveedor" : undefined} ancho={2}>
                <Input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Factura A 0001-00045678 · VEP 931 · Seguro camioneta cuota 3" />
              </Campo>
            </Campos>
          </Bloque>

          <Bloque icono={CalendarClock} titulo="Cuánto y cuándo">
            <Campos cols={2}>
              <Campo label="Monto">
                <Input inputMode="decimal" className="tabular-nums" value={monto} placeholder="0,00"
                  onChange={e => { setMonto(e.target.value); if (editando && estimado && venc?.es_estimado) setEstimado(false) }} />
                <p className={`mt-1 text-[12px] ${monto && montoNum === null ? "text-error-600" : "text-neutro-500"}`}>
                  {monto ? (montoNum === null ? "No se entiende el monto" : `= ${formatCurrency(montoNum)}`) : "Podés escribir 1.234,50 o 1234.50"}
                </p>
              </Campo>
              <Campo label="Fecha de pago">
                <FechaInput value={fecha} onChange={setFecha} />
              </Campo>
              <Campo label="Fecha de validez" nota="cheques diferidos">
                <FechaInput value={validez} onChange={setValidez} />
              </Campo>
              <Campo label="Avisar">
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" className="w-20 tabular-nums" value={diasAlerta} onChange={e => setDiasAlerta(e.target.value)} />
                  <span className="text-sm text-neutro-500">días antes</span>
                </div>
              </Campo>
            </Campos>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-neutro-700">
              <Checkbox checked={estimado} onCheckedChange={c => setEstimado(!!c)} />
              El monto es un estimado (todavía no llegó el real)
            </label>
          </Bloque>

          <Bloque icono={Landmark} titulo="Cómo se paga">
            <Campos cols={2}>
              <Campo label="Forma de pago">
                <Select value={forma} onValueChange={setForma}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transferencia">Transferencia / débito</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Modalidad">
                <Select value={modalidad} onValueChange={setModalidad}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposito">Lo pago / deposito yo</SelectItem>
                    <SelectItem value="entrega">Lo retiran por caja</SelectItem>
                    <SelectItem value="grimar">Se envía por Grimar</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
            </Campos>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-neutro-700">
              <Checkbox className="mt-0.5" checked={descuentos} onCheckedChange={c => setDescuentos(!!c)} />
              <span>Descuentos / notas de crédito ya aplicados (listo para pagar)
                <span className="block text-[12px] text-neutro-500">Si queda sin marcar, el calendario lo señala con ⚠ para revisar NC o retenciones.</span>
              </span>
            </label>
          </Bloque>

          {!editando && (
            <Bloque icono={Repeat} titulo="Se repite">
              <Campos cols={2}>
                <Campo label="Frecuencia">
                  <Select value={recurrencia} onValueChange={setRecurrencia}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECURRENCIAS.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                  </Select>
                </Campo>
                {recurrencia !== "ninguna" && (
                  <Campo label="Hasta / fin de ciclo" nota="opcional">
                    <FechaInput value={hasta} onChange={setHasta} />
                  </Campo>
                )}
              </Campos>
              {recurrencia !== "ninguna" && (
                <p className="mt-2 text-[12px] text-neutro-500">Las próximas cuotas se generan solas. Si cargás el fin de ciclo, al acercarse el sistema crea el recordatorio de renovación.</p>
              )}
            </Bloque>
          )}

          <Campo label="Observaciones" nota="opcional">
            <Input value={observaciones} onChange={e => setObservaciones(e.target.value)} />
          </Campo>
        </form>

        <div className="flex flex-wrap items-center gap-2 border-t bg-neutro-50 px-5 py-3 sm:px-6">
          {editando && (
            <>
              <Button type="button" variant="ghost" className="text-error-600 hover:bg-error-50 hover:text-error-700" disabled={saving} onClick={eliminar}>Eliminar</Button>
              {venc?.proveedor_id && (
                <Button type="button" variant="outline" disabled={saving} onClick={recalcular}
                  title="Vuelve a aplicar el acuerdo de pago de la ficha del proveedor (forma, modalidad, plazo y validez de cheques)">
                  Recalcular desde ficha
                </Button>
              )}
              {venc?.proveedor_id && (
                <Button type="button" variant="outline" asChild>
                  <a href={`/ordenes-pago/nueva?proveedor_id=${venc.proveedor_id}&vencimiento_id=${venc.id}`}>Generar OP</a>
                </Button>
              )}
              <Button type="button" variant="outline" disabled={saving} onClick={marcarPagado}>
                {venc?.proveedor_id ? "Pagado sin OP" : "Marcar pagado"}
              </Button>
            </>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" form="form-vencimiento" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{editando ? "Guardar cambios" : "Agendar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Bloque({ icono: Icono, titulo, children }: { icono: ComponentType<{ className?: string }>; titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-azul-900">
        <span className="grid size-6 place-items-center rounded-md bg-azul-50 text-azul-600"><Icono className="size-3.5" /></span>
        {titulo}
      </h3>
      {children}
    </section>
  )
}
