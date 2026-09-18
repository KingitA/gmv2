/**
 * Stock y datos de artículo desde depósito — compartido por las server actions
 * web (lib/actions/deposito.ts) y los handlers del outbox de la app Depósito.
 */

import { padEan13, padEanArray } from "@/lib/utils/ean"
import { ErrorDeposito } from "./picking"

export type TipoAjusteStock = "correccion" | "entrada" | "salida"

/** Ajuste directo de stock (misma regla que la pantalla web "Ajustar stock"). */
export async function aplicarAjusteStock(sb: any, articuloId: string, cantidad: number, tipo: TipoAjusteStock) {
  const { data: art, error: fetchErr } = await sb.from("articulos").select("stock_actual").eq("id", articuloId).single()
  if (fetchErr) throw new Error(fetchErr.message)

  const stockActual = Number(art.stock_actual ?? 0)
  let nuevoStock: number
  if (tipo === "correccion") nuevoStock = cantidad
  else if (tipo === "entrada") nuevoStock = stockActual + cantidad
  else nuevoStock = stockActual - cantidad

  const { error } = await sb.from("articulos").update({ stock_actual: nuevoStock }).eq("id", articuloId)
  if (error) throw new Error(error.message)
  return { success: true, nuevoStock, stockAnterior: stockActual }
}

export interface DatosArticuloDeposito {
  ean13?: string[] | null
  codigo_bulto?: string | null
  unidades_por_bulto?: number | null
  unidad_de_medida?: string | null
  orden_deposito?: number | null
  tipo_fraccion?: string | null
  cantidad_fraccion?: number | null
}

export const CAMPOS_DATOS_ARTICULO = [
  "ean13", "codigo_bulto", "unidades_por_bulto", "unidad_de_medida", "orden_deposito", "tipo_fraccion", "cantidad_fraccion",
] as const
type CampoDatos = (typeof CAMPOS_DATOS_ARTICULO)[number]

export function normalizarDatosArticulo<T extends DatosArticuloDeposito>(datos: T): T {
  return {
    ...datos,
    ean13: datos.ean13 ? padEanArray(datos.ean13) : datos.ean13,
    codigo_bulto: datos.codigo_bulto ? padEan13(datos.codigo_bulto) : datos.codigo_bulto,
  }
}

/** Forma canónica de un valor para comparar (EAN: conjunto ordenado; vacío = null). */
function canon(campo: CampoDatos, v: unknown): string {
  if (campo === "ean13") {
    const arr = Array.isArray(v) ? v : v ? [v] : []
    return JSON.stringify(padEanArray(arr.map(String)).filter(Boolean).sort())
  }
  if (v === undefined || v === null || v === "") return "null"
  if (campo === "codigo_bulto") return padEan13(String(v))
  return String(v).trim()
}

export type CambiosArticulo = Partial<Record<CampoDatos, { antes: unknown; despues: unknown }>>

const ETIQUETA_CAMPO: Record<CampoDatos, string> = {
  ean13: "EAN",
  codigo_bulto: "código de bulto",
  unidades_por_bulto: "unidades por bulto",
  unidad_de_medida: "tipo de bulto",
  orden_deposito: "orden de depósito",
  tipo_fraccion: "tipo de fracción",
  cantidad_fraccion: "unidades por fracción",
}

/**
 * Edición offline con compare-and-set POR CAMPO (misma política que cliente.editar,
 * MOBILE.md §6): cada campo se aplica solo si en el servidor sigue valiendo lo que
 * veía el operario (`antes`) — o si ya vale `despues` (reintento). Los campos que
 * otro usuario cambió mientras tanto NO se pisan y se informan.
 */
export async function aplicarDatosArticuloCAS(sb: any, articuloId: string, cambios: CambiosArticulo) {
  const campos = (Object.keys(cambios) as CampoDatos[]).filter((c) => (CAMPOS_DATOS_ARTICULO as readonly string[]).includes(c))
  if (campos.length === 0) return { aplicados: [] as string[], conflictos: [] as string[] }

  const { data: art, error } = await sb.from("articulos").select(`id, descripcion, ${campos.join(", ")}`).eq("id", articuloId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!art) throw new ErrorDeposito("El artículo ya no existe.", 404, { codigo: "articulo_inexistente" })

  const update: Record<string, unknown> = {}
  const conflictos: CampoDatos[] = []
  for (const c of campos) {
    const actual = canon(c, (art as any)[c])
    const { antes, despues } = cambios[c]!
    if (actual === canon(c, despues)) continue // ya aplicado
    if (actual === canon(c, antes)) update[c] = despues === "" ? null : despues
    else conflictos.push(c)
  }

  if (Object.keys(update).length > 0) {
    const { error: upErr } = await sb.from("articulos").update(normalizarDatosArticulo(update as DatosArticuloDeposito)).eq("id", articuloId)
    if (upErr) throw new Error(upErr.message)
  }
  return {
    aplicados: Object.keys(update),
    conflictos: conflictos.map((c) => ETIQUETA_CAMPO[c]),
    descripcion: (art as any).descripcion as string,
  }
}

export async function proveedorInexistenteId(sb: any): Promise<string | null> {
  const { data } = await sb.from("proveedores").select("id").ilike("nombre", "inexistente").limit(1)
  return data?.[0]?.id ?? null
}

/** Cambia el proveedor del artículo a INEXISTENTE (descarte para futura eliminación). Idempotente. */
export async function enviarArticuloAInexistente(sb: any, articuloId: string) {
  const inexistenteId = await proveedorInexistenteId(sb)
  if (!inexistenteId) throw new ErrorDeposito('No existe el proveedor "INEXISTENTE" en la base', 409, { codigo: "sin_proveedor_inexistente" })
  const { error } = await sb.from("articulos").update({ proveedor_id: inexistenteId }).eq("id", articuloId)
  if (error) throw new Error(error.message)
  return { success: true, proveedor_id: inexistenteId }
}
