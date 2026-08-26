/**
 * Descuentos EFECTIVOS de un pedido para mostrar en cabeceras (modal del listado
 * y nota impresa). Misma resolución que usa el motor de precios:
 *
 *  - general:    ficha del cliente (bonificaciones tipo general, por segmento o "todos")
 *  - viajante:   override "solo este pedido" (pedidos.bonif_pedido.viajante[seg])
 *                > ficha del cliente por segmento / todos
 *  - mercadería: override por segmento (bonif_pedido.mercaderia[seg])
 *                > % general del pedido (bonif_mercaderia_pct) > ficha por segmento / todos
 *  - aparte:     condiciones por marca / proveedor (override del pedido > ficha del
 *                cliente), solo las que tienen mercadería en este pedido. Van en
 *                comprobante aparte.
 */

import { SEGMENTOS_BONIF, SEGMENTO_LABEL, normalizarBonifPedido, type SegmentoBonif } from "@/lib/pricing/segmento"

export interface DescuentosSegmento { key: SegmentoBonif; label: string; lineas: string[] }
export interface DescuentosAparte { nombre: string; texto: string }
export interface DescuentosPedido { segs: DescuentosSegmento[]; aparte: DescuentosAparte[] }

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
  const PROV_SEL = "proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, proveedores:proveedor_id (nombre)"
  const MARCA_SEL = "marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, marcas:marca_id (descripcion)"

  const [
    { data: bonifs }, { data: ped }, { data: det },
    { data: cliProv }, { data: pedProv }, { data: cliMarca }, { data: pedMarca },
  ] = await Promise.all([
    supabase.from("bonificaciones").select("tipo, porcentaje, segmento")
      .eq("cliente_id", clienteId).eq("activo", true).in("tipo", ["general", "mercaderia", "viajante"]),
    supabase.from("pedidos").select("bonif_pedido, bonif_mercaderia_pct").eq("id", pedidoId).single(),
    supabase.from("pedidos_detalle").select("articulos:articulo_id (proveedor_id, marca_id)").eq("pedido_id", pedidoId),
    supabase.from("cliente_proveedor_condicion").select(PROV_SEL).eq("cliente_id", clienteId),
    supabase.from("pedido_proveedor_condicion").select(PROV_SEL).eq("pedido_id", pedidoId),
    supabase.from("cliente_marca_condicion").select(MARCA_SEL).eq("cliente_id", clienteId),
    supabase.from("pedido_marca_condicion").select(MARCA_SEL).eq("pedido_id", pedidoId),
  ])

  const ficha: any[] = bonifs || []
  const ovr = normalizarBonifPedido((ped as any)?.bonif_pedido)
  const mercPedido = (ped as any)?.bonif_mercaderia_pct

  // ── Por segmento ──
  const segs: DescuentosSegmento[] = SEGMENTOS_BONIF.map((seg) => {
    const general = pctFicha(ficha, "general", seg)
    const viajante = typeof ovr?.viajante?.[seg] === "number" ? ovr!.viajante![seg]! : pctFicha(ficha, "viajante", seg)
    const mercaderia = typeof ovr?.mercaderia?.[seg] === "number" ? ovr!.mercaderia![seg]!
      : mercPedido != null ? Number(mercPedido) || 0 : pctFicha(ficha, "mercaderia", seg)
    const lineas: string[] = []
    if (general > 0) lineas.push(`−${general}% general`)
    if (viajante > 0) lineas.push(`−${viajante}% viajante`)
    if (mercaderia > 0) lineas.push(`−${mercaderia}% mercadería`)
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
    const lista = listaNombre(r.lista_precio_id) || "Lista del segmento general"
    return `${r.metodo_facturacion || "—"} — ${lista}${d.length ? " · " + d.join(" · ") : ""}`
  }
  const aparte: DescuentosAparte[] = [
    ...[...marcaMap.values()].filter(r => marcaEnPedido.has(r.marca_id))
      .map(r => ({ nombre: r.marcas?.descripcion || "Marca", texto: texto(r) })),
    ...[...provMap.values()].filter(r => provEnPedido.has(r.proveedor_id))
      .map(r => ({ nombre: r.proveedores?.nombre || "Proveedor", texto: texto(r) })),
  ]

  return { segs, aparte }
}
