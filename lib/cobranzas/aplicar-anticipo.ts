import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmarCobranza } from "@/lib/actions/cobranzas"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"
import { disponibleDePago, TIPOS_CREDITO } from "@/lib/cuenta-corriente/pago-disponible"

const DEBITOS = new Set(["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Regla del dueño (16/10/2026): un anticipo a un pedido sin facturar NUNCA se
 * aplica a facturas viejas; cuando el pedido se factura, el anticipo se aplica
 * solo a los comprobantes de ESE pedido. Antes quedaba a cuenta para siempre
 * hasta que alguien se acordara de imputarlo.
 *
 *  - Pago confirmado → imputa ya (cobranza_confirmar es idempotente y aplica solo
 *    las imputaciones nuevas), igual que el botón Imputar de Caja.
 *  - Pago todavía pendiente (sin verificar / sin rendir) → deja la imputación
 *    pendiente: se aplica sola cuando la oficina confirme el cobro.
 *  - Pago anulado o rechazado → no hace nada.
 * Nunca imputa más que lo disponible del pago ni más que el saldo del comprobante.
 */
export async function aplicarAnticipoAFactura(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  { pagoId, comprobanteIds, usuarioId }: { pagoId: string; comprobanteIds: string[]; usuarioId: string },
): Promise<{ aplicado: number; estado_pago: string | null }> {
  if (!pagoId || !comprobanteIds.length) return { aplicado: 0, estado_pago: null }

  const [{ data: pago }, { data: imps }, { data: comps }] = await Promise.all([
    supabase.from("pagos_clientes").select("id, monto, estado").eq("id", pagoId).maybeSingle(),
    supabase
      .from("imputaciones")
      .select("monto_imputado, estado, comprobante_id, comprobantes_venta!imputaciones_comprobante_id_fkey(tipo_comprobante)")
      .eq("pago_id", pagoId),
    supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, saldo_pendiente, fecha, numero_comprobante")
      .in("id", comprobanteIds)
      .is("anulado_en", null),
  ])
  if (!pago) return { aplicado: 0, estado_pago: null }
  const estado = String(pago.estado)
  if (estado === "anulado" || estado === "rechazado") return { aplicado: 0, estado_pago: estado }

  let disponible = disponibleDePago(
    pago.monto,
    (imps || []).map((i: any) => ({
      monto_imputado: i.monto_imputado,
      estado: i.estado,
      tipo_comprobante_destino: i.comprobantes_venta?.tipo_comprobante ?? null,
    })),
  )
  if (disponible <= 0.009) return { aplicado: 0, estado_pago: estado }

  const yaImputados = new Set((imps || []).filter((i: any) => i.estado !== "anulado").map((i: any) => i.comprobante_id))
  const destinos = (comps || [])
    .filter((c: any) => DEBITOS.has(c.tipo_comprobante) && !TIPOS_CREDITO.includes(c.tipo_comprobante) && Number(c.saldo_pendiente) > 0.009 && !yaImputados.has(c.id))
    .sort((a: any, b: any) => (a.fecha || "").localeCompare(b.fecha || "") || (a.numero_comprobante || "").localeCompare(b.numero_comprobante || ""))

  let aplicado = 0
  for (const c of destinos) {
    if (disponible <= 0.009) break
    const monto = r2(Math.min(disponible, Number(c.saldo_pendiente)))
    const { error } = await supabase.from("imputaciones").insert({
      pago_id: pagoId,
      comprobante_id: c.id,
      tipo_comprobante: "venta",
      monto_imputado: monto,
      estado: "pendiente",
    })
    if (error) throw new Error(`imputar anticipo a ${c.numero_comprobante}: ${error.message}`)
    disponible = r2(disponible - monto)
    aplicado = r2(aplicado + monto)
  }

  if (aplicado > 0 && estado === "confirmado") {
    await confirmarCobranza(supabase, admin, { pagoId, usuarioId })
    await procesarPostConfirmacion(supabase, admin, { pagoId, usuarioId })
  }
  return { aplicado, estado_pago: estado }
}
