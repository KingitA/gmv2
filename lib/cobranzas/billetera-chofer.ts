import type { SupabaseClient } from "@supabase/supabase-js"

// Billetera del chofer ↔ cobros en el reparto.
//
// REGLA: cada cobro se asienta en la billetera del titular con la referencia AL PAGO
// (`referencia_tipo = 'pago_cliente'`, `referencia_id = pago.id`), igual que el cobro del
// vendedor (app/api/viajante/cobro). `cobranza_anular` revierte la billetera buscando
// exactamente esa referencia.
//
// BUG que esto corrige (30/09/2026, encontrado en el checklist contra producción): el cobro
// del chofer se asentaba con la referencia AL VIAJE (`'viaje'`, id del viaje). Al anular el
// cobro, `cobranza_anular` no encontraba el movimiento y la billetera quedaba con la plata
// de un cobro que ya no existía. Además, los cobros a "otros clientes" de un cobro conjunto
// no se asentaban nunca (y la rendición los debitaba igual).
//
// Los cobros viejos (asentados con la referencia al viaje) que se anulen de acá en más se
// compensan con `compensarBilleteraLegada`.

export const REF_PAGO = "pago_cliente"
export const REF_ANULACION = "pago_anulacion"
const REF_VIAJE_LEGADO = "viaje"

export interface MovimientoBilletera {
  tipo: string
  monto: number
  referencia_tipo: string | null
  referencia_id: string | null
}

const medioDe = (metodos: Array<{ tipo?: string }> | undefined) =>
  metodos?.[0]?.tipo === "efectivo" ? "efectivo" : metodos?.[0]?.tipo === "cheque" ? "cheque" : "transferencia"

/** Asienta un cobro del reparto en la billetera del titular, referenciado al pago. */
export async function asentarCobroEnBilletera(
  supabase: SupabaseClient,
  p: { titularId: string; pagoId: string; monto: number; metodos: Array<{ tipo?: string }>; usuarioId: string; fecha: string },
) {
  const { error } = await supabase.from("billetera_movimientos").insert({
    viajante_id: p.titularId, // titular: el acompañante cobra contra su billetera
    tipo: "cobro_cliente",
    medio: medioDe(p.metodos),
    monto: p.monto,
    concepto: "Cobro cliente",
    referencia_id: p.pagoId,
    referencia_tipo: REF_PAGO,
    creado_por: p.usuarioId,
    fecha: p.fecha,
  })
  if (error) console.error("[chofer/cobro] billetera:", error.message)
}

/**
 * Parte pura: ¿la anulación de este pago dejó la billetera sin revertir? Pasa cuando el cobro
 * es de los viejos (asentado con la referencia al viaje): no hay movimiento referenciado al
 * pago, no hay reversa de anulación, y sí existe un cobro del viaje por ese mismo monto.
 */
export function necesitaCompensacionLegada(movs: MovimientoBilletera[], pagoId: string, viajeId: string, monto: number): boolean {
  const delPago = movs.filter((m) => m.referencia_id === pagoId)
  if (delPago.some((m) => m.referencia_tipo === REF_PAGO)) return false // asentado bien: lo revierte cobranza_anular
  if (delPago.some((m) => m.referencia_tipo === REF_ANULACION)) return false // ya compensado
  return movs.some(
    (m) => m.tipo === "cobro_cliente" && m.referencia_tipo === REF_VIAJE_LEGADO && m.referencia_id === viajeId && Math.abs(Number(m.monto) - monto) < 0.005,
  )
}

/** Tras anular un cobro VIEJO del chofer: débito compensatorio en la billetera (idempotente por pago). */
export async function compensarBilleteraLegada(
  supabase: SupabaseClient,
  p: { titularId: string; pagoId: string; viajeId: string; monto: number; usuarioId: string },
): Promise<boolean> {
  const { data: movs, error } = await supabase
    .from("billetera_movimientos")
    .select("tipo, monto, referencia_tipo, referencia_id")
    .eq("viajante_id", p.titularId)
    .in("referencia_id", [p.pagoId, p.viajeId])
  if (error) throw error
  if (!necesitaCompensacionLegada((movs || []) as MovimientoBilletera[], p.pagoId, p.viajeId, p.monto)) return false
  const { error: insErr } = await supabase.from("billetera_movimientos").insert({
    viajante_id: p.titularId,
    tipo: "debito",
    monto: -Math.abs(p.monto),
    concepto: `Reversa por anulación de pago ${p.pagoId.slice(0, 8)}`,
    referencia_id: p.pagoId,
    referencia_tipo: REF_ANULACION,
    fecha: new Date().toISOString(),
    creado_por: p.usuarioId,
  })
  if (insErr) throw insErr
  return true
}
