/**
 * POST /api/arca/huerfanos/[id]/reintentar
 *
 * Recupera un comprobante huérfano: ARCA ya lo autorizó (tiene CAE), solo
 * falló el registro local. Recrea comprobantes_venta + detalle desde el
 * payload guardado al momento de la emisión. NO toca ARCA, NO recalcula nada.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: log, error: logErr } = await supabase
      .from('arca_solicitudes_cae')
      .select('*')
      .eq('id', id)
      .single()

    if (logErr || !log) {
      return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })
    }
    if (log.estado !== 'huerfano') {
      return NextResponse.json({
        error: `El registro está en estado "${log.estado}" — solo se pueden reintentar huérfanos.`,
      }, { status: 422 })
    }

    // Idempotencia: si el comprobante ya existe (reintento previo a medias), solo vincular
    const { data: existente } = await supabase
      .from('comprobantes_venta')
      .select('id')
      .eq('tipo_comprobante', log.tipo_comprobante)
      .eq('numero_comprobante', log.numero)
      .maybeSingle()

    if (existente) {
      await supabase.from('arca_solicitudes_cae')
        .update({ estado: 'comprobante_creado', comprobante_id: existente.id })
        .eq('id', log.id)
      return NextResponse.json({ success: true, ya_existia: true, comprobante_id: existente.id })
    }

    const payload = log.payload as { comprobante: Record<string, unknown>; detalle: Record<string, unknown>[] }
    if (!payload?.comprobante) {
      return NextResponse.json({ error: 'El registro no tiene payload de recuperación.' }, { status: 422 })
    }

    const { data: comprobante, error: insErr } = await supabase
      .from('comprobantes_venta')
      .insert(payload.comprobante)
      .select('id')
      .single()

    if (insErr || !comprobante) {
      return NextResponse.json({
        error: 'El reintento volvió a fallar: ' + (insErr?.message ?? 'sin detalle') +
               `. El comprobante ${log.tipo_comprobante} ${log.numero} (CAE ${log.cae}) sigue pendiente de registro.`,
      }, { status: 500 })
    }

    if (payload.detalle?.length) {
      const detalleInserts = payload.detalle.map(d => ({ ...d, comprobante_id: comprobante.id }))
      const { error: detErr } = await supabase.from('comprobantes_venta_detalle').insert(detalleInserts)
      if (detErr) {
        console.error('[arca/reintentar] Comprobante creado pero detalle falló:', detErr.message)
      }
    }

    await supabase.from('arca_solicitudes_cae')
      .update({ estado: 'comprobante_creado', comprobante_id: comprobante.id, error_insert: null })
      .eq('id', log.id)

    return NextResponse.json({
      success: true,
      comprobante_id: comprobante.id,
      numero: log.numero,
      tipo: log.tipo_comprobante,
      cae: log.cae,
    })
  } catch (err: any) {
    console.error('[arca/reintentar] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
