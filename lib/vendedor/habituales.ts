// Artículos HABITUALES de un cliente: frecuencia en sus últimos 30 pedidos.
// Extraído de GET /api/vendedor/articulos?vista=habituales para compartirlo con la
// réplica de la app Vendedor (que arma la lista contra su catálogo local).

export const TOPE_HABITUALES = 60

export async function frecuenciaHabituales(supabase: any, clienteId: string) {
  // Últimos 30 pedidos del cliente → frecuencia por artículo
  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id")
    .eq("cliente_id", clienteId)
    .is("eliminado_at", null)
    .order("fecha", { ascending: false })
    .limit(30)

  const pedidoIds = (pedidos || []).map((p: any) => p.id)
  if (!pedidoIds.length) return new Map<string, { veces: number; ultCantidad: number }>()

  const { data: detalle } = await supabase
    .from("pedidos_detalle")
    .select("articulo_id, cantidad")
    .in("pedido_id", pedidoIds)

  const frecuencia = new Map<string, { veces: number; ultCantidad: number }>()
  for (const d of detalle || []) {
    if (!d.articulo_id) continue
    const f = frecuencia.get(d.articulo_id)
    if (f) f.veces += 1
    else frecuencia.set(d.articulo_id, { veces: 1, ultCantidad: Number(d.cantidad) || 1 })
  }
  return frecuencia
}
