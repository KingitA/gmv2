/**
 * Caché del Ticket de Acceso (TA) de ARCA en la base de datos.
 *
 * Vercel es serverless: no hay memoria compartida entre invocaciones.
 * El TA (válido 12 horas) se guarda en configuracion_empresa para
 * reutilizarlo entre requests sin pedir uno nuevo en cada factura.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { obtenerTicketAcceso } from './wsaa'
import type { AmbienteARCA } from './tipos'

const MARGEN_RENOVACION_MS = 30 * 60 * 1000 // renovar 30 min antes de expirar

export async function obtenerTAConCache(
  supabase: SupabaseClient,
  ambiente: AmbienteARCA,
): Promise<{ token: string; sign: string }> {
  const certPem = process.env.ARCA_CERTIFICADO
  const keyPem  = process.env.ARCA_CLAVE_PRIVADA

  if (!certPem || !keyPem) {
    throw new Error(
      'Facturación electrónica no configurada. ' +
      'Cargá las variables de entorno ARCA_CERTIFICADO y ARCA_CLAVE_PRIVADA en Vercel.',
    )
  }

  // Leer TA cacheado de la DB
  const { data: config } = await supabase
    .from('configuracion_empresa')
    .select('id, arca_ta_token, arca_ta_sign, arca_ta_expiracion')
    .single()

  const ahora = Date.now()
  const expiracion = config?.arca_ta_expiracion
    ? new Date(config.arca_ta_expiracion).getTime()
    : 0

  if (
    config?.arca_ta_token &&
    config?.arca_ta_sign &&
    expiracion - ahora > MARGEN_RENOVACION_MS
  ) {
    // TA todavía válido
    return { token: config.arca_ta_token, sign: config.arca_ta_sign }
  }

  // Pedir TA nuevo al WSAA
  const ta = await obtenerTicketAcceso('wsfe', certPem, keyPem, ambiente)

  // Guardarlo en DB
  await supabase
    .from('configuracion_empresa')
    .update({
      arca_ta_token:      ta.token,
      arca_ta_sign:       ta.sign,
      arca_ta_expiracion: ta.expiracion.toISOString(),
    })
    .eq('id', config!.id)

  return { token: ta.token, sign: ta.sign }
}
