import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Alta transaccional de una cobranza vía RPC `cobranza_crear`
 * (supabase/migrations/20260811_cobranza_crear_rpc.sql):
 * pago + pagos_detalle + cheques + ítems de depósito + imputaciones en UNA
 * transacción. Con `idempotency_key` los reintentos y el doble click devuelven
 * el MISMO pago (dedup) en vez de duplicarlo.
 *
 * La usan los 4 caminos de alta: /api/pagos-clientes, /api/cobranzas,
 * /api/chofer/viaje/[id]/cobro y /api/viajante/cobro. Lo accesorio (fotos,
 * retenciones, billetera, pedidos anticipados) queda en cada endpoint, después
 * del alta — si eso falla, el pago ya está entero y consistente.
 */

export interface ChequeInput {
  banco?: string | null
  numero?: string | null
  fecha_emision?: string | null
  fecha_vencimiento?: string | null
  monto?: number
  /** BLANCO | NEGRO | PENDIENTE (la oficina lo resuelve al confirmar) */
  color?: string | null
  es_echeq?: boolean
}

export interface DetalleInput {
  tipo_pago: string
  monto: number
  caja_id?: string | null
  cuenta_bancaria_id?: string | null
  fecha_transferencia?: string | null
  numero_comprobante_pago?: string | null
  referencia?: string | null
  banco?: string | null
  numero_cheque?: string | null
  fecha_cheque?: string | null
  localidad?: string | null
  cuit_emisor?: string | null
  color_cheque?: string | null
  fecha_deposito?: string | null
  /** Cheque YA existente (ej. compartido entre clientes): se linkea directo */
  cheque_id?: string | null
  /** Si viene (y no hay cheque_id), la RPC crea el registro en cartera y lo linkea */
  cheque?: ChequeInput | null
  deposito_items?: Array<{
    tipo_item: string
    monto: number
    numero_cheque?: string | null
    banco_emisor?: string | null
    fecha_pago_cheque?: string | null
    numero_comprobante_deposito?: string | null
    fecha_deposito_efectivo?: string | null
    nro_comprobante_deposito_ef?: string | null
    cheque?: ChequeInput | null
  }>
}

export interface CrearCobranzaParams {
  idempotency_key?: string | null
  cliente_id: string
  vendedor_id?: string | null
  viaje_id?: string | null
  cobranza_id?: string | null
  cobrador_tipo?: string | null
  monto: number
  fecha_pago?: string | null
  observaciones?: string | null
  estado: "pendiente" | "pendiente_rendicion"
  creado_por: string
  detalles: DetalleInput[]
  imputaciones?: Array<{ comprobante_id: string; monto_imputado: number }>
}

export async function crearCobranza(
  supabase: SupabaseClient,
  params: CrearCobranzaParams,
): Promise<{ pago_id: string; dedup: boolean }> {
  const { data, error } = await supabase.rpc("cobranza_crear", { p_payload: params })
  if (error) throw new Error(`cobranza_crear: ${error.message}`)
  return { pago_id: data.pago_id as string, dedup: Boolean(data.dedup) }
}

/**
 * Recorta las imputaciones para que su suma nunca supere el monto del pago.
 * La RPC rechaza Σ imputaciones > monto: el excedente NO se imputa — queda
 * como saldo pendiente hasta que lo cubra la NC (10%, devolución) o un pago
 * futuro. Devuelve solo las que quedaron con monto > 0.
 *
 * Dos modos:
 * - "secuencial" (default): de primera a última, regla histórica — para pagos
 *   parciales comunes (se salda lo más viejo primero).
 * - "proporcional": cada imputación recibe la misma fracción del pago. ES EL
 *   MODO OBLIGATORIO para cobros con 10% CONTADO: el pago es el 90% del total
 *   y cada comprobante debe recibir SU 90% (la REV cubre el 10% de cada uno).
 *   Con recorte secuencial, el orden de la lista decidía qué comprobante se
 *   quedaba sin imputación → sin bonificación y pendiente (bug real, 12/08).
 */
export function recortarImputaciones<T extends { monto_imputado: number }>(
  imputaciones: T[],
  montoPago: number,
  modo: "secuencial" | "proporcional" = "secuencial",
): T[] {
  const total = imputaciones.reduce((s, i) => s + Number(i.monto_imputado), 0)
  if (total <= montoPago + 0.005) {
    return imputaciones.filter((i) => Number(i.monto_imputado) > 0.005)
  }

  if (modo === "proporcional") {
    const factor = montoPago / total
    const out = imputaciones
      .map((imp) => ({ ...imp, monto_imputado: Math.round(Number(imp.monto_imputado) * factor * 100) / 100 }))
      .filter((i) => i.monto_imputado > 0.005)
    // El último absorbe la diferencia de redondeo: Σ == monto al centavo
    const suma = out.reduce((s, i) => s + i.monto_imputado, 0)
    const diff = Math.round((montoPago - suma) * 100) / 100
    if (out.length && Math.abs(diff) > 0.001) {
      out[out.length - 1].monto_imputado = Math.round((out[out.length - 1].monto_imputado + diff) * 100) / 100
    }
    return out
  }

  let remaining = montoPago
  const out: T[] = []
  for (const imp of imputaciones) {
    const apply = Math.min(Number(imp.monto_imputado), remaining)
    if (apply > 0.005) {
      out.push({ ...imp, monto_imputado: Math.round(apply * 100) / 100 })
      remaining = Math.max(0, remaining - apply)
    }
  }
  return out
}
