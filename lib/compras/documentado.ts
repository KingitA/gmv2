import { faltaLaFuncion } from "@/lib/utils/migracion-pendiente"

/**
 * Lo DOCUMENTADO de una línea de recepción (unidades que traen los comprobantes), sumado sin
 * pisarse: dos documentos de la misma orden leídos a la vez (oficina, app Depósito, mail) suman
 * los dos. Con la migración 20261118e es un solo UPDATE en la base
 * (`recepcion_item_sumar_documentado`); sin ella queda el camino anterior (leer el valor fresco,
 * sumar y escribir), que es lo que se pisaba.
 *
 * `datos`: lo demás que se anota junto con la suma (precio documentado, factor…). Solo las claves
 * que se pasan se escriben.
 * Devuelve lo documentado que quedó, o null si la línea ya no existe.
 */
export interface DatosDocumentado {
  precio_documentado?: number
  precio_real?: number
  cantidad_base?: number
  factor_conversion?: number
  conversion_source?: string | null
  requires_review?: boolean
}

export async function sumarDocumentado(supabase: any, recepcionItemId: string | null | undefined, delta: number, datos: DatosDocumentado = {}): Promise<number | null> {
  if (!recepcionItemId) return null
  const limpio: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(datos)) if (v !== undefined) limpio[k] = v
  if (Math.abs(delta) < 0.0001 && Object.keys(limpio).length === 0) return null

  const rpc = await supabase.rpc("recepcion_item_sumar_documentado", { p_item_id: recepcionItemId, p_delta: delta, p_datos: limpio })
  if (!rpc.error) return rpc.data == null ? null : Number(rpc.data)
  if (!faltaLaFuncion(rpc.error, "recepcion_item_sumar_documentado")) throw rpc.error

  // Sin la migración: leer el valor fresco justo antes de escribir
  const { data: it } = await supabase.from("recepciones_items").select("id, cantidad_documentada").eq("id", recepcionItemId).maybeSingle()
  if (!it) return null
  const nueva = Math.max(0, Math.round((Number(it.cantidad_documentada || 0) + delta) * 10000) / 10000)
  const { error } = await supabase.from("recepciones_items")
    .update({ ...limpio, cantidad_documentada: nueva, ...(nueva === 0 ? { precio_documentado: 0 } : {}) })
    .eq("id", it.id)
  if (error) throw error
  return nueva
}
