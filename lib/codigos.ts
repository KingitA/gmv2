// Códigos de cliente, proveedor y SKU de artículo: NUNCA se repiten (regla del dueño,
// 14/10/2026). Si el código está tomado se bloquea y se sugiere otro:
//  - Cliente: el siguiente al código numérico MÁS ALTO (P2-01, regla de Juan 27/10:
//    ocupados 1, 2, 3, 5, 90034 → 90035). Nunca se reusa un hueco: podría ser el
//    código de un cliente del sistema viejo que todavía no se cargó (la apertura
//    reconoce a los clientes por código). El alta del viajante recibe ese número.
//  - Proveedor: el primer número libre (ocupados 1, 2, 3, 5, 8 → 4, después 6, 7…).
// Los códigos no numéricos ("PRUEBA-R1") no cuentan. Un código de un cliente dado de
// baja sigue OCUPADO (lo referencian pedidos y comprobantes viejos); el de uno
// eliminado (P2-02) queda libre.
// En la base: índice único + trigger que asigna el código si el alta llega sin él
// (supabase/migrations/20261014_codigos_unicos.sql y 20261029b_codigo_cliente_siguiente.sql).

export type EntidadCodigo = "cliente" | "proveedor"

export const TABLA_CODIGO: Record<EntidadCodigo, { tabla: string; columna: string; nombre: string }> = {
  cliente: { tabla: "clientes", columna: "codigo_cliente", nombre: "nombre" },
  proveedor: { tabla: "proveedores", columna: "codigo_proveedor", nombre: "nombre" },
}

/** Forma única de un código: sin espacios; si es numérico, sin ceros adelante ("0702" → "702"). Vacío → null. */
export function normalizarCodigo(v: string | number | null | undefined): string | null {
  const s = String(v ?? "").trim()
  if (!s) return null
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s
}

/** Primer número libre desde 1 entre los códigos ocupados (los no numéricos se ignoran). */
export function primerLibre(ocupados: Iterable<string | null | undefined>): string {
  const usados = new Set<number>()
  for (const c of ocupados) {
    const n = normalizarCodigo(c)
    if (n && /^\d{1,12}$/.test(n)) usados.add(Number(n))
  }
  let i = 1
  while (usados.has(i)) i++
  return String(i)
}

/** Todos los códigos ocupados (activos y dados de baja). */
export async function codigosOcupados(sb: any, entidad: EntidadCodigo): Promise<string[]> {
  const { tabla, columna } = TABLA_CODIGO[entidad]
  const out: string[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columna).not(columna, "is", null).range(desde, desde + 999)
    if (error) throw error
    for (const r of data || []) out.push(r[columna])
    if (!data || data.length < 1000) break
  }
  return out
}

/** El siguiente al número más alto (los no numéricos se ignoran). Sin numéricos → "1". */
export function siguienteAlMayor(ocupados: Iterable<string | null | undefined>): string {
  let mayor = 0
  for (const c of ocupados) {
    const n = normalizarCodigo(c)
    if (n && /^d{1,12}$/.test(n)) mayor = Math.max(mayor, Number(n))
  }
  return String(mayor + 1)
}

/** Código para un alta: cliente → el más alto + 1; proveedor → el primer libre. */
export async function siguienteCodigo(sb: any, entidad: EntidadCodigo): Promise<string> {
  const ocupados = await codigosOcupados(sb, entidad)
  return entidad === "cliente" ? siguienteAlMayor(ocupados) : primerLibre(ocupados)
}

/** ¿Quién tiene este código? (sin contar `excluirId`, el registro que se está editando) */
export async function duenoDelCodigo(
  sb: any, entidad: EntidadCodigo, codigo: string | null | undefined, excluirId?: string | null,
): Promise<{ id: string; nombre: string; activo: boolean } | null> {
  const c = normalizarCodigo(codigo)
  if (!c) return null
  const { tabla, columna, nombre } = TABLA_CODIGO[entidad]
  // Con y sin ceros adelante, por si quedó algún dato viejo sin normalizar
  const variantes = /^\d+$/.test(c) ? [c, c.padStart(2, "0"), c.padStart(3, "0"), c.padStart(4, "0")] : [c]
  const { data } = await sb.from(tabla).select(`id, ${nombre}, activo`).in(columna, [...new Set(variantes)]).limit(5)
  const r = (data || []).find((x: any) => x.id !== excluirId)
  return r ? { id: r.id, nombre: r[nombre] ?? "", activo: !!r.activo } : null
}

/** Error de índice único de Postgres (23505) sobre el código. */
export function esCodigoDuplicado(error: any): boolean {
  return error?.code === "23505" && /codigo/i.test(`${error?.message ?? ""} ${error?.details ?? ""}`)
}
