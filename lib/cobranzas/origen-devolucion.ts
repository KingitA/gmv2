import type { SupabaseClient } from "@supabase/supabase-js"
import { calcularPercepciones, type ClientePercepcion } from "@/lib/comprobantes/calcular-percepciones"
import { resolverAlicuotaIIBB } from "@/lib/comprobantes/percepcion-iibb"
import { cargarMarcasBonificacion, separarYaBonificados } from "@/lib/comprobantes/ya-bonificados"
import { ARTICULO_PRECIO_COLS, cargarInsumosCliente } from "@/lib/pricing/cargar-insumos"
import { descuentosPorArticulo, prepararMotorCliente, type ArticuloMotor } from "@/lib/pricing/motor"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { hoyISO } from "@/lib/formato"
import { NUMERO_RESPALDO_DEVOLUCION } from "./respaldo-devolucion"
import {
  elegirOrigenDevolucion,
  type ContextoDevolucion,
  type OrigenDevolucion,
} from "@/lib/cobranzas/valor-devolucion"

/**
 * DE DÓNDE VIENE un artículo devuelto (regla del dueño, 21/10/2026) — servidor.
 *
 * Cada renglón de una devolución se asocia a UN comprobante de venta y se valúa
 * como fue facturado ahí (lib/cobranzas/valor-devolucion.ts):
 *  1. lo entregado en el pedido del viaje → el comprobante de ESE pedido;
 *  2. si el artículo está en un comprobante del sistema → el último, exacto
 *     (precio neto e IVA del renglón; el precio no se puede tocar);
 *  3. si no (comprobante importado del sistema viejo, que solo tiene número,
 *     tipo y fecha, o artículo nunca facturado), según cómo va hoy ese artículo
 *     para ese cliente (motor de precios: cliente todo facturado ⇒ NC A/B aunque
 *     el artículo sea de presupuesto). Precio sugerido: el neto actual del cliente.
 *     - va en NEGRO → la REV se asocia al PRES de respaldo 0002-00000001 del
 *       cliente (regla de Juan 26/10, #28). Antes iba al PRES más reciente, que
 *       no tenía el artículo, y le bajaba la comisión (URQUIZA, PRES 0001-00000020).
 *       El respaldo se crea al guardar la devolución, en $0 y sin renglones.
 *     - va en BLANCO → la NC sale SIN comprobante asociado, ni en ARCA ni en el
 *       sistema (Juan 26/10: no se le miente a nadie). A ARCA se le informa el
 *       período (PeriodoAsoc, RG 4540; generar-nc-reversa). Antes se asociaba a
 *       la factura más reciente, que no tenía el artículo.
 *
 * Percepción IVA: la lleva la NC si el comprobante de origen la llevaba (neto
 * de ese comprobante por encima del mínimo y cliente RI no excluido).
 * Percepción IIBB: alícuota vigente hoy.
 */

const FISCALES = ["FA", "FB", "FC"]

/** #28: PRES de respaldo, uno por cliente (respaldo-devolucion.ts) */
export { NUMERO_RESPALDO_DEVOLUCION }
const OBS_RESPALDO = "RESPALDO DEVOLUCIONES — comprobante en $0 para asociar devoluciones de artículos sin comprobante de origen (#28)"
const VENTAS = [...FISCALES, "PRES"]
const r2 = (n: number) => Math.round(n * 100) / 100

type ClienteDev = ClientePercepcion & {
  cuit?: string | null
  metodo_facturacion?: string | null
  metodo_limpieza?: string | null
  metodo_perf0?: string | null
  metodo_perf_plus?: string | null
}

const CLIENTE_COLS = "id, cuit, condicion_iva, exento_iva, exento_iibb, provincia, percepcion_iibb, metodo_facturacion, metodo_limpieza, metodo_perf0, metodo_perf_plus"

/**
 * Cómo está configurado el cliente (regla de Juan 26/10 para #28, R2/R9 27/10):
 *  - "negro": todos sus segmentos van por Presupuesto, o no tiene CUIT (sin CUIT
 *    no hay comprobante fiscal) → lo devuelto sale con REV;
 *  - "blanco": todos sus segmentos van por Factura → sale con NC;
 *  - "mixto": "Final" o segmentos distintos → depende de cada artículo.
 * Método por segmento = el del segmento o, si no tiene, el general (mismo criterio
 * que el motor de precios: vacío = "Final").
 */
export function configuracionCliente(c: ClienteDev): "negro" | "blanco" | "mixto" {
  if (!c.cuit || !String(c.cuit).trim() || /^0{2}-?0{8}-?0$/.test(String(c.cuit).trim())) return "negro"
  const gen = c.metodo_facturacion && c.metodo_facturacion !== "PorSegmento" ? c.metodo_facturacion : null
  const clase = (raw: string | null | undefined) => {
    const m = raw || gen
    if (m === "Presupuesto") return "negro"
    if (m === "Factura" || m === "Factura (21% IVA)") return "blanco"
    return "mixto"
  }
  const segs = [clase(c.metodo_limpieza), clase(c.metodo_perf0), clase(c.metodo_perf_plus)]
  if (segs.every((s) => s === "negro")) return "negro"
  if (segs.every((s) => s === "blanco")) return "blanco"
  return "mixto"
}

/**
 * Cómo va un artículo cuando el motor de precios no lo pudo resolver (sin precio
 * calculable): manda la configuración del cliente. Mixto → no se sabe (null):
 * NUNCA "factura" por defecto (R2 27/10, riesgo de NC con CAE sin querer).
 */
function vaPorCliente(c: ClienteDev): "factura" | "presupuesto" | null {
  const conf = configuracionCliente(c)
  return conf === "negro" ? "presupuesto" : conf === "blanco" ? "factura" : null
}

/** elegirOrigenDevolucion con el "cómo va" ya resuelto; si no se sabe, presupuesto marcado indeterminado. */
function elegirConVa(exacto: OrigenDevolucion | null, contexto: ContextoDevolucion | null, va: "factura" | "presupuesto" | null): OrigenDevolucion {
  if (va) return elegirOrigenDevolucion(exacto, contexto, va)
  const o = elegirOrigenDevolucion(exacto, contexto, "presupuesto")
  return o.exacto ? o : { ...o, indeterminado: true }
}

async function leerCliente(supabase: SupabaseClient, clienteId: string, cliente?: ClienteDev | null): Promise<ClienteDev> {
  if (cliente && "cuit" in cliente) return cliente
  const { data } = await supabase.from("clientes").select(CLIENTE_COLS).eq("id", clienteId).single()
  return (data || {}) as ClienteDev
}

/** Alícuota IIBB vigente hoy para el cliente (%), 0 si no se le percibe (no RI, exento, Buenos Aires). */
export async function alicuotaIIBBVigente(supabase: SupabaseClient, cliente: ClienteDev): Promise<number> {
  let tasa = 0
  try {
    tasa = await resolverAlicuotaIIBB(supabase, cliente as any)
  } catch {
    tasa = Number(cliente.percepcion_iibb) || 0
  }
  // Mismas exclusiones que la emisión (calcularPercepciones), sin depender del monto
  return calcularPercepciones(1, { ...cliente, percepcion_iibb: tasa }, true).tasa_iibb_aplicada
}

/**
 * ¿El comprobante de origen llevó percepción IVA? Tal cual fue facturado:
 *  - emitido por este sistema (sale de un pedido): la que efectivamente llevó;
 *  - importado del sistema viejo (sin pedido ni percepción guardada): por regla,
 *    neto de ese comprobante por encima del mínimo y cliente RI no excluido.
 */
function llevoPercepcionIva(comp: CompRow, cliente: ClienteDev): boolean {
  if (Math.abs(Number(comp.percepcion_iva) || 0) > 0) return true
  if (comp.pedido_id) return false
  return calcularPercepciones(Math.abs(Number(comp.total_neto) || 0), cliente, true).percepcion_iva > 0
}

interface CompRow {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_neto: number | null
  percepcion_iva?: number | null
  pedido_id: string | null
  created_at?: string
}

function origenDe(comp: CompRow, cliente: ClienteDev, bonificados: Set<string>, extra: { exacto: boolean; precio: number | null; iva_unitario: number | null }): OrigenDevolucion {
  const fiscal = FISCALES.includes(comp.tipo_comprobante)
  return {
    comprobante_venta_id: comp.id,
    tipo_comprobante: comp.tipo_comprobante,
    numero_comprobante: comp.numero_comprobante,
    fiscal,
    percepcion_iva: fiscal && llevoPercepcionIva(comp, cliente),
    bonificado_contado: bonificados.has(comp.id),
    ...extra,
  }
}

async function bonificadosDe(supabase: SupabaseClient, clienteId: string, comps: CompRow[]): Promise<Set<string>> {
  if (!comps.length) return new Set()
  const marcas = await cargarMarcasBonificacion(supabase, clienteId, comps.map((c) => c.id))
  return new Set(separarYaBonificados(comps, marcas).yaBonificados.map((c) => c.id))
}

/**
 * IVA por unidad que llevó cada renglón de factura: la factura lo calcula como
 * precio_final − neto del renglón del pedido (generar/route.ts). Clave comp|articulo.
 */
async function ivaUnitarioDeRenglones(
  supabase: SupabaseClient,
  renglones: Array<{ comp: CompRow; articulo_id: string; precio_unitario: number }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const fiscales = renglones.filter((r) => FISCALES.includes(r.comp.tipo_comprobante) && r.comp.pedido_id)
  const pedidoIds = [...new Set(fiscales.map((r) => r.comp.pedido_id as string))]
  if (!pedidoIds.length) return out
  const filas: any[] = []
  for (let i = 0; i < pedidoIds.length; i += 100) {
    const { data } = await supabase
      .from("pedidos_detalle")
      .select("pedido_id, articulo_id, precio_final, precio_base, es_bonificado")
      .in("pedido_id", pedidoIds.slice(i, i + 100))
    filas.push(...(data || []))
  }
  for (const r of fiscales) {
    const candidatos = filas.filter((f) => f.pedido_id === r.comp.pedido_id && f.articulo_id === r.articulo_id && f.es_bonificado !== true)
    for (const f of candidatos) {
      const final = Number(f.precio_final) || 0
      const neto = Number(f.precio_base) > 0 ? Number(f.precio_base) : r2(final / 1.21)
      // El renglón del pedido que se facturó a ese precio neto
      if (Math.abs(neto - r.precio_unitario) < 0.005 && final > neto) {
        out.set(`${r.comp.id}|${r.articulo_id}`, r2(final - neto))
        break
      }
    }
  }
  return out
}

export interface CompradoOrigen extends OrigenDevolucion {
  articulo_id: string
  ultima_fecha: string
  cantidad_total: number
}

/** Artículos que el cliente compró (renglones de comprobantes del sistema) con su origen exacto: el último. */
export async function origenesComprados(supabase: SupabaseClient, clienteId: string, clienteIn?: ClienteDev | null): Promise<Map<string, CompradoOrigen>> {
  const cliente = await leerCliente(supabase, clienteId, clienteIn)
  // La FK de comprobantes_venta_detalle es `comprobante_id` (NO `comprobante_venta_id`)
  const rows = await fetchAllRows(() =>
    supabase
      .from("comprobantes_venta_detalle")
      .select(
        "articulo_id, cantidad, precio_unitario, es_bonificado, comprobante:comprobante_id!inner(id, cliente_id, fecha, created_at, tipo_comprobante, numero_comprobante, total_neto, percepcion_iva, pedido_id, anulado_en)",
      )
      .eq("comprobante.cliente_id", clienteId)
      .in("comprobante.tipo_comprobante", VENTAS)
      .is("comprobante.anulado_en", null),
  )
  // Último comprobante por artículo (renglones a $0 de mercadería bonificada no cuentan).
  // R9 (27/10, regla de Juan del #28): si el cliente está configurado todo negro
  // o todo blanco "manda el cliente": solo cuentan los comprobantes de su clase
  // (PRES o FA/FB/FC). Si no hay ninguno de esa clase con el artículo, va por el
  // camino sin comprobante (respaldo 0002-00000001 o NC con período).
  const conf = configuracionCliente(cliente)
  const ult = new Map<string, { comp: CompRow; precio_unitario: number; cantidad_total: number }>()
  for (const r of rows as any[]) {
    if (!r.articulo_id || !r.comprobante || r.es_bonificado === true || !(Number(r.precio_unitario) > 0)) continue
    const comp = r.comprobante as CompRow
    const esFiscal = FISCALES.includes(comp.tipo_comprobante)
    if ((conf === "negro" && esFiscal) || (conf === "blanco" && !esFiscal)) continue
    const clave = `${comp.fecha || ""}|${comp.created_at || ""}`
    const actual = ult.get(r.articulo_id)
    const claveActual = actual ? `${actual.comp.fecha || ""}|${actual.comp.created_at || ""}` : ""
    if (!actual || clave > claveActual) {
      ult.set(r.articulo_id, { comp, precio_unitario: Number(r.precio_unitario), cantidad_total: (actual?.cantidad_total || 0) + Number(r.cantidad || 0) })
    } else {
      actual.cantidad_total += Number(r.cantidad || 0)
    }
  }
  const comps = [...new Map([...ult.values()].map((u) => [u.comp.id, u.comp])).values()]
  const [bonificados, ivas] = await Promise.all([
    bonificadosDe(supabase, clienteId, comps),
    ivaUnitarioDeRenglones(supabase, [...ult.entries()].map(([articulo_id, u]) => ({ comp: u.comp, articulo_id, precio_unitario: u.precio_unitario }))),
  ])
  const out = new Map<string, CompradoOrigen>()
  for (const [articulo_id, u] of ult) {
    out.set(articulo_id, {
      ...origenDe(u.comp, cliente, bonificados, {
        exacto: true,
        precio: u.precio_unitario,
        iva_unitario: ivas.get(`${u.comp.id}|${articulo_id}`) ?? null,
      }),
      articulo_id,
      ultima_fecha: u.comp.fecha || "",
      cantidad_total: u.cantidad_total,
    })
  }
  return out
}

/** Contexto para valuar sin señal: alícuota IIBB vigente y comprobantes más recientes (fiscal / presupuesto). */
export async function contextoDevolucion(supabase: SupabaseClient, clienteId: string, clienteIn?: ClienteDev | null): Promise<ContextoDevolucion> {
  const cliente = await leerCliente(supabase, clienteId, clienteIn)
  const [alicuota, respaldo] = await Promise.all([alicuotaIIBBVigente(supabase, cliente), comprobanteRespaldo(supabase, clienteId)])
  const sinPrecio = { exacto: false, precio: null, iva_unitario: null }
  return {
    alicuota_iibb: alicuota,
    // Blanco sin comprobante con el artículo → sin asociado (NC con período a ARCA, #28)
    ultimo_fiscal: null,
    // Negro sin comprobante con el artículo → respaldo 0002-00000001 (#28). Si
    // todavía no existe va sin id: prepararRenglonesDevolucion lo crea al guardar.
    ultimo_presupuesto: respaldo
      ? origenDe(respaldo, cliente, new Set(), sinPrecio)
      : {
          comprobante_venta_id: null,
          tipo_comprobante: "PRES",
          numero_comprobante: NUMERO_RESPALDO_DEVOLUCION,
          fiscal: false,
          percepcion_iva: false,
          bonificado_contado: false,
          ...sinPrecio,
        },
  }
}

const RESPALDO_COLS = "id, tipo_comprobante, numero_comprobante, fecha, total_neto, percepcion_iva, pedido_id, created_at"

async function comprobanteRespaldo(supabase: SupabaseClient, clienteId: string): Promise<CompRow | null> {
  const { data } = await supabase
    .from("comprobantes_venta")
    .select(RESPALDO_COLS)
    .eq("cliente_id", clienteId)
    .eq("tipo_comprobante", "PRES")
    .eq("numero_comprobante", NUMERO_RESPALDO_DEVOLUCION)
    .is("anulado_en", null)
    .limit(1)
    .maybeSingle()
  return (data as CompRow | null) ?? null
}

/** El PRES de respaldo del cliente (#28): lo busca y, si no está, lo crea en $0 (sin libro mayor: no mueve saldo). */
export async function asegurarComprobanteRespaldo(supabase: SupabaseClient, clienteId: string): Promise<string> {
  const existente = await comprobanteRespaldo(supabase, clienteId)
  if (existente) return existente.id
  const { data, error } = await supabase
    .from("comprobantes_venta")
    .insert({
      cliente_id: clienteId,
      tipo_comprobante: "PRES",
      numero_comprobante: NUMERO_RESPALDO_DEVOLUCION,
      punto_venta: NUMERO_RESPALDO_DEVOLUCION.split("-")[0],
      fecha: hoyISO(),
      total_neto: 0,
      total_iva: 0,
      percepcion_iva: 0,
      percepcion_iibb: 0,
      total_factura: 0,
      saldo_pendiente: 0,
      estado_pago: "pagado",
      observaciones: OBS_RESPALDO,
    })
    .select("id")
    .single()
  // R9: dos devoluciones a la vez → el índice único frena la segunda; se usa el que creó la primera
  if (error?.code === "23505") {
    const ya = await comprobanteRespaldo(supabase, clienteId)
    if (ya) return ya.id
  }
  if (error || !data) throw new Error(`No se pudo crear el comprobante de respaldo ${NUMERO_RESPALDO_DEVOLUCION}: ${error?.message ?? "sin respuesta"}`)
  return data.id
}

/** Cómo va hoy cada artículo para el cliente (motor de precios) + precio sugerido (neto si factura). */
async function comoVaHoy(supabase: SupabaseClient, clienteId: string, articuloIds: string[]) {
  const out = new Map<string, { va: "factura" | "presupuesto"; precio: number; alCliente: number }>()
  if (!articuloIds.length) return out
  const [insumos, { data: articulos }, { data: desc }] = await Promise.all([
    cargarInsumosCliente(supabase, clienteId),
    supabase.from("articulos").select(ARTICULO_PRECIO_COLS).in("id", articuloIds),
    supabase.from("articulos_descuentos").select("articulo_id,tipo,porcentaje,orden").in("articulo_id", articuloIds).order("orden"),
  ])
  const porArt = descuentosPorArticulo(desc || [])
  const motor = prepararMotorCliente(insumos)
  for (const a of articulos || []) {
    try {
      const p = motor.precio({ ...(a as any), descuentos: porArt.get((a as any).id) || [] } as ArticuloMotor)
      out.set((a as any).id, { va: p.vaEnComprobante, precio: p.vaEnComprobante === "factura" ? p.precioNeto : p.precio, alCliente: p.precio })
    } catch {
      // sin precio calculable: se resuelve como factura y precio a mano
    }
  }
  return out
}

export interface OrigenResuelto extends OrigenDevolucion {
  /** Precio a usar si no es exacto (neto actual del cliente si va por factura) */
  precio_sugerido: number | null
  /** Precio al cliente hoy (con IVA si va por factura) — para reconocer lo que mandan apps viejas */
  precio_al_cliente: number | null
}

/**
 * Origen de cada artículo de una devolución (reglas 1-3). `pedidoId`: el pedido
 * que se está entregando (chofer) — lo devuelto de ese pedido va contra SU comprobante.
 */
export async function resolverOrigenesDevolucion(
  supabase: SupabaseClient,
  clienteId: string,
  articuloIds: string[],
  opts: { pedidoId?: string | null; cliente?: ClienteDev | null } = {},
): Promise<{ origenes: Map<string, OrigenResuelto>; contexto: ContextoDevolucion }> {
  const ids = [...new Set(articuloIds.filter(Boolean))]
  const cliente = await leerCliente(supabase, clienteId, opts.cliente)
  const [comprados, contexto, hoy] = await Promise.all([
    origenesComprados(supabase, clienteId, cliente),
    contextoDevolucion(supabase, clienteId, cliente),
    comoVaHoy(supabase, clienteId, ids),
  ])

  // Regla 1: comprobante(s) del pedido entregado
  const delPedido = new Map<string, OrigenDevolucion>()
  if (opts.pedidoId) {
    const { data: comps } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, fecha, total_neto, percepcion_iva, pedido_id, created_at, comprobantes_venta_detalle(articulo_id, precio_unitario, es_bonificado)")
      .eq("pedido_id", opts.pedidoId)
      .in("tipo_comprobante", VENTAS)
      .is("anulado_en", null)
    const lista = (comps || []) as any[]
    const renglones: Array<{ comp: CompRow; articulo_id: string; precio_unitario: number }> = []
    const confPedido = configuracionCliente(cliente)
    for (const c of lista) {
      const esFiscalC = FISCALES.includes(c.tipo_comprobante)
      if ((confPedido === "negro" && esFiscalC) || (confPedido === "blanco" && !esFiscalC)) continue
      for (const d of c.comprobantes_venta_detalle || []) {
        if (d.es_bonificado === true || !(Number(d.precio_unitario) > 0) || !ids.includes(d.articulo_id)) continue
        renglones.push({ comp: c, articulo_id: d.articulo_id, precio_unitario: Number(d.precio_unitario) })
      }
    }
    const [bonificados, ivas] = await Promise.all([bonificadosDe(supabase, clienteId, lista), ivaUnitarioDeRenglones(supabase, renglones)])
    for (const r of renglones) {
      if (delPedido.has(r.articulo_id)) continue
      delPedido.set(r.articulo_id, origenDe(r.comp, cliente, bonificados, {
        exacto: true,
        precio: r.precio_unitario,
        iva_unitario: ivas.get(`${r.comp.id}|${r.articulo_id}`) ?? null,
      }))
    }
  }

  const origenes = new Map<string, OrigenResuelto>()
  for (const id of ids) {
    const exacto = delPedido.get(id) ?? comprados.get(id) ?? null
    const hoyArt = hoy.get(id)
    // R2: si el motor no lo resolvió, manda el cliente; si es mixto, indeterminado (nunca "factura" por defecto)
    const o = elegirConVa(exacto, contexto, hoyArt?.va ?? vaPorCliente(cliente))
    origenes.set(id, { ...o, precio_sugerido: o.exacto ? o.precio : hoyArt?.precio ?? null, precio_al_cliente: hoyArt?.alCliente ?? null })
  }
  return { origenes, contexto }
}

/**
 * Antes de guardar una devolución (todas las rutas de alta): cada renglón queda
 * asociado a su comprobante y, si el artículo está facturado en el sistema, al
 * precio FACTURADO (no se acepta otro). Si no, se respeta el precio cargado; si
 * vino el precio con IVA del motor en algo que va por factura (apps viejas), se
 * pasa al neto.
 */
export async function prepararRenglonesDevolucion<T extends { articulo_id: string; precio_venta_original?: number | null; comprobante_venta_id?: string | null }>(
  supabase: SupabaseClient,
  clienteId: string,
  items: T[],
  opts: { pedidoId?: string | null } = {},
): Promise<Array<T & { precio_venta_original: number; comprobante_venta_id: string | null }>> {
  if (!items.length) return []
  const { origenes } = await resolverOrigenesDevolucion(supabase, clienteId, items.map((i) => i.articulo_id), opts)
  // #28: negro sin comprobante con el artículo y el respaldo todavía no existe → crearlo
  let respaldoId: string | null = null
  for (const o of origenes.values()) {
    if (o.comprobante_venta_id || o.fiscal || o.numero_comprobante !== NUMERO_RESPALDO_DEVOLUCION) continue
    respaldoId ??= await asegurarComprobanteRespaldo(supabase, clienteId)
    o.comprobante_venta_id = respaldoId
  }
  const out: Array<T & { precio_venta_original: number; comprobante_venta_id: string | null }> = []
  for (const it of items) {
    const o = origenes.get(it.articulo_id)
    let precio = Number(it.precio_venta_original) || 0
    if (o?.exacto && o.precio != null) {
      precio = o.precio
    } else if (o) {
      if (!(precio > 0) && o.precio_sugerido) precio = o.precio_sugerido
      // App vieja: mandó el precio al cliente (con IVA) de algo que va por factura
      else if (o.fiscal && o.precio_sugerido && o.precio_al_cliente && Math.abs(o.precio_al_cliente - precio) < 0.005) precio = o.precio_sugerido
    }
    out.push({ ...it, precio_venta_original: r2(precio), comprobante_venta_id: o?.comprobante_venta_id ?? null })
  }
  return out
}


/**
 * Origen de renglones YA GUARDADOS (valuación y emisión de la NC): cada uno contra
 * el comprobante al que quedó asociado. Exacto si el artículo está en ese
 * comprobante al mismo precio (entonces el IVA por unidad es el del renglón).
 * Renglón sin comprobante (no había ninguno del tipo): fiscal según cómo va hoy.
 */
export async function origenesDeRenglones(
  supabase: SupabaseClient,
  clienteId: string,
  renglones: Array<{ articulo_id: string; comprobante_venta_id: string | null; precio_venta_original: number | null }>,
  clienteIn?: ClienteDev | null,
): Promise<OrigenDevolucion[]> {
  const cliente = await leerCliente(supabase, clienteId, clienteIn)
  const compIds = [...new Set(renglones.map((r) => r.comprobante_venta_id).filter(Boolean))] as string[]
  const { data: comps } = compIds.length
    ? await supabase
        .from("comprobantes_venta")
        .select("id, tipo_comprobante, numero_comprobante, fecha, total_neto, percepcion_iva, pedido_id, comprobantes_venta_detalle(articulo_id, precio_unitario, es_bonificado)")
        .in("id", compIds)
    : { data: [] as any[] }
  const compDe = new Map((comps || []).map((c: any) => [c.id, c]))
  const sinComp = [...new Set(renglones.filter((r) => !r.comprobante_venta_id || !compDe.has(r.comprobante_venta_id)).map((r) => r.articulo_id))]
  const exactos: Array<{ comp: CompRow; articulo_id: string; precio_unitario: number }> = []
  for (const r of renglones) {
    const c = r.comprobante_venta_id ? compDe.get(r.comprobante_venta_id) : null
    const precio = Number(r.precio_venta_original) || 0
    if (c && (c.comprobantes_venta_detalle || []).some((d: any) => d.articulo_id === r.articulo_id && Math.abs(Number(d.precio_unitario) - precio) < 0.005)) {
      exactos.push({ comp: c, articulo_id: r.articulo_id, precio_unitario: precio })
    }
  }
  const [bonificados, ivas, hoy] = await Promise.all([
    bonificadosDe(supabase, clienteId, (comps || []) as CompRow[]),
    ivaUnitarioDeRenglones(supabase, exactos),
    comoVaHoy(supabase, clienteId, sinComp),
  ])
  return renglones.map((r) => {
    const c = r.comprobante_venta_id ? compDe.get(r.comprobante_venta_id) : null
    if (!c) return elegirConVa(null, null, hoy.get(r.articulo_id)?.va ?? vaPorCliente(cliente))
    const ex = exactos.find((e) => e.comp.id === c.id && e.articulo_id === r.articulo_id && Math.abs(e.precio_unitario - (Number(r.precio_venta_original) || 0)) < 0.005)
    return origenDe(c, cliente, bonificados, {
      exacto: !!ex,
      precio: ex ? ex.precio_unitario : null,
      iva_unitario: ex ? ivas.get(`${c.id}|${r.articulo_id}`) ?? null : null,
    })
  })
}
