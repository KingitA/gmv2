import type { SupabaseClient } from "@supabase/supabase-js"

export interface ConfirmarCobranzaResult {
  numero_recibo: string | null
  recibo_id: string | null
  /** Comprobantes que quedaron totalmente pagados con esta confirmación. */
  paidComprobanteIds: string[]
  yaEstabaConfirmado: boolean
}

/**
 * Confirmación ÚNICA y reutilizable de una cobranza (pago de cliente).
 *
 * Desde Fase A1 toda la lógica vive en la función SQL transaccional
 * `cobranza_confirmar` (supabase/migrations/20260706_a1_cobranza_rpc.sql):
 *  1. aplica las imputaciones pendientes al saldo_pendiente de los comprobantes,
 *  2. postea el haber al libro mayor (cuenta_corriente_clientes vía cc_postear),
 *  3. genera el recibo numerado (FOR UPDATE en numeración: sin races),
 *  4. registra el/los movimientos en kardex_contable (caja/banco/cartera),
 *  5. marca el pago como 'confirmado'.
 * Todo o nada: un fallo revierte la transacción completa.
 *
 * Idempotente: re-llamarla sobre un pago confirmado no duplica libro mayor,
 * recibo ni kardex. La usan el alta ERP (confirmación en el acto), la revisión
 * de pagos y la rendición de viaje/vendedor.
 *
 * @param supabase cliente con permisos de escritura (server/admin)
 * @param _admin   conservado por compatibilidad de firma (la numeración ahora
 *                 se resuelve dentro del RPC SECURITY DEFINER)
 */
export async function confirmarCobranza(
  supabase: SupabaseClient,
  _admin: SupabaseClient,
  { pagoId, usuarioId }: { pagoId: string; usuarioId: string },
): Promise<ConfirmarCobranzaResult> {
  const { data, error } = await supabase.rpc("cobranza_confirmar", {
    p_pago_id: pagoId,
    p_usuario_id: usuarioId,
  })
  if (error) throw new Error(`cobranza_confirmar: ${error.message}`)

  return {
    numero_recibo: data?.numero_recibo ?? null,
    recibo_id: data?.recibo_id ?? null,
    paidComprobanteIds: (data?.paid_comprobante_ids as string[] | null) ?? [],
    yaEstabaConfirmado: Boolean(data?.ya_confirmado),
  }
}

/**
 * Anulación COMPLETA y atómica de un pago vía RPC `cobranza_anular`:
 * restaura saldos de comprobantes, anula imputaciones/recibo/cheques,
 * contrapartida en libro mayor y kardex, y revierte comisiones 'cobrada'
 * y billetera del viajante (lo que la versión TS anterior no hacía).
 */
export async function anularCobranza(
  supabase: SupabaseClient,
  { pagoId, usuarioId, motivo }: { pagoId: string; usuarioId: string; motivo?: string },
): Promise<{ yaAnulado: boolean; estabaConfirmado: boolean }> {
  const { data, error } = await supabase.rpc("cobranza_anular", {
    p_pago_id: pagoId,
    p_usuario_id: usuarioId,
    p_motivo: motivo || null,
  })
  if (error) throw new Error(`cobranza_anular: ${error.message}`)
  return {
    yaAnulado: Boolean(data?.ya_anulado),
    estabaConfirmado: Boolean(data?.estaba_confirmado),
  }
}
