// Orden de los listados de artículos en la app del vendedor (pedido, precios).
// Una sola definición para que todas las pantallas ofrezcan lo mismo.

export type OrdenArticulos =
  | "default"      // orden natural del listado (taxonomía / relevancia)
  | "precio_asc"   // más barato primero
  | "precio_desc"  // más caro primero
  | "ventas_desc"  // más vendido primero
  | "ventas_asc"   // menos vendido primero
  | "marca"        // marca A → Z

export const ORDENES: Array<{ key: OrdenArticulos; label: string }> = [
  { key: "default", label: "Orden normal" },
  { key: "precio_asc", label: "Precio: menor a mayor" },
  { key: "precio_desc", label: "Precio: mayor a menor" },
  { key: "ventas_desc", label: "Más vendidos" },
  { key: "ventas_asc", label: "Menos vendidos" },
  { key: "marca", label: "Marca A → Z" },
]

export interface OrdenableArticulo {
  id: string
  marca?: string | null
}

/**
 * Ordena (copia) según `orden`. `precioDe` devuelve el precio a usar
 * (undefined = todavía no cargado → va al final). `ventas` = unidades por id.
 * Estable: a igual criterio se respeta el orden de entrada.
 */
export function ordenarArticulos<T extends OrdenableArticulo>(
  arts: T[],
  orden: OrdenArticulos,
  precioDe: (a: T) => number | undefined,
  ventas: Record<string, number> = {},
): T[] {
  if (orden === "default") return arts
  const idx = new Map(arts.map((a, i) => [a.id, i]))
  const est = (a: T, b: T) => (idx.get(a.id) || 0) - (idx.get(b.id) || 0)
  const out = [...arts]
  if (orden === "precio_asc" || orden === "precio_desc") {
    const dir = orden === "precio_asc" ? 1 : -1
    out.sort((a, b) => {
      const pa = precioDe(a), pb = precioDe(b)
      if (pa === undefined && pb === undefined) return est(a, b)
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return (pa - pb) * dir || est(a, b)
    })
    return out
  }
  if (orden === "ventas_desc" || orden === "ventas_asc") {
    const dir = orden === "ventas_desc" ? -1 : 1
    out.sort((a, b) => ((ventas[a.id] || 0) - (ventas[b.id] || 0)) * dir || est(a, b))
    return out
  }
  // marca A → Z; sin marca al final; misma marca: orden de entrada
  out.sort((a, b) => {
    const ma = (a.marca || "").trim(), mb = (b.marca || "").trim()
    if (!ma && !mb) return est(a, b)
    if (!ma) return 1
    if (!mb) return -1
    return ma.localeCompare(mb, "es", { sensitivity: "base" }) || est(a, b)
  })
  return out
}
