/**
 * Confirmar una orden de pago: EL camino único. Lo usan el tilde verde de la lista
 * (POST /api/ordenes-pago/[id]/confirmar) y la confirmación sola cuando el banco confirma la
 * firma (lib/bancos/confirmar-sola.ts). Todo lo que mueve plata pasa en la función de la base
 * op_confirmar (CC proveedor + retenciones + imputaciones + vencimientos + kardex + cheques, en
 * una transacción con guardas de idempotencia). Solo servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { bloqueoPorBanco } from "@/lib/bancos/operaciones"
import { anotarResponsableOP } from "./responsable"

export type ResultadoConfirmar =
  | { ok: true; data: Record<string, any> }
  | { ok: false; error: string; status: number; error_code?: string }

export async function confirmarOrdenPago(
  supabase: SupabaseClient, opId: string, usuarioId: string | null,
  o: { cajaId?: string | null; cuentaBancoId?: string | null; aceptarRetencion?: boolean } = {},
): Promise<ResultadoConfirmar> {
  // Tanda 2-A: si un pago de esta orden se mandó a Credicoop y todavía no está firmado y
  // procesado, la orden no se confirma: el pago no se da por hecho hasta que el banco lo diga.
  const esperaBanco = await bloqueoPorBanco(supabase, opId)
  if (esperaBanco) return { ok: false, error: esperaBanco, status: 409, error_code: "ESPERA_BANCO" }

  // Si la OP guardó el origen de fondos al crearse (cuenta_origen_* en el detalle), usarlo sin
  // volver a preguntar. Lo que se pasa explícito gana.
  let cajaId = o.cajaId ?? null
  let cuentaBancoId = o.cuentaBancoId ?? null
  if (!cajaId || !cuentaBancoId) {
    const { data: det } = await supabase.from("ordenes_pago_detalle").select("cuenta_origen_tipo, cuenta_origen_id").eq("orden_pago_id", opId)
    if (!cajaId) cajaId = det?.find((d) => d.cuenta_origen_tipo === "CAJA" && d.cuenta_origen_id)?.cuenta_origen_id ?? null
    if (!cuentaBancoId) cuentaBancoId = det?.find((d) => d.cuenta_origen_tipo === "BANCO" && d.cuenta_origen_id)?.cuenta_origen_id ?? null
  }

  const args = { p_op_id: opId, p_usuario_id: usuarioId, p_caja_id: cajaId, p_cuenta_banco_id: cuentaBancoId }
  // E-57: la retención se calcula con el día de la confirmación. Si cambió desde que se armó la
  // orden y la pantalla ya lo mostró y se aceptó (aceptarRetencion), se actualiza y se confirma en
  // la misma transacción. Sin la migración 20261117p_ordenes_pago_t1d.sql, o sin aceptar, se
  // confirma como siempre (y si cambió, la base corta con el motivo).
  let res = o.aceptarRetencion === true ? await supabase.rpc("op_confirmar_ajustando", args) : await supabase.rpc("op_confirmar", args)
  if (res.error && o.aceptarRetencion === true
    && (res.error.code === "PGRST202" || res.error.code === "42883") && /op_confirmar_ajustando/.test(res.error.message || "")) {
    res = await supabase.rpc("op_confirmar", args)
  }
  if (res.error) return { ok: false, error: res.error.message, status: 400 }

  // Quién hizo salir la plata (Jarvis: "¿quién pagó / autorizó este pago?")
  await anotarResponsableOP(supabase, opId, "confirmado", usuarioId)
  return { ok: true, data: (res.data ?? {}) as Record<string, any> }
}
