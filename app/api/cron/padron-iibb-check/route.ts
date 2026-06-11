/**
 * Cron mensual (día 1) — verifica la vigencia del padrón IIBB cargado.
 *
 * Si el padrón de alguna jurisdicción donde percibimos está vencido (no quedan
 * registros vigentes a la fecha), lo deja registrado en logs de Vercel y la UI
 * de /tablas/padron-iibb muestra la alerta.
 *
 * Pendiente: descarga automática del padrón oficial — Río Negro lo publica para
 * agentes registrados en el portal de ARTRN (requiere credenciales de agente).
 * Cuando se tenga el acceso, enganchar la descarga acá antes del chequeo.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const hoy = new Date().toISOString().slice(0, 10)

    const { data: jurisdicciones, error } = await supabase
      .from('jurisdicciones')
      .select('codigo, nombre')
      .eq('percibe_iibb', true)

    if (error) throw error

    const vencidas: string[] = []
    const sinPadron: string[] = []

    for (const j of jurisdicciones ?? []) {
      const { count: total } = await supabase
        .from('padron_iibb')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiccion', j.codigo)

      if (!total) { sinPadron.push(j.nombre); continue }

      const { count: vigentes } = await supabase
        .from('padron_iibb')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiccion', j.codigo)
        .lte('vigencia_desde', hoy)
        .gte('vigencia_hasta', hoy)

      if (!vigentes) vencidas.push(j.nombre)
    }

    if (vencidas.length || sinPadron.length) {
      console.warn('[CRON padron-iibb] Padrón vencido en:', vencidas.join(', ') || '—',
                   '| Sin padrón cargado:', sinPadron.join(', ') || '—')
    }

    return NextResponse.json({
      success: true,
      fecha: hoy,
      vencidas,
      sin_padron: sinPadron,
      ok: vencidas.length === 0,
    })
  } catch (err: any) {
    console.error('[CRON padron-iibb] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
