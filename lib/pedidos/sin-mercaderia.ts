// Pedidos preparados con TODO faltante (#17/#39 de la prueba de salida): no hay
// nada para facturar ni para cobrar. No se ofrecen como anticipo en ningún lado.
// Solo pueden estar en "pendiente_facturacion": Generar no emite nada y el pedido
// se queda ahí hasta que vuelve a la cola o se elimina.
import { cantidadAFacturar } from "./cantidad-a-facturar"

export async function pedidosSinMercaderia(
  supabase: any,
  pedidos: { id: string; estado?: string | null }[],
): Promise<Set<string>> {
  const candidatos = pedidos.filter((p) => p.estado === "pendiente_facturacion").map((p) => p.id)
  const fuera = new Set<string>()
  if (!candidatos.length) return fuera
  const { data, error } = await supabase
    .from("pedidos_detalle")
    .select("pedido_id, cantidad, cantidad_preparada, estado_item")
    .in("pedido_id", candidatos)
  if (error) return fuera
  const conAlgo = new Set<string>()
  const conRenglones = new Set<string>()
  for (const r of (data || []) as any[]) {
    conRenglones.add(r.pedido_id)
    if (cantidadAFacturar(r) > 0) conAlgo.add(r.pedido_id)
  }
  for (const id of conRenglones) if (!conAlgo.has(id)) fuera.add(id)
  return fuera
}

/** Saca de la lista los pedidos con todo faltante. */
export async function sinPedidosVacios<T extends { id: string; estado?: string | null }>(supabase: any, pedidos: T[]): Promise<T[]> {
  const fuera = await pedidosSinMercaderia(supabase, pedidos)
  return fuera.size ? pedidos.filter((p) => !fuera.has(p.id)) : pedidos
}
