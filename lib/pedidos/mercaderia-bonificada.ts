// Mercadería bonificada de un pedido (servidor). Regla del dueño (06/10/2026):
//  - Al tomar el pedido se eligen los artículos a regalar de cada cupo
//    (todo el pedido / segmento / proveedor / marca). Sin artículos elegidos el
//    cupo queda PENDIENTE y el pedido no se puede facturar.
//  - La cantidad es estimada mientras se arma el pedido y queda FIJA al cerrar el
//    picking: se bonifica sobre lo que realmente va, no sobre lo vendido.
// Cálculo puro: lib/deposito/bonificados.ts (calcularBonificadosPorCupo).

import {
  estadoBonificadoPicking,
  calcularBonificados,
  calcularBonificadosPorCupo,
  usaCupos,
  type CupoBonificacion,
  type LineaCupo,
} from "@/lib/deposito/bonificados"

const ESTADOS_PICKING = ["en_preparacion", "pendiente_facturacion"]

const COLS = "id, articulo_id, cantidad, cantidad_preparada, estado_item, precio_base, es_bonificado, bonif_merc_origen, bonif_merc_pct, lista_precio_id"

async function cargar(supabase: any, pedidoId: string) {
  const [{ data: pedido }, { data: lineas, error }] = await Promise.all([
    supabase.from("pedidos").select("id, estado, bonif_mercaderia_pct").eq("id", pedidoId).maybeSingle(),
    supabase.from("pedidos_detalle").select(COLS).eq("pedido_id", pedidoId),
  ])
  if (error) throw new Error(error.message)
  return { pedido, lineas: (lineas || []) as Array<LineaCupo & { articulo_id: string; lista_precio_id: string | null }> }
}

/**
 * Recalcula las unidades de los renglones bonificados del pedido. Durante el
 * picking (o `enPicking`) además fija su estado con `estadoBonificadoPicking`
 * (03/11: el depósito los prepara al final, ya no quedan preparados solos; lo que
 * marcó un operario no se pisa). Devuelve [{ id, cantidad }] de los bonificados.
 */
export async function recalcularBonificadosPedido(
  supabase: any,
  pedidoId: string,
  opts: { enPicking?: boolean } = {},
): Promise<Array<{ id: string; cantidad: number }>> {
  const { pedido, lineas } = await cargar(supabase, pedidoId)
  if (!pedido || !lineas.some((l) => l.es_bonificado)) return []
  const enPicking = opts.enPicking ?? ESTADOS_PICKING.includes(pedido.estado)

  let calc: Array<{ id: string; cantidad: number; cambia: boolean }>
  if (usaCupos(lineas)) {
    calc = calcularBonificadosPorCupo(lineas).calculados
  } else {
    // Pedido viejo (sin cupos): un solo % (pedidos.bonif_mercaderia_pct) sobre lo preparado,
    // sin la lista Especial. Sin % no se toca (cantidades cargadas a mano).
    const pct = Number(pedido.bonif_mercaderia_pct ?? 0)
    if (!(pct > 0)) return lineas.filter((l) => l.es_bonificado).map((l) => ({ id: l.id, cantidad: Number(l.cantidad || 0) }))
    const { data: especial } = await supabase.from("listas_precio").select("id").eq("codigo", "especial").maybeSingle()
    calc = calcularBonificados(pct, lineas.map((d) => ({ ...d, excluye_bonif: !!especial?.id && d.lista_precio_id === especial.id })))
  }

  const porId = new Map(lineas.map((l) => [l.id, l]))
  // Bonificados que ya marcó un operario en la app/web del depósito (picking_items)
  let tomados = new Set<string>()
  if (enPicking && calc.length) {
    const { data: pi, error: piErr } = await supabase.from("picking_items").select("pedido_detalle_id").in("pedido_detalle_id", calc.map((b) => b.id))
    if (piErr) throw new Error(piErr.message)
    tomados = new Set(((pi || []) as Array<{ pedido_detalle_id: string }>).map((r) => r.pedido_detalle_id))
  }
  const preparando = ["pendiente", "impreso", "en_preparacion"].includes(pedido.estado)
  for (const b of calc) {
    const actual = porId.get(b.id)
    const upd: Record<string, unknown> = {}
    if (Number(actual?.cantidad) !== b.cantidad) upd.cantidad = b.cantidad
    if (enPicking) {
      const e = estadoBonificadoPicking(
        { cantidad: b.cantidad, cantidad_preparada: actual?.cantidad_preparada ?? 0, estado_item: actual?.estado_item ?? null },
        { tomado: tomados.has(b.id), preparando },
      )
      if (Number(actual?.cantidad_preparada) !== e.cantidad_preparada) upd.cantidad_preparada = e.cantidad_preparada
      if (actual?.estado_item !== e.estado_item) upd.estado_item = e.estado_item
    }
    if (Object.keys(upd).length) {
      const { error } = await supabase.from("pedidos_detalle").update(upd).eq("id", b.id)
      if (error) throw new Error(error.message)
    }
  }
  return calc.map((b) => ({ id: b.id, cantidad: b.cantidad }))
}

/** Cupos del pedido con su estado (para la ficha del pedido y el bloqueo de facturación). */
export async function cuposMercaderiaPedido(supabase: any, pedidoId: string): Promise<{
  usaCupos: boolean
  cupos: CupoBonificacion[]
  pendientes: string[]
}> {
  const { lineas } = await cargar(supabase, pedidoId)
  if (!usaCupos(lineas)) return { usaCupos: false, cupos: [], pendientes: [] }
  const r = calcularBonificadosPorCupo(lineas)
  return { usaCupos: true, cupos: r.cupos, pendientes: r.pendientes }
}

/** Nombre legible de un origen de cupo ("seg:perf0" → "Perfumería 0", "marca:<id>" → "Marca X"). */
export async function etiquetasCupos(supabase: any, origenes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const SEG: Record<string, string> = { limpieza_bazar: "Limpieza / Bazar", perf0: "Perfumería 0", perf_plus: "Perfumería plus" }
  const provIds: string[] = []
  const marcaIds: string[] = []
  for (const o of origenes) {
    if (o === "todo") out[o] = "Todo el pedido"
    else if (o.startsWith("seg:")) out[o] = SEG[o.slice(4)] || o.slice(4)
    else if (o.startsWith("prov:")) provIds.push(o.slice(5))
    else if (o.startsWith("marca:")) marcaIds.push(o.slice(6))
  }
  const [prov, marca] = await Promise.all([
    provIds.length ? supabase.from("proveedores").select("id, nombre").in("id", provIds) : Promise.resolve({ data: [] }),
    marcaIds.length ? supabase.from("marcas").select("id, descripcion").in("id", marcaIds) : Promise.resolve({ data: [] }),
  ])
  for (const p of prov.data || []) out[`prov:${p.id}`] = `Proveedor ${p.nombre}`
  for (const m of marca.data || []) out[`marca:${m.id}`] = `Marca ${m.descripcion}`
  for (const o of origenes) if (!out[o]) out[o] = o
  return out
}
