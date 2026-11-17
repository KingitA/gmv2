"use client"

// Crear / editar una orden de compra (E-07, E-10, E-11, E-12, E-13, E-14).
// Pensado para la persona de compras: por cada artículo ve stock, en camino, venta del período y
// sugerencia (en la misma unidad en que pide), el precio aclarado POR UNIDAD y por bulto, el total
// con y sin impuestos, cuándo llega y cuándo se paga. Guardar pasa por /api/ordenes-compra/crear
// (función SQL oc_guardar): acá no se escribe nada en la base.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CalendarClock, Loader2, Plus, Search, Send, Truck, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InputMonto } from "@/components/ui/input-monto"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { CargaProgreso } from "@/components/ui/carga-progreso"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { localMatch } from "@/lib/search/local-match"
import { entero, fecha, hoyISO, moneda, numero, sumarDiasISO } from "@/lib/formato"
import { bultosParaCubrir } from "@/lib/deposito/unidades"
import { netoRenglon, precioNeto, totalesOC, unidadesRenglon } from "@/lib/compras/oc-totales"
import {
  DESDE_PAGO, ENTREGAS_PAGO, MEDIOS_PAGO, acuerdoDelCanal, canalVacio, normalizarCuotas, planDePagos, textoCanal,
  type AcuerdoCanal, type AcuerdoPago,
} from "@/lib/compras/acuerdo-pago"
import type { ArticuloParaPedir, DiasEntrega } from "@/lib/compras/orden-compra"
import type { OrdenCompleta } from "@/lib/compras/orden-completa"

interface Fila {
  cantidad: number
  tipo: "bulto" | "unidad"
  precio: number
  d1: number
  d2: number
  d3: number
  d4: number
}

/** Renglón de un archivo importado que no se pudo vincular a un artículo: queda a revisión (E-13) */
export interface RenglonSinArticulo {
  descripcion: string
  codigo: string | null
  cantidad: number
  precio: number
}

export interface InicioOrden {
  /** Editar esta orden */
  ordenId?: string | null
  proveedorId?: string | null
  /** Cargar la sugerencia como cantidad pedida (Jarvis) */
  aplicarSugerencia?: boolean
  observaciones?: string
  /** Renglones que vienen de un archivo importado */
  importados?: { articulo_id: string; cantidad: number; precio: number | null; descuento1: number | null }[]
  /** En qué vienen las cantidades del archivo */
  unidadImportada?: "bulto" | "unidad"
  /** A qué corresponde el precio del archivo (en el sistema el precio es siempre por unidad) */
  precioImportadoPor?: "bulto" | "unidad"
  sinArticulo?: RenglonSinArticulo[]
}

interface Preparado {
  proveedor: { id: string; nombre: string; percepcion_iva: number; percepcion_iibb: number; tipo_descuento: "cascada" | "sobre_lista"; mixto_pct_factura: number | null }
  acuerdo_pago: AcuerdoPago
  entrega: DiasEntrega & { fecha: string }
  periodo: { desde: string; hasta: string; dias: number; tipo_venta: "vendida" | "facturada"; dias_objetivo: number }
  articulos: ArticuloParaPedir[]
}

const filaDe = (a: ArticuloParaPedir): Fila => ({
  cantidad: 0, tipo: a.unidades_por_bulto > 1 ? "bulto" : "unidad",
  precio: a.precio_compra, d1: a.descuento1, d2: a.descuento2, d3: a.descuento3, d4: a.descuento4,
})
const renglonDe = (a: ArticuloParaPedir, f: Fila) => ({
  cantidad_pedida: f.cantidad, tipo_cantidad: f.tipo, precio_unitario: f.precio,
  descuento1: f.d1, descuento2: f.d2, descuento3: f.d3, descuento4: f.d4,
  unidades_por_bulto: a.unidades_por_bulto, iva_compras: a.iva_compras,
})
const TOPE_FILAS = 150

/**
 * Precio de un archivo importado → precio POR UNIDAD (lo único que guarda el sistema).
 * Si el archivo lo trae por bulto se divide por las unidades por bulto del catálogo; con un
 * artículo sin unidades por bulto (1) queda igual y la fila lo marca en rojo.
 */
const precioPorUnidad = (precio: number, por: "bulto" | "unidad" | undefined, unidadesPorBulto: number) =>
  por === "bulto" && unidadesPorBulto > 1 ? Math.round((precio / unidadesPorBulto) * 1e6) / 1e6 : precio

// ─── Una fila de la tabla (memo: escribir en una no redibuja las otras) ────────────────────
const FilaArticulo = memo(function FilaArticulo({ a, f, tipo, onCambio, onUsar }: {
  a: ArticuloParaPedir
  f: Fila
  /** Cómo aplica el proveedor sus descuentos */
  tipo: "cascada" | "sobre_lista"
  onCambio: (id: string, cambio: Partial<Fila>) => void
  onUsar: (id: string) => void
}) {
  const ub = a.unidades_por_bulto
  const r = renglonDe(a, f)
  const neto = precioNeto(r, tipo)
  const netoFicha = precioNeto({ precio_unitario: a.precio_compra, descuento1: a.descuento1, descuento2: a.descuento2, descuento3: a.descuento3, descuento4: a.descuento4 }, tipo)
  const cambioPrecio = Math.abs(neto - netoFicha) > 0.005
  const enBultos = (u: number) => (ub > 1 ? `${numero(u / ub, 0, 1)} bul` : null)
  const sugeridoEnUnidad = f.tipo === "bulto" ? a.sugerido_bultos : a.sugerido

  return (
    <tr className={`border-b align-top ${f.cantidad > 0 ? "bg-accent/60" : ""}`}>
      <td className="px-2 py-1.5">
        <div className="font-medium leading-tight">{a.descripcion}</div>
        <div className="text-xs text-muted-foreground">
          {a.sku ? `SKU ${a.sku}` : "sin SKU"}{a.ean13 ? ` · ${a.ean13}` : ""} · {ub > 1 ? `${entero(ub)} u por bulto` : <span className="font-semibold text-red-600">sin unidades por bulto</span>}
          {a.externo && <span className="ml-1.5 rounded bg-amber-100 px-1 text-amber-800">de otro proveedor</span>}
          {a.iva_compras === "adquisicion_stock" && <span className="ml-1.5 rounded bg-neutral-200 px-1 text-neutral-700">sin factura</span>}
          {a.iva_compras === "mixto" && <span className="ml-1.5 rounded bg-amber-100 px-1 text-amber-800">mixto</span>}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        <div className={a.stock_actual <= 0 ? "font-semibold text-red-600" : ""}>{entero(a.stock_actual)} u</div>
        {enBultos(a.stock_actual) && <div className="text-xs text-muted-foreground">{enBultos(a.stock_actual)}</div>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {a.en_camino > 0 ? <><div className="text-purple-700">{entero(a.en_camino)} u</div>{enBultos(a.en_camino) && <div className="text-xs text-muted-foreground">{enBultos(a.en_camino)}</div>}</> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {a.vendido > 0 ? <><div>{entero(a.vendido)} u</div><div className="text-xs text-muted-foreground">{numero(a.venta_diaria, 0, 1)} por día</div></> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums">
        {a.sugerido > 0 ? (
          <button type="button" onClick={() => onUsar(a.id)} title="Cargar la sugerencia como cantidad a pedir"
            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-800 hover:bg-blue-100">
            <span className="font-semibold">{entero(sugeridoEnUnidad)} {f.tipo === "bulto" ? "bul" : "u"}</span>
            {f.tipo === "bulto" && ub > 1 && <span className="block text-[10px] leading-tight">= {entero(sugeridoEnUnidad * ub)} u</span>}
            <span className="block text-[10px] leading-tight underline">usar</span>
          </button>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1">
          <InputMonto decimales={0} soloPositivos value={f.cantidad || null} onChange={(v) => onCambio(a.id, { cantidad: v ?? 0 })}
            className={`h-8 w-20 text-right ${f.cantidad > 0 ? "border-primary font-semibold" : ""}`} aria-label={`Cantidad de ${a.descripcion}`} />
          <select value={f.tipo} onChange={(e) => onCambio(a.id, { tipo: e.target.value === "unidad" ? "unidad" : "bulto" })}
            className="h-8 rounded-md border border-input bg-background px-1 text-xs" aria-label="Se pide por">
            <option value="bulto">bultos</option>
            <option value="unidad">unidades</option>
          </select>
        </div>
        {f.cantidad > 0 && f.tipo === "bulto" && (
          <div className={`mt-0.5 text-xs ${ub > 1 ? "text-muted-foreground" : "font-semibold text-red-600"}`}>
            {ub > 1 ? `= ${entero(unidadesRenglon(r))} unidades` : "se toma 1 u por bulto: revisar la ficha"}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <InputMonto soloPositivos value={f.precio || null} onChange={(v) => onCambio(a.id, { precio: v ?? 0 })} className="h-8 w-28 text-right" aria-label="Precio de lista por unidad" />
        <div className="mt-0.5 flex gap-0.5">
          {(["d1", "d2", "d3", "d4"] as const).map((k) => (
            <InputMonto key={k} soloPositivos value={f[k] || null} onChange={(v) => onCambio(a.id, { [k]: Math.min(100, v ?? 0) })}
              className="h-6 w-[26px] px-0.5 text-center text-[11px]" placeholder="%" aria-label={`Descuento ${k.slice(1)} %`} />
          ))}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        <div className="font-medium">{moneda(neto)}</div>
        {ub > 1 && <div className="text-xs text-muted-foreground">{moneda(neto * ub)} el bulto</div>}
        {cambioPrecio && <div className="text-xs font-medium text-amber-700" title="El precio de esta orden no es el de la ficha del artículo. La ficha NO se modifica: el costo lo actualiza la factura validada.">ficha: {moneda(netoFicha)}</div>}
      </td>
      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{f.cantidad > 0 ? moneda(netoRenglon(r, tipo)) : <span className="font-normal text-muted-foreground">—</span>}</td>
    </tr>
  )
})

// ─── Editor del acuerdo de un canal ────────────────────────────────────────────────────────
function EditorCanal({ titulo, c, onChange }: { titulo: string; c: AcuerdoCanal; onChange: (c: AcuerdoCanal) => void }) {
  const plazo = c.cuotas ?? (c.dias != null ? String(c.dias) : "")
  const [texto, setTexto] = useState(plazo)
  useEffect(() => { setTexto(plazo) }, [plazo])
  const aplicarPlazo = (v: string) => {
    const limpio = v.trim()
    const cuotas = normalizarCuotas(limpio)
    if (cuotas) onChange({ ...c, cuotas, dias: Number(cuotas.split("/")[0]) })
    else if (/^\d{1,3}$/.test(limpio)) onChange({ ...c, cuotas: null, dias: Number(limpio) })
    else if (limpio === "") onChange({ ...c, cuotas: null, dias: null })
    else { toast.error('El plazo va en días: "30", o en cuotas "30/60/90".'); setTexto(plazo) }
  }
  const esCheque = c.medio === "cheques" || c.medio === "cheques_y_efectivo" || c.medio === "echeq"
  return (
    <div className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-5">
      <div className="text-sm font-semibold sm:col-span-5">{titulo}</div>
      <div>
        <Label className="text-xs">Medio</Label>
        <Select value={c.medio ?? "sin"} onValueChange={(v) => onChange({ ...c, medio: v === "sin" ? null : (v as AcuerdoCanal["medio"]) })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sin">Sin definir</SelectItem>
            {MEDIOS_PAGO.map((m) => <SelectItem key={m.valor} value={m.valor}>{m.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Plazo en días (o cuotas 30/60)</Label>
        <Input className="h-8" value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={(e) => aplicarPlazo(e.target.value)} placeholder="30" inputMode="numeric" />
      </div>
      <div>
        <Label className="text-xs">Corre desde</Label>
        <Select value={c.desde} onValueChange={(v) => onChange({ ...c, desde: v === "recepcion" ? "recepcion" : "factura" })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>{DESDE_PAGO.map((m) => <SelectItem key={m.valor} value={m.valor}>{m.nombre}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Cheques hasta (días)</Label>
        <InputMonto decimales={0} soloPositivos className="h-8" disabled={!esCheque} value={c.plazo_cheque} onChange={(v) => onChange({ ...c, plazo_cheque: v != null ? Math.min(365, Math.trunc(v)) : null })} placeholder={esCheque ? "30" : "—"} />
      </div>
      <div>
        <Label className="text-xs">Cómo se entrega</Label>
        <Select value={c.entrega ?? "sin"} onValueChange={(v) => onChange({ ...c, entrega: v === "sin" ? null : (v as AcuerdoCanal["entrega"]) })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sin">Sin definir</SelectItem>
            {ENTREGAS_PAGO.map((m) => <SelectItem key={m.valor} value={m.valor}>{m.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ─── El diálogo ────────────────────────────────────────────────────────────────────────────
export function DialogoOrden({ abierto, inicio, onCerrar, onGuardada }: {
  abierto: boolean
  inicio: InicioOrden | null
  onCerrar: () => void
  /** enviar = el usuario eligió "guardar y enviar al proveedor" */
  onGuardada: (r: { ordenId: string; numero: string; enviar: boolean }) => void
}) {
  const ordenId = inicio?.ordenId || null
  const [proveedor, setProveedor] = useState<{ id: string; nombre: string } | null>(null)
  const [prep, setPrep] = useState<Preparado | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filas, setFilas] = useState<Record<string, Fila>>({})
  const [numeroOrden, setNumeroOrden] = useState<string | null>(null)
  const [fechaEntrega, setFechaEntrega] = useState("")
  const [acuerdo, setAcuerdo] = useState<AcuerdoPago | null>(null)
  // % con factura de los artículos mixtos de ESTA orden (null = no cargado: 50)
  const [mixtoPct, setMixtoPct] = useState<number | null>(null)
  const [editarPago, setEditarPago] = useState(false)
  const [observaciones, setObservaciones] = useState("")
  const [sinArticulo, setSinArticulo] = useState<RenglonSinArticulo[]>([])
  // filtros
  const [busca, setBusca] = useState("")
  const [soloSugeridos, setSoloSugeridos] = useState(false)
  const [soloConCantidad, setSoloConCantidad] = useState(false)
  const [verTodas, setVerTodas] = useState(false)
  // período de venta para la sugerencia
  const [desde, setDesde] = useState(() => sumarDiasISO(hoyISO(), -90))
  const [hasta, setHasta] = useState(() => hoyISO())
  const [tipoVenta, setTipoVenta] = useState<"vendida" | "facturada">("vendida")
  const [diasObjetivo, setDiasObjetivo] = useState(45)
  const [agregar, setAgregar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const clave = useRef<string>("")
  const extras = useRef<string[]>([])

  /** Trae artículos + datos del proveedor. `conservar` = no pisar lo que el usuario ya cargó. */
  const preparar = useCallback(async (provId: string, opciones: { conservar: boolean; aplicar?: boolean; orden?: OrdenCompleta | null; p?: { desde: string; hasta: string; tipoVenta: string; diasObjetivo: number } }) => {
    setCargando(true); setError(null)
    try {
      const per = opciones.p ?? { desde, hasta, tipoVenta, diasObjetivo }
      const qs = new URLSearchParams({ proveedor_id: provId, fecha_desde: per.desde, fecha_hasta: per.hasta, tipo_venta: per.tipoVenta, dias_objetivo: String(per.diasObjetivo) })
      if (ordenId) qs.set("orden_id", ordenId)
      if (extras.current.length) qs.set("extra", extras.current.join(","))
      const r = await fetch(`/api/ordenes-compra/preparar?${qs}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error || "No se pudieron traer los artículos del proveedor."); return null }
      const p = d as Preparado
      setPrep(p)
      setProveedor({ id: p.proveedor.id, nombre: p.proveedor.nombre })
      if (!opciones.conservar) {
        setFechaEntrega(opciones.orden?.orden.fecha_estimada_recepcion || p.entrega.fecha)
        setAcuerdo(opciones.orden ? opciones.orden.orden.acuerdo_pago : p.acuerdo_pago)
        setMixtoPct(opciones.orden?.orden.mixto_pct_factura ?? p.proveedor.mixto_pct_factura ?? null)
      }
      setFilas((prev) => {
        const out: Record<string, Fila> = {}
        for (const a of p.articulos) {
          const base = opciones.conservar && prev[a.id] ? prev[a.id] : filaDe(a)
          out[a.id] = opciones.aplicar && a.sugerido > 0 && !(base.cantidad > 0)
            ? { ...base, cantidad: base.tipo === "bulto" ? a.sugerido_bultos : a.sugerido }
            : base
        }
        return out
      })
      return p
    } catch {
      setError("No se pudieron traer los artículos. Revisá la conexión.")
      return null
    } finally { setCargando(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId, desde, hasta, tipoVenta, diasObjetivo])

  // Al abrir: orden nueva, orden a editar, Jarvis o archivo importado
  useEffect(() => {
    if (!abierto) return
    clave.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : ""
    extras.current = []
    setProveedor(null); setPrep(null); setFilas({}); setError(null); setNumeroOrden(null)
    setFechaEntrega(""); setAcuerdo(null); setMixtoPct(null); setEditarPago(false); setGuardando(false)
    setObservaciones(inicio?.observaciones || ""); setSinArticulo(inicio?.sinArticulo || [])
    setBusca(""); setSoloSugeridos(false); setVerTodas(false)
    setSoloConCantidad(!!inicio?.ordenId || !!inicio?.importados?.length)
    let vivo = true
    ;(async () => {
      if (inicio?.ordenId) {
        setCargando(true)
        const r = await fetch(`/api/ordenes-compra/${inicio.ordenId}`).catch(() => null)
        const oc: OrdenCompleta | null = r && r.ok ? await r.json() : null
        if (!vivo) return
        if (!oc) { setError("No se pudo leer la orden."); setCargando(false); return }
        if (!oc.puede.editar) { setError(oc.puede.motivo || "La orden ya no se puede modificar."); setCargando(false); return }
        setNumeroOrden(oc.orden.numero_orden)
        setObservaciones(oc.orden.observaciones || "")
        extras.current = oc.renglones.map((x) => x.articulo_id)
        const p = await preparar(oc.proveedor.id, { conservar: false, orden: oc })
        if (!vivo || !p) return
        setFilas((prev) => {
          const out = { ...prev }
          for (const x of oc.renglones) {
            if (!out[x.articulo_id]) continue
            out[x.articulo_id] = { cantidad: x.cantidad_pedida, tipo: x.tipo_cantidad, precio: x.precio_unitario, d1: x.descuentos[0], d2: x.descuentos[1], d3: x.descuentos[2], d4: x.descuentos[3] }
          }
          return out
        })
      } else if (inicio?.proveedorId) {
        extras.current = (inicio.importados || []).map((i) => i.articulo_id)
        const p = await preparar(inicio.proveedorId, { conservar: false, aplicar: !!inicio.aplicarSugerencia })
        if (!vivo || !p || !inicio.importados?.length) return
        const unidad = inicio.unidadImportada === "unidad" ? "unidad" : "bulto"
        const ubDe = new Map(p.articulos.map((a) => [a.id, a.unidades_por_bulto]))
        setFilas((prev) => {
          const out = { ...prev }
          for (const i of inicio.importados!) {
            const base = out[i.articulo_id]
            if (!base) continue
            // las cantidades del archivo se suman si el artículo viene repetido
            out[i.articulo_id] = {
              ...base, tipo: unidad, cantidad: (base.cantidad || 0) + (Number(i.cantidad) || 0),
              precio: i.precio != null && i.precio > 0 ? precioPorUnidad(i.precio, inicio.precioImportadoPor, ubDe.get(i.articulo_id) ?? 1) : base.precio,
              d1: i.descuento1 != null && i.descuento1 > 0 ? i.descuento1 : base.d1,
            }
          }
          return out
        })
      }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, inicio])

  const elegirProveedor = (p: any | null) => {
    if (!p) { setProveedor(null); setPrep(null); setFilas({}); return }
    extras.current = []
    setProveedor({ id: p.id, nombre: p.nombre })
    preparar(p.id, { conservar: false })
  }

  const cambiarFila = useCallback((id: string, cambio: Partial<Fila>) => {
    setFilas((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...cambio } } : prev))
  }, [])

  const articulos = prep?.articulos ?? []
  const porId = useMemo(() => new Map(articulos.map((a) => [a.id, a])), [articulos])

  const usarSugerencia = useCallback((id: string) => {
    const a = porId.get(id)
    if (!a) return
    setFilas((prev) => {
      const f = prev[id]
      if (!f) return prev
      const cantidad = f.tipo === "bulto" ? bultosParaCubrir(a.sugerido, a.unidades_por_bulto) : a.sugerido
      return { ...prev, [id]: { ...f, cantidad } }
    })
  }, [porId])

  const usarTodasLasSugerencias = () => {
    setFilas((prev) => {
      const out = { ...prev }
      for (const a of articulos) {
        const f = out[a.id]
        if (!f || !(a.sugerido > 0) || f.cantidad > 0) continue
        out[a.id] = { ...f, cantidad: f.tipo === "bulto" ? bultosParaCubrir(a.sugerido, a.unidades_por_bulto) : a.sugerido }
      }
      return out
    })
    setSoloConCantidad(true)
  }

  const agregarArticulo = async (art: any | null) => {
    if (!art || !proveedor) return
    setAgregar(false)
    if (porId.has(art.id)) { toast.info("Ese artículo ya está en la lista."); setBusca(art.descripcion || ""); return }
    extras.current = [...extras.current, art.id]
    await preparar(proveedor.id, { conservar: true })
    setBusca(art.descripcion || "")
  }

  /** Vincular un renglón del archivo a un artículo del catálogo (E-13) */
  const vincular = async (indice: number, art: any | null) => {
    if (!art || !proveedor) return
    const pendiente = sinArticulo[indice]
    let ub = porId.get(art.id)?.unidades_por_bulto ?? 1
    if (!porId.has(art.id)) {
      extras.current = [...extras.current, art.id]
      const p = await preparar(proveedor.id, { conservar: true })
      ub = p?.articulos.find((a) => a.id === art.id)?.unidades_por_bulto ?? 1
    }
    const unidad = inicio?.unidadImportada === "unidad" ? "unidad" : "bulto"
    setFilas((prev) => {
      const base = prev[art.id]
      if (!base) return prev
      return { ...prev, [art.id]: { ...base, tipo: unidad, cantidad: (base.cantidad || 0) + pendiente.cantidad, precio: pendiente.precio > 0 ? precioPorUnidad(pendiente.precio, inicio?.precioImportadoPor, ub) : base.precio } }
    })
    setSinArticulo((l) => l.filter((_, i) => i !== indice))
    toast.success(`"${pendiente.descripcion}" quedó vinculado a ${art.descripcion}.`)
  }

  const conCantidad = useMemo(() => articulos.filter((a) => (filas[a.id]?.cantidad ?? 0) > 0), [articulos, filas])
  const totales = useMemo(
    () => totalesOC(conCantidad.map((a) => renglonDe(a, filas[a.id])), prep ? { ...prep.proveedor, mixto_pct_factura: mixtoPct } : null),
    [conCantidad, filas, prep, mixtoPct],
  )
  const haySugerencias = articulos.some((a) => a.sugerido > 0)

  const visibles = useMemo(() => articulos.filter((a) => {
    const f = filas[a.id]
    if (soloConCantidad && !((f?.cantidad ?? 0) > 0)) return false
    if (soloSugeridos && !(a.sugerido > 0) && !((f?.cantidad ?? 0) > 0)) return false
    if (busca.trim() && !localMatch(busca, a.descripcion, a.sku, a.ean13)) return false
    return true
  }), [articulos, filas, soloConCantidad, soloSugeridos, busca])
  const mostradas = verTodas ? visibles : visibles.slice(0, TOPE_FILAS)

  // Cuándo se paga: lo mismo que va a generar la base como vencimientos estimados
  const pagos = useMemo(() => {
    if (!acuerdo || !fechaEntrega) return []
    // fecha de entrega ya pasada (orden vieja): el plazo corre desde hoy, igual que en la base
    const base = fechaEntrega < hoyISO() ? hoyISO() : fechaEntrega
    return [
      ...planDePagos(totales.total_blanco, base, acuerdoDelCanal(acuerdo, "blanco")).map((p) => ({ ...p, canal: "blanco" as const })),
      ...planDePagos(totales.total_negro, base, acuerdoDelCanal(acuerdo, "negro")).map((p) => ({ ...p, canal: "negro" as const })),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [acuerdo, fechaEntrega, totales.total_blanco, totales.total_negro])
  const hayNegro = totales.total_negro > 0
  const hayBlanco = totales.total_blanco > 0
  const sinPlazo = pagos.some((p) => p.sin_plazo)
  const deLegado = !!acuerdo && (!!acuerdo.blanco.de_legado || !!acuerdo.negro?.de_legado)

  const guardar = async (enviar: boolean) => {
    if (guardando || !proveedor) return
    if (conCantidad.length === 0) { toast.error("Poné cantidad en al menos un artículo."); return }
    if (!fechaEntrega) { toast.error("Falta la fecha estimada de entrega."); return }
    if (sinArticulo.length > 0) {
      toast.error(`Quedan ${sinArticulo.length} renglón(es) del archivo sin vincular a un artículo. Vinculalos o descartalos (están arriba de la tabla).`, { duration: 10000 })
      return
    }
    setGuardando(true)
    try {
      const res = await fetch("/api/ordenes-compra/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orden_id: ordenId, proveedor_id: proveedor.id, observaciones,
          fecha_estimada_recepcion: fechaEntrega, acuerdo_pago: acuerdo, mixto_pct_factura: mixtoPct, clave: clave.current || null,
          // las unidades por bulto y el régimen de IVA NO se mandan: los lee el servidor de la base (E-13)
          items: conCantidad.map((a) => {
            const f = filas[a.id]
            return { articulo_id: a.id, cantidad_pedida: f.cantidad, tipo_cantidad: f.tipo, precio_unitario: f.precio, descuento1: f.d1, descuento2: f.d2, descuento3: f.d3, descuento4: f.d4 }
          }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(`No se guardó la orden: ${data.error || `error ${res.status}`}`, { duration: 12000 }); return }
      toast.success(ordenId
        ? `Orden ${data.numeroOrden} actualizada. Total estimado ${moneda(data.totales?.total)}.`
        : `Orden ${data.numeroOrden} creada. Entrega estimada ${fecha(data.fechaEstimada)} · total ${moneda(data.totales?.total)}.`)
      onGuardada({ ordenId: data.orden?.id, numero: data.numeroOrden, enviar })
    } catch {
      toast.error("No se pudo confirmar si la orden se guardó (se cortó la conexión). Mirá el listado antes de volver a intentar.", { duration: 15000 })
    } finally { setGuardando(false) }
  }

  const textoEntrega = prep
    ? prep.entrega.origen === "historial" ? `Este proveedor tarda ${prep.entrega.dias} días en promedio (últimas ${prep.entrega.muestras} recepciones).`
      : prep.entrega.origen === "ficha" ? `Según la ficha del proveedor tarda ${prep.entrega.dias} días.`
      : "No hay recepciones anteriores ni días de entrega en la ficha: se proponen 7 días."
    : ""

  return (
    <Dialog open={abierto} onOpenChange={(a) => { if (!a && !guardando) onCerrar() }}>
      <DialogContent className="z-[100] flex h-[96vh] w-full flex-col gap-0 p-0 sm:max-w-[98vw]">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>{ordenId ? `Editar la orden ${numeroOrden ?? ""}` : "Nueva orden de compra"}{proveedor ? <span className="font-normal text-muted-foreground"> — {proveedor.nombre}</span> : null}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-3">
          {!ordenId && (
            <div className="max-w-xl">
              <Label>Proveedor</Label>
              <EntitySearchSelect entity="proveedores" placeholder="Buscar proveedor…" value={proveedor as any} onSelect={elegirProveedor} disabled={guardando} autoFocus={!proveedor} />
            </div>
          )}

          {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {cargando && !prep && <CargaProgreso mensajes={["Buscando los artículos del proveedor…", "Mirando stock y mercadería en camino…", "Sumando las ventas del período…", "Calculando la sugerencia…", "Ya casi está…"]} />}

          {prep && acuerdo && (
            <>
              {/* Entrega y pago */}
              <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_2fr]">
                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Fecha estimada de entrega</div>
                  <DateInputAR value={fechaEntrega} onChange={setFechaEntrega} className="h-9 w-40" />
                  <div className="mt-1 text-xs text-muted-foreground">{textoEntrega}</div>
                  {fechaEntrega && fechaEntrega < hoyISO() && <div className="mt-1 text-xs font-semibold text-red-600">La fecha es anterior a hoy.</div>}
                </div>

                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Condición de pago de esta orden</div>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditarPago((v) => !v)}>{editarPago ? "Listo" : "Cambiar"}</Button>
                  </div>
                  {!editarPago && (
                    <div className="text-sm">
                      {(hayBlanco || !hayNegro) && <div>{hayNegro && <b>Con factura: </b>}{textoCanal(acuerdoDelCanal(acuerdo, "blanco"))}</div>}
                      {hayNegro && <div><b>Sin factura: </b>{textoCanal(acuerdoDelCanal(acuerdo, "negro"))}</div>}
                    </div>
                  )}
                  {editarPago && (
                    <div className="space-y-2">
                      <EditorCanal titulo="Lo que viene con factura" c={acuerdo.blanco} onChange={(c) => setAcuerdo({ ...acuerdo, blanco: { ...c, de_legado: undefined } })} />
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={!acuerdo.negro} onCheckedChange={(v) => setAcuerdo({ ...acuerdo, negro: v ? null : { ...canalVacio(), ...acuerdo.blanco } })} />
                        Lo que viene sin factura se paga igual
                      </label>
                      {acuerdo.negro && <EditorCanal titulo="Lo que viene sin factura" c={acuerdo.negro} onChange={(c) => setAcuerdo({ ...acuerdo, negro: c })} />}
                      <div className="text-xs text-muted-foreground">Viene de la ficha del proveedor. Lo que cambies acá vale solo para esta orden.</div>
                    </div>
                  )}
                  {pagos.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2 text-sm">
                      <span className="text-xs font-semibold text-muted-foreground">Se pagaría:</span>
                      {pagos.map((p, i) => (
                        <span key={i} className="rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 tabular-nums">
                          <b>{fecha(p.fecha)}</b> · {moneda(p.monto)}{p.forma_pago ? ` · ${p.forma_pago}` : ""}{hayNegro && hayBlanco ? ` · ${p.canal === "blanco" ? "con factura" : "sin factura"}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {totales.hay_mixto && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                      <span>Artículos <b>mixtos</b>: viene con factura el</span>
                      <InputMonto decimales={0} soloPositivos className="h-7 w-16 text-right" value={mixtoPct} placeholder="50"
                        onChange={(v) => setMixtoPct(v == null ? null : Math.min(100, Math.max(0, v)))} aria-label="Porcentaje con factura de los artículos mixtos" />
                      <span>% (el resto, sin factura).</span>
                      {mixtoPct == null && <span className="text-xs font-medium text-amber-700">El proveedor no tiene cargado este porcentaje: se toma 50 %. Cargalo en su ficha.</span>}
                    </div>
                  )}
                  {deLegado && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Acuerdo de pago sin cargar: el plazo salió del dato viejo de la ficha del proveedor. Revisalo con “Cambiar” y cargá el acuerdo en la ficha fiscal.
                    </div>
                  )}
                  {sinPlazo && conCantidad.length > 0 && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      El proveedor no tiene plazo de pago cargado: el vencimiento queda en la fecha de entrega. Tocá “Cambiar” para ponerlo en esta orden, o cargalo en la ficha fiscal.
                    </div>
                  )}
                  {pagos.length > 0 && <div className="mt-1 text-xs text-muted-foreground">Al guardar quedan en el calendario como vencimientos <b>estimados</b>; se reemplazan por el real cuando se valida la factura.</div>}
                </div>
              </div>

              {/* Renglones del archivo sin artículo: a revisión (E-13) */}
              {sinArticulo.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4" /> {sinArticulo.length} renglón(es) del archivo sin artículo: vinculalos o descartalos
                  </div>
                  <div className="space-y-2">
                    {sinArticulo.map((s, i) => (
                      <div key={`${s.descripcion}-${i}`} className="grid items-center gap-2 rounded-md bg-background p-2 text-sm md:grid-cols-[1fr_minmax(280px,1fr)_auto]">
                        <div>
                          <div className="font-medium">{s.descripcion || "(sin descripción)"}</div>
                          <div className="text-xs text-muted-foreground">{s.codigo ? `Código ${s.codigo} · ` : ""}cantidad {numero(s.cantidad, 0, 2)}{s.precio > 0 ? ` · ${moneda(s.precio)}` : ""}</div>
                        </div>
                        <EntitySearchSelect entity="articulos" placeholder="Buscar el artículo del catálogo…" value={null} onSelect={(art: any) => vincular(i, art)} compact />
                        <Button variant="ghost" size="sm" onClick={() => setSinArticulo((l) => l.filter((_, j) => j !== i))}><X className="mr-1 h-4 w-4" /> Descartar</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sugerencia y filtros */}
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border bg-blue-50/60 p-3">
                <div>
                  <Label className="text-xs">Venta desde</Label>
                  <DateInputAR value={desde} onChange={setDesde} className="h-8 w-32 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">hasta</Label>
                  <DateInputAR value={hasta} onChange={setHasta} className="h-8 w-32 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Se cuenta lo</Label>
                  <Select value={tipoVenta} onValueChange={(v) => setTipoVenta(v === "facturada" ? "facturada" : "vendida")}>
                    <SelectTrigger className="h-8 w-28 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="vendida">vendido</SelectItem><SelectItem value="facturada">facturado</SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Stock para (días)</Label>
                  <InputMonto decimales={0} soloPositivos className="h-8 w-20 text-sm" value={diasObjetivo} onChange={(v) => setDiasObjetivo(Math.min(365, Math.max(1, Math.trunc(v ?? 45))))} />
                </div>
                <Button variant="outline" size="sm" disabled={cargando} onClick={() => proveedor && preparar(proveedor.id, { conservar: true })}>
                  {cargando ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Calculando…</> : "Recalcular sugerencia"}
                </Button>
                {haySugerencias && <Button variant="outline" size="sm" onClick={usarTodasLasSugerencias}>Usar todas las sugerencias</Button>}
                <div className="ml-auto text-xs text-muted-foreground">
                  Sugerido = venta por día × {prep.periodo.dias_objetivo} días − stock − en camino ({prep.periodo.dias} días de venta).
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Filtrar por descripción, SKU o código de barras…" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9 pl-9" />
                </div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={soloSugeridos} onCheckedChange={(c) => setSoloSugeridos(!!c)} /> Solo sugeridos</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={soloConCantidad} onCheckedChange={(c) => setSoloConCantidad(!!c)} /> Solo con cantidad ({conCantidad.length})</label>
                {agregar
                  ? <div className="w-80"><EntitySearchSelect entity="articulos" placeholder="Buscar artículo de otro proveedor…" value={null} onSelect={agregarArticulo} compact autoFocus /></div>
                  : <Button variant="outline" size="sm" onClick={() => setAgregar(true)}><Plus className="mr-1.5 h-4 w-4" /> Agregar artículo de otro proveedor</Button>}
              </div>

              {articulos.length === 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-900">
                  Este proveedor no tiene artículos asignados. Agregá artículos con el botón de arriba, o asignale el proveedor en la ficha de cada artículo.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead className="sticky top-0 z-10 bg-muted text-xs">
                      <tr className="border-b text-left">
                        <th className="px-2 py-2 font-semibold">Artículo</th>
                        <th className="px-2 py-2 text-right font-semibold">Stock</th>
                        <th className="px-2 py-2 text-right font-semibold">En camino</th>
                        <th className="px-2 py-2 text-right font-semibold">Venta del período</th>
                        <th className="px-2 py-2 text-center font-semibold">Sugerido</th>
                        <th className="px-2 py-2 font-semibold">Pedir</th>
                        <th className="px-2 py-2 font-semibold">Lista por UNIDAD y descuentos % <span className="font-normal text-muted-foreground">({prep.proveedor.tipo_descuento === "sobre_lista" ? "se suman, sobre lista" : "en cascada"})</span></th>
                        <th className="px-2 py-2 text-right font-semibold">Neto por unidad</th>
                        <th className="px-2 py-2 text-right font-semibold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mostradas.map((a) => <FilaArticulo key={a.id} a={a} f={filas[a.id] ?? filaDe(a)} tipo={prep.proveedor.tipo_descuento} onCambio={cambiarFila} onUsar={usarSugerencia} />)}
                      {mostradas.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Ningún artículo coincide con el filtro.</td></tr>}
                    </tbody>
                  </table>
                  {visibles.length > mostradas.length && (
                    <div className="border-t p-2 text-center text-sm">
                      Se muestran {mostradas.length} de {visibles.length} artículos.{" "}
                      <button type="button" className="font-semibold text-primary underline" onClick={() => setVerTodas(true)}>Mostrar todos</button> (o usá el filtro)
                    </div>
                  )}
                </div>
              )}

              <div className="max-w-3xl">
                <Label>Observaciones (salen en la orden que recibe el proveedor)</Label>
                <Input placeholder="Horario de entrega, transporte, aclaraciones…" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
              </div>
            </>
          )}
        </div>

        {/* Totales y acciones: siempre a la vista */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
            <span><b>{conCantidad.length}</b> artículos · <b>{entero(totales.unidades)}</b> unidades</span>
            <span>Sin impuestos <b>{moneda(totales.neto)}</b></span>
            <span className="text-muted-foreground">IVA {moneda(totales.iva)}{totales.percepciones > 0 ? ` · percepciones ${moneda(totales.percepciones)}` : ""}</span>
            <span className="text-base">Total estimado <b className="text-lg">{moneda(totales.total)}</b></span>
            {hayNegro && <span className="text-xs text-muted-foreground">con factura {moneda(totales.total_blanco)} · sin factura {moneda(totales.total_negro)}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cerrar sin guardar</Button>
            <Button variant="outline" onClick={() => guardar(false)} disabled={guardando || !prep || conCantidad.length === 0}>
              {guardando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando…</> : ordenId ? "Guardar cambios" : "Guardar la orden"}
            </Button>
            <Button onClick={() => guardar(true)} disabled={guardando || !prep || conCantidad.length === 0}>
              <Send className="mr-2 h-4 w-4" /> {guardando ? "Guardando…" : "Guardar y enviar al proveedor"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
