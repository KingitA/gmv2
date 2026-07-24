import type { SupabaseClient } from "@supabase/supabase-js"

export type ColorCheque = "BLANCO" | "NEGRO"

/** Color de cheque sin asignar: el pago no imputa a comprobantes (a cuenta /
 *  anticipo). La oficina debe asignar BLANCO/NEGRO al confirmar la cobranza;
 *  confirmarCobranza bloquea mientras quede PENDIENTE. */
export const COLOR_PENDIENTE = "PENDIENTE"

/** Devuelve el color explícito BLANCO/NEGRO si el operador lo eligió a mano
 *  (override), o null si vino vacío/AUTO/ECHEQ. */
export function colorOverride(valor: unknown): ColorCheque | null {
  return valor === "BLANCO" || valor === "NEGRO" ? valor : null
}

/**
 * Deriva el color de los cheques de una cobranza según a qué se imputa:
 * más del 50% del monto imputado a presupuestos (PRES) ⇒ NEGRO; si no
 * (incluido el empate exacto 50/50) ⇒ BLANCO. Sin imputaciones ⇒ null
 * (el llamador decide: override manual o COLOR_PENDIENTE).
 *
 * Acepta ambos formatos de imputación que circulan en los POST de cobro:
 * { comprobante_id, monto_imputado } (ERP/cobranzas/chofer) y
 * { comprobante_id, monto } (viajante).
 */
export async function derivarColorCheque(
  supabase: SupabaseClient,
  imputaciones:
    | Array<{ comprobante_id: string; monto_imputado?: number | string; monto?: number | string }>
    | null
    | undefined,
): Promise<ColorCheque | null> {
  const imps = (imputaciones || []).filter((i) => i?.comprobante_id)
  if (!imps.length) return null

  const ids = [...new Set(imps.map((i) => i.comprobante_id))]
  const { data, error } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante")
    .in("id", ids)
  if (error) throw new Error(`derivarColorCheque: ${error.message}`)

  const tipoPorId = new Map((data || []).map((c: any) => [c.id, c.tipo_comprobante]))
  let total = 0
  let presupuesto = 0
  for (const imp of imps) {
    const monto = Number(imp.monto_imputado ?? imp.monto ?? 0)
    if (!(monto > 0)) continue
    total += monto
    if (tipoPorId.get(imp.comprobante_id) === "PRES") presupuesto += monto
  }
  if (total <= 0) return null
  return presupuesto / total > 0.5 ? "NEGRO" : "BLANCO"
}

/**
 * Resuelve los cheques en color PENDIENTE de un pago antes de confirmarlo:
 * usa el color explícito de la oficina si vino, sino re-deriva de las
 * imputaciones que el pago tenga AHORA (pueden haberse agregado después de
 * crearse el cheque). Actualiza pagos_detalle + cheques (incluidos los de
 * depósitos). Devuelve pendiente:true si no hay forma de resolver el color
 * (el llamador debe cortar: el kardex solo admite BLANCO/NEGRO).
 */
export async function resolverColorPendientes(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  pagoId: string,
  colorExplicito?: ColorCheque | null,
): Promise<{ pendiente: boolean }> {
  const { data: detalles, error } = await supabase
    .from("pagos_detalle")
    .select("id, cheque_id")
    .eq("pago_id", pagoId)
    .eq("color_cheque", COLOR_PENDIENTE)
  if (error) throw new Error(`resolverColorPendientes: ${error.message}`)
  if (!detalles?.length) return { pendiente: false }

  let color = colorOverride(colorExplicito)
  if (!color) {
    const { data: imps } = await supabase
      .from("imputaciones")
      .select("comprobante_id, monto_imputado")
      .eq("pago_id", pagoId)
      .neq("estado", "anulado")
    color = await derivarColorCheque(supabase, imps || [])
  }
  if (!color) return { pendiente: true }

  const detalleIds = detalles.map((d: any) => d.id)
  const chequeIds = detalles.map((d: any) => d.cheque_id).filter(Boolean)

  // Cheques dentro de depósitos de esos detalles
  const { data: depItems } = await supabase
    .from("pago_deposito_items")
    .select("cheque_id")
    .in("pago_detalle_id", detalleIds)
    .not("cheque_id", "is", null)
  for (const it of depItems || []) chequeIds.push(it.cheque_id)

  const { error: updDetErr } = await supabase
    .from("pagos_detalle")
    .update({ color_cheque: color })
    .in("id", detalleIds)
  if (updDetErr) throw new Error(`resolverColorPendientes (detalle): ${updDetErr.message}`)

  if (chequeIds.length) {
    const { error: updChqErr } = await admin
      .from("cheques")
      .update({ color })
      .in("id", chequeIds)
      .eq("color", COLOR_PENDIENTE)
    if (updChqErr) throw new Error(`resolverColorPendientes (cheque): ${updChqErr.message}`)
  }
  return { pendiente: false }
}
