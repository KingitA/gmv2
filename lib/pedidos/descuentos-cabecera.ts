/**
 * Descuentos EFECTIVOS de un pedido para mostrar en cabeceras (modal del listado
 * y nota impresa). Misma resolución que usa el motor de precios, sobre la ficha
 * CONGELADA del pedido (pedidos.condiciones_cliente; pedidos viejos: ficha actual):
 *
 *  - general / viajante: override "solo este pedido" (pedidos.bonif_pedido[tipo][seg])
 *                > ficha por segmento / todos
 *  - mercadería: override por segmento (bonif_pedido.mercaderia[seg])
 *                > % "todo el pedido" (bonif_mercaderia_pct) > ficha por segmento / todos
 *  - contado:    lo que quedó en los renglones (pedidos_detalle.contado): el 10% NO va
 *                en la factura, sale en una NC/REV aparte al facturar.
 *  - aparte:     condiciones por marca / proveedor del pedido, solo las que tienen
 *                mercadería en este pedido. Van en comprobante aparte.
 */

import { SEGMENTOS_BONIF, SEGMENTO_LABEL, normalizarBonifPedido, detectarSegmentoBonif, type SegmentoBonif } from "@/lib/pricing/segmento"

export interface DescuentosSegmento { key: SegmentoBonif; label: string; lineas: string[] }
export interface DescuentosAparte { nombre: string; texto: string }
export interface DescuentosPedido {
  segs: DescuentosSegmento[]
  aparte: DescuentosAparte[]
  /** el pedido (o parte) sale con 10% por pago contado */
  contado: boolean
  /** cupos de mercadería sin artículos elegidos (no se puede facturar) */
  mercaderiaPendiente: boolean
}

const pctFicha = (
  bonifs: any[], tipo: string, seg: SegmentoBonif,
): number => {
  const esp = bonifs.find(b => b.tipo === tipo && b.segmento === seg)
  if (esp) return Number(esp.porcentaje) || 0
  const gen = bonifs.find(b => b.tipo === tipo && (!b.segmento || b.segmento === "todos"))
  return Number(gen?.porcentaje) || 0
}

export async function calcularDescuentosPedido(
  supabase: any,
  pedidoId: string,
  clienteId: string,
  listaNombre: (id: string | null | undefined) => string | null,
): Promise<DescuentosPedido> {
  const PROV_SEL = "proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado, proveedores:proveedor_id (nombre)"
  const MARCA_SEL = "marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado, marcas:marca_id (descripcion)"

  const { data: ped } = await supabase.from("pedidos").select("bonif_pedido, bonif_mercaderia_pct, condiciones_cliente").eq("id", pedidoId).single()
  const congelada = (ped as any)?.condiciones_cliente && typeof (ped as any).condiciones_cliente === "object" ? (ped as any).condiciones_cliente : null

  const [
    { data: bonifs }, { data: det },
    { data: cliProv }, { data: pedProv }, { data: cliMarca }, { data: pedMarca },
  ] = await Promise.all([
    congelada
      ? Promise.resolve({ data: congelada.bonificaciones || [] })
      : supabase.from("bonificaciones").select("tipo, porcentaje, segmento")
          .eq("cliente_id", clienteId).eq("activo", true).in("tipo", ["general", "mercaderia", "viajante"]),
    supabase.from("pedidos_detalle").select("es_bonificado, contado, bonif_merc_origen, bonif_merc_pct, articulos:articulo_id (proveedor_id, marca_id, segmento_precio, iva_ventas, categoria)").eq("pedido_id", pedidoId),
    congelada ? Promise.resolve({ data: [] }) : supabase.from("cliente_proveedor_condicion").select(PROV_SEL).eq("cliente_id", clienteId),
    supabase.from("pedido_proveedor_condicion").select(PROV_SEL).eq("pedido_id", pedidoId),
    congelada ? Promise.resolve({ data: [] }) : supabase.from("cliente_marca_condicion").select(MARCA_SEL).eq("cliente_id", clienteId),
    supabase.from("pedido_marca_condicion").select(MARCA_SEL).eq("pedido_id", pedidoId),
  ])

  const ficha: any[] = bonifs || []
  const ovr = normalizarBonifPedido((ped as any)?.bonif_pedido)
  const mercPedido = (ped as any)?.bonif_mercaderia_pct
  const renglones: any[] = (det || []).filter((d: any) => !d.es_bonificado)
  const contadoPorSeg = new Set<string>()
  for (const d of renglones) if (d.contado) contadoPorSeg.add(detectarSegmentoBonif(d.articulos || {}))

  // ── Por segmento ──
  const segs: DescuentosSegmento[] = SEGMENTOS_BONIF.map((seg) => {
    const general = typeof ovr?.general?.[seg] === "number" ? ovr!.general![seg]! : pctFicha(ficha, "general", seg)
    const viajante = typeof ovr?.viajante?.[seg] === "number" ? ovr!.viajante![seg]! : pctFicha(ficha, "viajante", seg)
    const mercaderia = typeof ovr?.mercaderia?.[seg] === "number" ? ovr!.mercaderia![seg]!
      : mercPedido != null ? Number(mercPedido) || 0 : pctFicha(ficha, "mercaderia", seg)
    const lineas: string[] = []
    if (general > 0) lineas.push(`−${general}% general`)
    if (viajante > 0) lineas.push(`−${viajante}% viajante`)
    if (mercaderia > 0) lineas.push(`−${mercaderia}% mercadería`)
    if (contadoPorSeg.has(seg)) lineas.push(`−10% pago contado (NC aparte)`)
    return { key: seg, label: SEGMENTO_LABEL[seg], lineas }
  })

  // ── Aparte: marca / proveedor con mercadería en este pedido (override del pedido pisa) ──
  const provEnPedido = new Set((det || []).map((d: any) => d.articulos?.proveedor_id).filter(Boolean))
  const marcaEnPedido = new Set((det || []).map((d: any) => d.articulos?.marca_id).filter(Boolean))
  const provMap = new Map<string, any>()
  for (const r of (cliProv || [])) provMap.set(r.proveedor_id, r)
  for (const r of (pedProv || [])) provMap.set(r.proveedor_id, r)
  const marcaMap = new Map<string, any>()
  for (const r of (cliMarca || [])) marcaMap.set(r.marca_id, r)
  for (const r of (pedMarca || [])) marcaMap.set(r.marca_id, r)

  const texto = (r: any) => {
    const d: string[] = []
    if (Number(r.dto_general_pct) > 0) d.push(`−${r.dto_general_pct}% general`)
    if (Number(r.dto_viajante_pct) > 0) d.push(`−${r.dto_viajante_pct}% viajante`)
    if (Number(r.dto_mercaderia_pct) > 0) d.push(`−${r.dto_mercaderia_pct}% mercadería`)
    if (r.contado === true) d.push(`−10% pago contado (NC aparte)`)
    const lista = listaNombre(r.lista_precio_id) || "lista del pedido"
    return `${r.metodo_facturacion || "método del pedido"} — ${lista}${d.length ? " · " + d.join(" · ") : ""}`
  }
  const aparte: DescuentosAparte[] = [
    ...[...marcaMap.values()].filter(r => marcaEnPedido.has(r.marca_id))
      .map(r => ({ nombre: r.marcas?.descripcion || "Marca", texto: texto(r) })),
    ...[...provMap.values()].filter(r => provEnPedido.has(r.proveedor_id))
      .map(r => ({ nombre: r.proveedores?.nombre || "Proveedor", texto: texto(r) })),
  ]

  // Cupos de mercadería sin artículos elegidos
  const cupos = new Set(renglones.filter((d: any) => d.bonif_merc_origen && Number(d.bonif_merc_pct) > 0).map((d: any) => d.bonif_merc_origen))
  const elegidos = new Set((det || []).filter((d: any) => d.es_bonificado && d.bonif_merc_origen).map((d: any) => d.bonif_merc_origen))
  const mercaderiaPendiente = [...cupos].some((o) => !elegidos.has(o))

  return { segs, aparte, contado: renglones.some((d: any) => d.contado), mercaderiaPendiente }
}
