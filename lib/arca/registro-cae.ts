/**
 * Registro durable de solicitudes de CAE.
 *
 * Flujo en cada emisión fiscal:
 *   1. ARCA otorga el CAE → registrarCAEObtenido() guarda número, CAE y el
 *      payload completo (cabecera + detalle) ANTES de tocar comprobantes_venta.
 *   2. Insert local OK → marcarComprobanteCreado().
 *   3. Insert local FALLA → marcarHuerfano(): el comprobante ya existe
 *      fiscalmente en ARCA; el operario lo recupera con "Reintentar registro"
 *      (Playroom → Fiscal ARCA) que recrea el registro local desde el payload
 *      SIN tocar ARCA. Nunca se debe volver a facturar.
 *
 * El log nunca bloquea la emisión: si el log mismo falla se sigue adelante
 * (con console.error) — es una red de seguridad, no un punto de falla nuevo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PayloadRecuperacion {
  comprobante: Record<string, unknown>          // insert completo de comprobantes_venta
  detalle: Record<string, unknown>[]            // inserts de detalle SIN comprobante_id
}

export async function registrarCAEObtenido(
  supabase: SupabaseClient,
  params: {
    tipo: string
    puntoVenta: string
    numero: string                              // PPPP-NNNNNNNN
    cae: string
    vencimientoCae?: string | null
    importe?: number
    clienteCuit?: string | null
    payload: PayloadRecuperacion
  },
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('arca_solicitudes_cae')
      .insert({
        tipo_comprobante: params.tipo,
        punto_venta:      params.puntoVenta,
        numero:           params.numero,
        cae:              params.cae,
        vencimiento_cae:  params.vencimientoCae ?? null,
        importe:          params.importe ?? null,
        cliente_cuit:     params.clienteCuit ?? null,
        estado:           'cae_obtenido',
        payload:          params.payload,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  } catch (e: any) {
    console.error('[RegistroCAE] No se pudo registrar la solicitud (se continúa):', e.message)
    return null
  }
}

export async function marcarComprobanteCreado(
  supabase: SupabaseClient,
  logId: string | null,
  comprobanteId: string,
): Promise<void> {
  if (!logId) return
  try {
    await supabase
      .from('arca_solicitudes_cae')
      .update({ estado: 'comprobante_creado', comprobante_id: comprobanteId })
      .eq('id', logId)
  } catch (e: any) {
    console.error('[RegistroCAE] No se pudo marcar comprobante_creado:', e.message)
  }
}

export async function marcarHuerfano(
  supabase: SupabaseClient,
  logId: string | null,
  errorInsert: string,
): Promise<void> {
  if (!logId) return
  try {
    await supabase
      .from('arca_solicitudes_cae')
      .update({ estado: 'huerfano', error_insert: errorInsert })
      .eq('id', logId)
  } catch (e: any) {
    console.error('[RegistroCAE] No se pudo marcar huerfano:', e.message)
  }
}

/** Mensaje estándar para el operario cuando el insert falla con CAE ya otorgado. */
export function mensajeHuerfano(tipo: string, numero: string, cae: string): string {
  return (
    `ARCA autorizó el comprobante ${tipo} ${numero} (CAE ${cae}) pero NO se pudo registrar en el sistema. ` +
    `NO lo vuelvas a facturar: andá a Playroom → Fiscal ARCA → "Reintentar registro" para completarlo sin tocar ARCA.`
  )
}
