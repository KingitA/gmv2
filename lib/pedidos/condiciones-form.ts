// Formulario de CONDICIONES de un pedido (puro, sin DB ni React): lo comparten
// las tres entradas de pedidos del ERP (importación, alta manual, mostrador) a
// través de components/pedidos/CondicionesPedidoPanel.tsx.
//
// Se arma desde la ficha comercial del cliente. Lo que el usuario cambia se
// aplica "solo a este pedido" (overrides del pedido) o se guarda en la ficha.
// Un 0 explícito en un descuento significa "sin ese descuento en este pedido".

import type { CondRow, SegmentacionValue } from "@/components/pedidos/SegmentacionCondiciones"

export const SEGS = ["limpieza_bazar", "perf0", "perf_plus"] as const
export type Seg = (typeof SEGS)[number]
export const SEG_LABEL: Record<Seg, string> = {
  limpieza_bazar: "Limpieza / Bazar",
  perf0: "Perfumería 0",
  perf_plus: "Perfumería plus",
}
export const TIPOS_DESC = ["general", "viajante", "mercaderia"] as const
export type TipoDesc = (typeof TIPOS_DESC)[number]

const LISTA_COL: Record<Seg, string> = { limpieza_bazar: "lista_limpieza_id", perf0: "lista_perf0_id", perf_plus: "lista_perf_plus_id" }
const METODO_COL: Record<Seg, string> = { limpieza_bazar: "metodo_limpieza", perf0: "metodo_perf0", perf_plus: "metodo_perf_plus" }
const LISTA_PED: Record<Seg, string> = { limpieza_bazar: "lista_limpieza_pedido_id", perf0: "lista_perf0_pedido_id", perf_plus: "lista_perf_plus_pedido_id" }
const METODO_PED: Record<Seg, string> = { limpieza_bazar: "metodo_limpieza_pedido", perf0: "metodo_perf0_pedido", perf_plus: "metodo_perf_plus_pedido" }

const CENTINELAS = new Set(["PorSegmento", "porsegmento", "__por_segmento__", "por_segmento", "__none__", "__heredar__"])
const limpio = (v: unknown): string => (typeof v === "string" && v && !CENTINELAS.has(v) ? v : "")

export interface FichaComercial {
  cliente: Record<string, any>
  /** filas activas sin proveedor: general / viajante / mercaderia / contado */
  bonificaciones: Array<{ tipo: string; segmento: string | null; porcentaje: number }>
  proveedor: CondRow[]
  marca: CondRow[]
}

export type ArticuloElegido = { id: string; descripcion: string; sku: string }

export interface CondicionesForm {
  listaPorSegmento: boolean
  lista: string
  listas: Record<Seg, string>
  metodoPorSegmento: boolean
  metodo: string
  metodos: Record<Seg, string>
  descPorSegmento: boolean
  /** `${seg|"todos"}__${general|viajante|mercaderia}` → % */
  desc: Record<string, number>
  /** `${seg|"todos"}` → sale de contado */
  contado: Record<string, boolean>
  segmentacion: SegmentacionValue
  /** cupo de mercadería → artículos a regalar */
  mercaderia: Record<string, ArticuloElegido[]>
}

export function formDesdeFicha(f: FichaComercial): CondicionesForm {
  const c = f.cliente || {}
  const desc: Record<string, number> = {}
  const contado: Record<string, boolean> = {}
  let descSeg = false
  for (const b of f.bonificaciones || []) {
    const k = b.segmento || "todos"
    if (b.segmento) descSeg = true
    if (b.tipo === "contado") contado[k] = Number(b.porcentaje) > 0
    else desc[`${k}__${b.tipo}`] = Number(b.porcentaje) || 0
  }
  const listas = Object.fromEntries(SEGS.map((s) => [s, limpio(c[LISTA_COL[s]])])) as Record<Seg, string>
  const metodos = Object.fromEntries(SEGS.map((s) => [s, limpio(c[METODO_COL[s]])])) as Record<Seg, string>
  return {
    listaPorSegmento: SEGS.some((s) => !!listas[s]),
    lista: limpio(c.lista_precio_id),
    listas,
    metodoPorSegmento: SEGS.some((s) => !!metodos[s]) || CENTINELAS.has(String(c.metodo_facturacion || "")),
    metodo: limpio(c.metodo_facturacion),
    metodos,
    descPorSegmento: descSeg,
    desc,
    contado,
    segmentacion: { proveedor: f.proveedor || [], marca: f.marca || [] },
    mercaderia: {},
  }
}

// ── Valores efectivos ───────────────────────────────────────────────────────
export function listaEfectiva(form: CondicionesForm, seg: Seg): string {
  return (form.listaPorSegmento ? form.listas[seg] : "") || form.lista
}
export function metodoEfectivo(form: CondicionesForm, seg: Seg): string {
  return (form.metodoPorSegmento ? form.metodos[seg] : "") || form.metodo || "Final"
}
export function descEfectivo(form: CondicionesForm, seg: Seg, tipo: TipoDesc): number {
  return Number(form.desc[`${form.descPorSegmento ? seg : "todos"}__${tipo}`]) || 0
}
export function contadoEfectivo(form: CondicionesForm, seg: Seg): boolean {
  return !!form.contado[form.descPorSegmento ? seg : "todos"]
}

/** Regla del dueño: nunca se toma un pedido sin lista. null = OK; si no, el motivo. */
export function faltaLista(form: CondicionesForm): string | null {
  const sin = SEGS.filter((s) => !listaEfectiva(form, s))
  if (!sin.length) return null
  return sin.length === SEGS.length
    ? "El cliente no tiene lista de precios asignada: elegí una antes de tomar el pedido."
    : `Falta la lista de: ${sin.map((s) => SEG_LABEL[s]).join(", ")}.`
}

// ── Comparación con la ficha (¿cambió algo?) ────────────────────────────────
function firma(form: CondicionesForm) {
  const seg = (rows: CondRow[]) =>
    [...rows].sort((a, b) => a.ref_id.localeCompare(b.ref_id)).map((r) => [
      r.ref_id, r.lista_precio_id || "", r.metodo_facturacion || "",
      r.dto_general_pct ?? "", r.dto_viajante_pct ?? "", r.dto_mercaderia_pct ?? "", r.contado ?? "",
    ])
  return JSON.stringify({
    listas: SEGS.map((s) => listaEfectiva(form, s)),
    metodos: SEGS.map((s) => metodoEfectivo(form, s)),
    desc: SEGS.map((s) => TIPOS_DESC.map((t) => descEfectivo(form, s, t))),
    contado: SEGS.map((s) => contadoEfectivo(form, s)),
    merTodo: form.descPorSegmento ? null : Number(form.desc["todos__mercaderia"]) || 0,
    prov: seg(form.segmentacion.proveedor),
    marca: seg(form.segmentacion.marca),
  })
}

export function cambioVsFicha(form: CondicionesForm, ficha: FichaComercial): boolean {
  return firma(form) !== firma(formDesdeFicha(ficha))
}

// ── Cupos de mercadería posibles (para elegir qué regalar) ──────────────────
export function cuposPosibles(form: CondicionesForm, nombres: { proveedor: Record<string, string>; marca: Record<string, string> } = { proveedor: {}, marca: {} }) {
  const out: Array<{ origen: string; nombre: string; pct: number }> = []
  if (form.descPorSegmento) {
    for (const s of SEGS) {
      const pct = Number(form.desc[`${s}__mercaderia`]) || 0
      if (pct > 0) out.push({ origen: `seg:${s}`, nombre: SEG_LABEL[s], pct })
    }
  } else {
    const pct = Number(form.desc["todos__mercaderia"]) || 0
    if (pct > 0) out.push({ origen: "todo", nombre: "Todo el pedido", pct })
  }
  for (const r of form.segmentacion.proveedor) {
    if ((Number(r.dto_mercaderia_pct) || 0) > 0) out.push({ origen: `prov:${r.ref_id}`, nombre: `Proveedor ${nombres.proveedor[r.ref_id] || r.nombre}`, pct: Number(r.dto_mercaderia_pct) })
  }
  for (const r of form.segmentacion.marca) {
    if ((Number(r.dto_mercaderia_pct) || 0) > 0) out.push({ origen: `marca:${r.ref_id}`, nombre: `Marca ${nombres.marca[r.ref_id] || r.nombre}`, pct: Number(r.dto_mercaderia_pct) })
  }
  return out
}

/** Cupos posibles sin artículos elegidos (el pedido quedaría con la mercadería pendiente). */
export function cuposSinArticulos(form: CondicionesForm): string[] {
  return cuposPosibles(form).filter((c) => !(form.mercaderia[c.origen]?.length)).map((c) => c.nombre)
}

// ── Hacia createPedido ──────────────────────────────────────────────────────
const condRows = (rows: CondRow[], campo: "proveedor_id" | "marca_id") =>
  rows.map((r) => ({
    [campo]: r.ref_id,
    lista_precio_id: r.lista_precio_id || null,
    metodo_facturacion: r.metodo_facturacion || null,
    dto_general_pct: r.dto_general_pct,
    dto_viajante_pct: r.dto_viajante_pct,
    dto_mercaderia_pct: r.dto_mercaderia_pct,
    contado: r.contado ?? null,
  }))

/**
 * Parámetros de createPedido. Si nada cambió respecto de la ficha, solo viaja la
 * segmentación (lista completa) y la mercadería elegida: el pedido congela la
 * ficha. Si cambió, viajan las condiciones COMPLETAS como "solo este pedido"
 * (con los 0 explícitos), así el pedido queda igual aunque después cambie la ficha.
 */
export function condicionesParaPedido(form: CondicionesForm, cambio: boolean): Record<string, any> {
  const out: Record<string, any> = {
    condiciones_proveedor: condRows(form.segmentacion.proveedor, "proveedor_id"),
    condiciones_marca: condRows(form.segmentacion.marca, "marca_id"),
  }
  const merc = Object.entries(form.mercaderia)
    .filter(([, arts]) => arts.length)
    .map(([origen, arts]) => ({ origen, articulo_ids: arts.map((a) => a.id) }))
  if (merc.length) out.mercaderia_bonificada = merc
  if (!cambio) return out

  if (form.lista) out.lista_precio_pedido_id = form.lista
  if (form.metodo) out.metodo_facturacion_pedido = form.metodo
  for (const s of SEGS) {
    if (form.listaPorSegmento && form.listas[s]) out[LISTA_PED[s]] = form.listas[s]
    if (form.metodoPorSegmento && form.metodos[s]) out[METODO_PED[s]] = form.metodos[s]
  }
  const porSeg = (tipo: TipoDesc) => Object.fromEntries(SEGS.map((s) => [s, descEfectivo(form, s, tipo)]))
  out.bonif_pedido = {
    general: porSeg("general"),
    viajante: porSeg("viajante"),
    ...(form.descPorSegmento ? { mercaderia: porSeg("mercaderia") } : {}),
    contado: Object.fromEntries(SEGS.map((s) => [s, contadoEfectivo(form, s) ? 10 : 0])),
  }
  if (!form.descPorSegmento) out.bonif_mercaderia_pct = Number(form.desc["todos__mercaderia"]) || 0
  return out
}

// ── Hacia la ficha (lib/actions/condiciones-cliente.ts) ─────────────────────
export function listasParaFicha(form: CondicionesForm) {
  return {
    metodo_facturacion: form.metodoPorSegmento ? null : form.metodo || null,
    lista_precio_id: form.lista || null,
    lista_limpieza_id: form.listaPorSegmento ? form.listas.limpieza_bazar || null : null,
    metodo_limpieza: form.metodoPorSegmento ? form.metodos.limpieza_bazar || null : null,
    lista_perf0_id: form.listaPorSegmento ? form.listas.perf0 || null : null,
    metodo_perf0: form.metodoPorSegmento ? form.metodos.perf0 || null : null,
    lista_perf_plus_id: form.listaPorSegmento ? form.listas.perf_plus || null : null,
    metodo_perf_plus: form.metodoPorSegmento ? form.metodos.perf_plus || null : null,
  }
}

export function descuentosParaFicha(form: CondicionesForm) {
  const valores: Record<string, number> = { ...form.desc }
  for (const [k, v] of Object.entries(form.contado)) valores[`${k}__contado`] = v ? 10 : 0
  return { porSegmento: form.descPorSegmento, valores }
}

export function segmentacionParaFicha(form: CondicionesForm) {
  const map = (rows: CondRow[]) => rows.map((r) => ({
    ref_id: r.ref_id,
    lista_precio_id: r.lista_precio_id || null,
    metodo_facturacion: r.metodo_facturacion || null,
    dto_general_pct: r.dto_general_pct,
    dto_viajante_pct: r.dto_viajante_pct,
    dto_mercaderia_pct: r.dto_mercaderia_pct,
    contado: r.contado ?? null,
  }))
  return { proveedor: map(form.segmentacion.proveedor), marca: map(form.segmentacion.marca) }
}
