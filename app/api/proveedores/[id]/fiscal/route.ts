import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * Ficha fiscal del proveedor (R6).
 *
 * GET  → { proveedor: { regimen_ganancias, condicion_ganancias, cuit, nombre },
 *          exclusiones: [...activas e históricas...], regimenes: [catálogo] }
 * PUT  → { regimen_ganancias?, condicion_ganancias?,
 *          exclusiones_nuevas?: [{ tipo, fecha_desde, fecha_hasta, porcentaje, numero_certificado, observaciones }],
 *          desactivar_exclusiones?: [ids] }
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const supabase = createAdminClient()
    const [{ data: prov }, { data: excl }, { data: regs }] = await Promise.all([
      supabase.from('proveedores').select('id, nombre, cuit, regimen_ganancias, condicion_ganancias, pago_blanco_medio, pago_blanco_plazo_cheque, pago_blanco_entrega, pago_blanco_dias, pago_blanco_desde, pago_negro_medio, pago_negro_plazo_cheque, pago_negro_entrega, pago_negro_dias, pago_negro_desde').eq('id', id).single(),
      supabase.from('excenciones_impositivas').select('*').eq('proveedor_id', id).order('fecha_desde', { ascending: false }),
      supabase.from('retencion_regimenes').select('clave, descripcion, alicuota_inscripto, minimo_no_sujeto')
        .is('vigencia_hasta', null).order('clave'),
    ])
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })
    return NextResponse.json({ proveedor: prov, exclusiones: excl ?? [], regimenes: regs ?? [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const body = await request.json()
    const supabase = createAdminClient()

    const updates: Record<string, any> = {}
    if (body.regimen_ganancias) updates.regimen_ganancias = body.regimen_ganancias
    if (body.condicion_ganancias) updates.condicion_ganancias = body.condicion_ganancias
    for (const campo of [
      'pago_blanco_medio', 'pago_blanco_plazo_cheque', 'pago_blanco_entrega', 'pago_blanco_dias', 'pago_blanco_desde',
      'pago_negro_medio', 'pago_negro_plazo_cheque', 'pago_negro_entrega', 'pago_negro_dias', 'pago_negro_desde',
    ]) {
      if (campo in body) updates[campo] = body[campo] ?? null
    }
    if (Object.keys(updates).length) {
      const { error } = await supabase.from('proveedores').update(updates).eq('id', id)
      if (error) throw error
    }

    if (Array.isArray(body.desactivar_exclusiones) && body.desactivar_exclusiones.length) {
      const { error } = await supabase
        .from('excenciones_impositivas')
        .update({ activo: false })
        .eq('proveedor_id', id)
        .in('id', body.desactivar_exclusiones)
      if (error) throw error
    }

    let creadas = 0
    for (const e of body.exclusiones_nuevas ?? []) {
      if (!e.fecha_desde || !e.porcentaje) continue
      const { error } = await supabase.from('excenciones_impositivas').insert({
        proveedor_id: id,
        tipo: e.tipo || 'retencion_ganancias',
        fecha_desde: e.fecha_desde,
        fecha_hasta: e.fecha_hasta || null,
        porcentaje_excencion: Number(e.porcentaje),
        numero_certificado: e.numero_certificado || null,
        observaciones: e.observaciones || 'Cargado desde legajo impositivo',
        activo: true,
      })
      if (error) throw error
      creadas++
    }

    return NextResponse.json({ success: true, exclusiones_creadas: creadas })
  } catch (error: any) {
    console.error('[proveedores/fiscal] PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
