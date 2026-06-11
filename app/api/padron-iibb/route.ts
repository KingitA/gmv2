/**
 * Padrón de alícuotas de percepción IIBB.
 *
 * GET  → estado del padrón por jurisdicción (cantidad de CUITs, vigencia, alerta vencido)
 * POST → importación masiva desde CSV
 *        Body JSON: { jurisdiccion: '916', csv: 'cuit;alicuota;desde;hasta\n...' , reemplazar?: boolean }
 *        Columnas (separador ; o ,): cuit, alicuota (ej 3.5), vigencia_desde (YYYY-MM-DD),
 *        vigencia_hasta (YYYY-MM-DD). Primera fila puede ser encabezado (se detecta sola).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const hoy = new Date().toISOString().slice(0, 10)

    const { data: jurisdicciones, error } = await supabase
      .from('jurisdicciones')
      .select('codigo, nombre, percibe_iibb, alicuota_general')
      .eq('percibe_iibb', true)
      .order('codigo')

    if (error) throw error

    const estado = await Promise.all((jurisdicciones ?? []).map(async (j: any) => {
      const { count: total } = await supabase
        .from('padron_iibb')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiccion', j.codigo)

      const { count: vigentes } = await supabase
        .from('padron_iibb')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiccion', j.codigo)
        .lte('vigencia_desde', hoy)
        .gte('vigencia_hasta', hoy)

      const { data: ultimaVigencia } = await supabase
        .from('padron_iibb')
        .select('vigencia_hasta')
        .eq('jurisdiccion', j.codigo)
        .order('vigencia_hasta', { ascending: false })
        .limit(1)
        .maybeSingle()

      return {
        ...j,
        registros_total:    total ?? 0,
        registros_vigentes: vigentes ?? 0,
        vigencia_hasta:     ultimaVigencia?.vigencia_hasta ?? null,
        vencido:            (total ?? 0) > 0 && (vigentes ?? 0) === 0,
      }
    }))

    return NextResponse.json({ jurisdicciones: estado, fecha: hoy })
  } catch (err: any) {
    console.error('[padron-iibb] Error GET:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { jurisdiccion, csv, reemplazar } = await request.json()

    if (!jurisdiccion || !csv) {
      return NextResponse.json({ error: 'jurisdiccion y csv son requeridos' }, { status: 400 })
    }

    const { data: juris } = await supabase
      .from('jurisdicciones')
      .select('codigo, nombre')
      .eq('codigo', jurisdiccion)
      .single()

    if (!juris) {
      return NextResponse.json({ error: `Jurisdicción "${jurisdiccion}" no existe en el catálogo` }, { status: 422 })
    }

    const filas = String(csv).split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
    const registros: { cuit: string; jurisdiccion: string; alicuota_percepcion: number; vigencia_desde: string; vigencia_hasta: string }[] = []
    const errores: string[] = []

    for (let i = 0; i < filas.length; i++) {
      const cols = filas[i].split(/[;,]/).map(c => c.trim())
      if (cols.length < 4) { errores.push(`Línea ${i + 1}: faltan columnas (esperado cuit;alicuota;desde;hasta)`); continue }

      const cuit  = cols[0].replace(/\D/g, '')
      const alic  = parseFloat(cols[1].replace(',', '.'))
      const desde = cols[2]
      const hasta = cols[3]

      // Encabezado: primera fila sin CUIT numérico válido se ignora en silencio
      if (i === 0 && (cuit.length !== 11 || isNaN(alic))) continue

      if (cuit.length !== 11)            { errores.push(`Línea ${i + 1}: CUIT inválido "${cols[0]}"`); continue }
      if (isNaN(alic) || alic < 0 || alic > 100) { errores.push(`Línea ${i + 1}: alícuota inválida "${cols[1]}"`); continue }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        errores.push(`Línea ${i + 1}: vigencias inválidas (formato YYYY-MM-DD)`); continue
      }

      registros.push({ cuit, jurisdiccion, alicuota_percepcion: alic, vigencia_desde: desde, vigencia_hasta: hasta })
    }

    if (registros.length === 0) {
      return NextResponse.json({ error: 'Ningún registro válido para importar', errores }, { status: 422 })
    }

    if (reemplazar) {
      await supabase.from('padron_iibb').delete().eq('jurisdiccion', jurisdiccion)
    }

    // Upsert en lotes de 500
    let importados = 0
    for (let i = 0; i < registros.length; i += 500) {
      const lote = registros.slice(i, i + 500)
      const { error: upsertErr } = await supabase
        .from('padron_iibb')
        .upsert(lote, { onConflict: 'cuit,jurisdiccion,vigencia_desde' })
      if (upsertErr) throw upsertErr
      importados += lote.length
    }

    return NextResponse.json({
      success: true,
      jurisdiccion: juris.nombre,
      importados,
      descartados: errores.length,
      errores: errores.slice(0, 20),
    })
  } catch (err: any) {
    console.error('[padron-iibb] Error POST:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
