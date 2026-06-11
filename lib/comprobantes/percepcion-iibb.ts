/**
 * Resolución de la alícuota de percepción IIBB del cliente.
 *
 * Prioridad (auditoría fiscal 11/06/2026, tarea 8):
 *   1. clientes.percepcion_iibb — override manual de excepción (si está cargado y > 0)
 *   2. padron_iibb — alícuota vigente por CUIT + jurisdicción (padrón oficial importado)
 *   3. jurisdicciones.alicuota_general — fallback por norma de la jurisdicción
 *
 * No se percibe IIBB en jurisdicciones con percibe_iibb = false (ej: Buenos Aires,
 * no somos agentes ARBA). El resto de las exclusiones (exento_iibb, no-RI) las
 * aplica calcularPercepciones.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Nombre canónico de provincia (post-migración 20260611) → código CM
export const JURISDICCION_POR_PROVINCIA: Record<string, string> = {
  'ciudad autonoma de buenos aires': '901',
  'buenos aires':        '902',
  'catamarca':           '903',
  'cordoba':             '904',
  'corrientes':          '905',
  'chaco':               '906',
  'chubut':              '907',
  'entre rios':          '908',
  'formosa':             '909',
  'jujuy':               '910',
  'la pampa':            '911',
  'la rioja':            '912',
  'mendoza':             '913',
  'misiones':            '914',
  'neuquen':             '915',
  'rio negro':           '916',
  'salta':               '917',
  'san juan':            '918',
  'san luis':            '919',
  'santa cruz':          '920',
  'santa fe':            '921',
  'santiago del estero': '922',
  'tucuman':             '923',
  'tierra del fuego':    '924',
}

export function codigoJurisdiccion(provincia: string | null | undefined): string | null {
  const p = (provincia ?? '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
  return JURISDICCION_POR_PROVINCIA[p] ?? null
}

/**
 * Resuelve la alícuota de percepción IIBB a aplicar a un cliente.
 * Retorna 0 si no corresponde percibir.
 */
export async function resolverAlicuotaIIBB(
  supabase: SupabaseClient,
  cliente: { cuit?: string | null; provincia?: string | null; percepcion_iibb?: number | null },
): Promise<number> {
  // 1. Override manual de excepción en la ficha del cliente
  const override = Number(cliente.percepcion_iibb ?? 0)
  if (override > 0) return override

  const codigo = codigoJurisdiccion(cliente.provincia)
  if (!codigo) return 0

  const { data: juris } = await supabase
    .from('jurisdicciones')
    .select('percibe_iibb, alicuota_general')
    .eq('codigo', codigo)
    .single()

  if (!juris?.percibe_iibb) return 0

  // 2. Padrón oficial vigente por CUIT + jurisdicción
  const cuit = (cliente.cuit ?? '').replace(/\D/g, '')
  if (cuit) {
    const hoy = new Date().toISOString().slice(0, 10)
    const { data: padron } = await supabase
      .from('padron_iibb')
      .select('alicuota_percepcion')
      .eq('cuit', cuit)
      .eq('jurisdiccion', codigo)
      .lte('vigencia_desde', hoy)
      .gte('vigencia_hasta', hoy)
      .order('vigencia_desde', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (padron) return Number(padron.alicuota_percepcion)
  }

  // 3. Alícuota general de la jurisdicción
  return Number(juris.alicuota_general ?? 0)
}
