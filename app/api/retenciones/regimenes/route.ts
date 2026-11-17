import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { hoyISO, sumarDiasISO } from '@/lib/formato'

/**
 * Regímenes de retención de Ganancias (RG 830) — E-59. Solo admin.
 *
 * GET → { vigentes: [...], historial: [...] }
 * PUT → { clave, vigencia_desde, alicuota_inscripto, alicuota_no_inscripto,
 *         minimo_no_sujeto, retencion_minima, descripcion? }
 *       Si vigencia_desde es la misma del régimen vigente, corrige esa fila.
 *       Si es posterior, CIERRA la vigente (vigencia_hasta = día anterior) e inserta
 *       una nueva: lo ya calculado con los valores viejos no cambia.
 *
 * Los códigos del TXT de SICORE no se editan acá.
 */

const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const numero = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET() {
  const auth = await requirePermiso('ordenes_pago')
  if (auth.error) return auth.error
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('retencion_regimenes').select('*')
    .order('clave').order('vigencia_desde', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const hoy = hoyISO()
  const vigente = (r: any) => r.vigencia_desde <= hoy && (!r.vigencia_hasta || r.vigencia_hasta >= hoy)
  const filas = data ?? []
  return NextResponse.json({
    vigentes: filas.filter(vigente),
    futuros: filas.filter((r: any) => r.vigencia_desde > hoy),
    historial: filas.filter((r: any) => r.vigencia_hasta && r.vigencia_hasta < hoy),
  })
}

export async function PUT(request: Request) {
  const auth = await requirePermiso('ordenes_pago')
  if (auth.error) return auth.error
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 }) }

  const clave = String(body?.clave ?? '').trim()
  const desde = body?.vigencia_desde
  const alicIns = numero(body?.alicuota_inscripto), alicNo = numero(body?.alicuota_no_inscripto)
  const minimo = numero(body?.minimo_no_sujeto), retMin = numero(body?.retencion_minima)
  if (!clave) return NextResponse.json({ error: 'Falta el régimen' }, { status: 400 })
  if (!esFecha(desde)) return NextResponse.json({ error: 'La fecha "vigente desde" no es válida' }, { status: 400 })
  if (alicIns === null || alicNo === null || minimo === null || retMin === null) {
    return NextResponse.json({ error: 'Completá las dos alícuotas, el mínimo no sujeto y la retención mínima' }, { status: 400 })
  }
  if (alicIns < 0 || alicIns > 100 || alicNo < 0 || alicNo > 100 || minimo < 0 || retMin < 0) {
    return NextResponse.json({ error: 'Las alícuotas van de 0 a 100 y los importes no pueden ser negativos' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: filas, error } = await supabase.from('retencion_regimenes').select('*').eq('clave', clave)
    .order('vigencia_desde', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const actual = (filas ?? []).find((r: any) => !r.vigencia_hasta) ?? (filas ?? [])[0]
  if (!actual) return NextResponse.json({ error: `No existe el régimen "${clave}"` }, { status: 404 })

  const valores = {
    alicuota_inscripto: alicIns, alicuota_no_inscripto: alicNo, minimo_no_sujeto: minimo, retencion_minima: retMin,
    ...(typeof body.descripcion === 'string' && body.descripcion.trim() ? { descripcion: body.descripcion.trim() } : {}),
  }

  if (desde === actual.vigencia_desde) {
    // Corrección de la fila vigente (mismo "desde")
    const { error: upErr } = await supabase.from('retencion_regimenes').update(valores).eq('id', actual.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    return NextResponse.json({ success: true, modo: 'corregido' })
  }
  if (desde < actual.vigencia_desde) {
    return NextResponse.json({
      error: `La fecha tiene que ser igual o posterior al ${actual.vigencia_desde.slice(8, 10)}/${actual.vigencia_desde.slice(5, 7)}/${actual.vigencia_desde.slice(0, 4)}, que es desde cuando rige el valor actual.`,
    }, { status: 400 })
  }

  // Valor nuevo desde una fecha: se inserta primero y después se cierra el anterior
  const { error: insErr } = await supabase.from('retencion_regimenes').insert({
    clave, descripcion: valores.descripcion ?? actual.descripcion,
    codigo_impuesto_txt: actual.codigo_impuesto_txt, codigo_regimen_txt: actual.codigo_regimen_txt,
    alicuota_inscripto: alicIns, alicuota_no_inscripto: alicNo, minimo_no_sujeto: minimo, retencion_minima: retMin,
    vigencia_desde: desde, vigencia_hasta: null,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  const { error: cierreErr } = await supabase.from('retencion_regimenes')
    .update({ vigencia_hasta: sumarDiasISO(desde, -1) }).eq('id', actual.id)
  if (cierreErr) {
    return NextResponse.json({ error: `Se cargó el valor nuevo pero no se pudo cerrar el anterior: ${cierreErr.message}. Avisá a sistemas.` }, { status: 500 })
  }
  return NextResponse.json({ success: true, modo: 'nuevo_desde_fecha' })
}
