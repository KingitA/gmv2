import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * AJUSTE POR REDONDEO dentro de un cobro — reglas de negocio (26/08):
 *
 *  1. TOPE: como máximo el 1% de los comprobantes afectados (si los débitos
 *     tildados suman $100, se puede ajustar hasta $1). Más que eso NO es
 *     redondeo: es perdonar plata, y eso lo decide la oficina en el ERP.
 *     El tope se controla en el front (no ofrece la opción) y en el servidor
 *     (rechaza el cobro) — no hay forma de saltearlo.
 *
 *  2. PROMESA: el ajuste viaja ADENTRO del pago (marca [AJUSTE:monto]) y se
 *     asienta recién cuando la oficina CONFIRMA el cobro — igual que el 10%
 *     y los créditos. Antes entraba al libro en el acto, desde la calle, con
 *     el cobro todavía sin verificar (y quedaba descuadrado hasta confirmar).
 *     Al confirmarse se asienta con las marcas [pago:] y [saldo:], así una
 *     anulación del pago lo revierte solo.
 */

export const TOPE_AJUSTE_PCT = 0.01

const r2 = (n: number) => Math.round(n * 100) / 100

/** Máximo ajuste admitido para un conjunto de débitos (1% de su suma). */
export function topeAjuste(totalDebitos: number): number {
  return r2(Math.max(0, Number(totalDebitos) || 0) * TOPE_AJUSTE_PCT)
}

const MARCA = "[AJUSTE:"

export function marcaAjuste(monto: number): string {
  return monto > 0.005 ? `${MARCA}${r2(monto).toFixed(2)}]` : ""
}

export function parsearMarcaAjuste(obs: string | null | undefined): number {
  const m = (obs || "").match(/\[AJUSTE:([0-9]+(?:\.[0-9]+)?)\]/)
  return m ? r2(Number(m[1])) : 0
}

export function quitarMarcaAjuste(obs: string): string {
  return obs.replace(/\s*\[AJUSTE:[0-9]+(?:\.[0-9]+)?\]/, "").trim()
}

/**
 * Asienta el ajuste por redondeo de un pago YA CONFIRMADO: crédito en el
 * libro (cc_ajuste_manual) vinculado al pago, y salda el comprobante del
 * pago que quedó con saldo (el de mayor saldo si hay varios). Idempotente:
 * si ya existe un ajuste con [pago:<id>] no se repite.
 */
export async function ejecutarAjusteDePago(
  supabase: SupabaseClient,
  { pagoId, clienteId, monto, usuarioId }: { pagoId: string; clienteId: string; monto: number; usuarioId: string | null },
): Promise<string | null> {
  if (!(monto > 0.005)) return null

  const { data: yaHecho } = await supabase
    .from("cuenta_corriente_clientes")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("referencia_tipo", "ajuste_manual")
    .ilike("observaciones", `%[pago:${pagoId}]%`)
    .limit(1)
  if (yaHecho?.length) return null

  // Comprobante destino: el del pago que quedó con saldo pendiente
  const { data: imps } = await supabase
    .from("imputaciones")
    .select("comprobante_id, comprobante:comprobantes_venta!imputaciones_comprobante_id_fkey(id, saldo_pendiente, total_factura, tipo_comprobante, numero_comprobante)")
    .eq("pago_id", pagoId)
    .neq("estado", "anulado")
    .not("comprobante_id", "is", null)
  const conSaldo = (imps || [])
    .map((i: any) => i.comprobante)
    .filter((c: any) => c && Number(c.saldo_pendiente) > 0.005)
    .sort((a: any, b: any) => Number(b.saldo_pendiente) - Number(a.saldo_pendiente))
  const target = conSaldo[0] || null

  let concepto = `Ajuste por redondeo del cobro ${pagoId.slice(0, 8)}`
  if (target) concepto += ` (ref. ${target.tipo_comprobante} ${target.numero_comprobante})`
  concepto += ` [pago:${pagoId}]`
  if (target) concepto += ` [saldo:${target.id}]`

  const { error } = await supabase.rpc("cc_ajuste_manual", {
    p_cliente_id: clienteId,
    p_tipo: "credito",
    p_monto: r2(monto),
    p_concepto: concepto,
    p_usuario_id: usuarioId,
  })
  if (error) return `Ajuste por redondeo de $${r2(monto)} no se pudo asentar: ${error.message}`

  if (target) {
    const nuevoSaldo = Math.max(0, r2(Number(target.saldo_pendiente) - r2(monto)))
    await supabase
      .from("comprobantes_venta")
      .update({ saldo_pendiente: nuevoSaldo, estado_pago: nuevoSaldo <= 0.009 ? "pagado" : "parcial" })
      .eq("id", target.id)
  }
  return null
}
