/**
 * Fracción = cantidad mínima de la línea (Juan 03/11/2026 en la app vendedor; 26/11/2026 en la
 * importación de pedidos). Un artículo de fracción 12 pedido por 6 se carga por 12. Sin fracción
 * (o 1), cualquier cantidad. Solo sube hasta el mínimo: no redondea a múltiplos (13 queda 13).
 * Misma regla que `minimoDe` de mobile/apps/vendedor/src/datos/borradores.ts.
 */
export function minimoPorFraccion(cantidadFraccion: number | string | null | undefined): number {
  const f = Number(cantidadFraccion)
  return Number.isFinite(f) && f > 1 ? Math.trunc(f) : 1
}

/** Cantidad llevada al mínimo de la fracción. Una cantidad 0 o vacía se deja como está (renglón sin pedir). */
export function ajustarAFraccion(cantidad: number, cantidadFraccion: number | string | null | undefined): number {
  if (!(cantidad > 0)) return cantidad
  return Math.max(cantidad, minimoPorFraccion(cantidadFraccion))
}

/** Lleva cada renglón al mínimo de su fracción leyendo `articulos.cantidad_fraccion` en una sola consulta. */
export async function ajustarItemsAFraccion<T extends { producto_id: string; cantidad: number }>(sb: any, items: T[]): Promise<T[]> {
  const ids = [...new Set(items.map((i) => i.producto_id).filter(Boolean))]
  if (ids.length === 0) return items
  const { data, error } = await sb.from("articulos").select("id, cantidad_fraccion").in("id", ids)
  if (error) throw error
  const fraccion = new Map<string, any>((data || []).map((a: any) => [a.id, a.cantidad_fraccion]))
  return items.map((i) => ({ ...i, cantidad: ajustarAFraccion(Number(i.cantidad), fraccion.get(i.producto_id)) }))
}
