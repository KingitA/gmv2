import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/ordenes-compra/[id]/vincular-articulo — "no era ese artículo,
 * era este": re-vincula todas las líneas de comprobantes y recepciones de
 * esta OC del artículo equivocado al correcto (caso típico: duplicado en DB
 * o el proveedor cambió código/EAN/descripción).
 *
 * Body: {
 *   articulo_origen_id,        // el que quedó mal vinculado (ej. 33037)
 *   articulo_destino_id,       // el correcto (ej. 3037)
 *   aprender?: boolean,        // guardar equivalencia proveedor→artículo (default true)
 *   nuevo_ean?: string,        // actualizar EAN13 del artículo correcto
 *   nueva_descripcion?: string,
 *   unidades_por_bulto?: number
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id: ocId } = await params
  try {
    const body = await request.json()
    const origen = body.articulo_origen_id
    const destino = body.articulo_destino_id
    if (!origen || !destino || origen === destino) {
      return NextResponse.json({ error: 'articulo_origen_id y articulo_destino_id (distintos) son obligatorios' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: oc } = await supabase
      .from('ordenes_compra')
      .select('id, proveedor_id')
      .eq('id', ocId)
      .single()
    if (!oc) return NextResponse.json({ error: 'OC no encontrada' }, { status: 404 })

    // ── 1. Re-vincular líneas de comprobantes de esta OC ──
    const { data: comps } = await supabase
      .from('comprobantes_compra')
      .select('id')
      .eq('orden_compra_id', ocId)
    const compIds = (comps ?? []).map((c) => c.id)

    let detalleActualizado = 0
    let codigoProveedor: string | null = null
    let descripcionProveedor: string | null = null
    if (compIds.length) {
      const { data: lineas } = await supabase
        .from('comprobantes_compra_detalle')
        .select('id, codigo_proveedor, descripcion_proveedor')
        .eq('articulo_id', origen)
        .in('comprobante_id', compIds)
      for (const l of lineas ?? []) {
        codigoProveedor = codigoProveedor || l.codigo_proveedor
        descripcionProveedor = descripcionProveedor || l.descripcion_proveedor
      }
      const { data: upd } = await supabase
        .from('comprobantes_compra_detalle')
        .update({ articulo_id: destino, articulo_sugerido_id: destino, match_estado: 'confirmado' })
        .eq('articulo_id', origen)
        .in('comprobante_id', compIds)
        .select('id')
      detalleActualizado = upd?.length ?? 0
    }

    // ── 2. Re-vincular ítems de recepción de esta OC (con merge si el
    //       artículo correcto ya tiene fila en la misma recepción) ──
    const { data: recs } = await supabase
      .from('recepciones')
      .select('id')
      .eq('orden_compra_id', ocId)
    const recIds = (recs ?? []).map((r) => r.id)

    let recepcionActualizada = 0
    if (recIds.length) {
      const { data: itemsOrigen } = await supabase
        .from('recepciones_items')
        .select('*')
        .eq('articulo_id', origen)
        .in('recepcion_id', recIds)
      for (const item of itemsOrigen ?? []) {
        const { data: existente } = await supabase
          .from('recepciones_items')
          .select('id, cantidad_oc, cantidad_fisica, cantidad_documentada')
          .eq('recepcion_id', item.recepcion_id)
          .eq('articulo_id', destino)
          .maybeSingle()
        if (existente) {
          // Merge: sumar cantidades al ítem correcto y borrar el equivocado
          await supabase.from('recepciones_items').update({
            cantidad_fisica: Number(existente.cantidad_fisica ?? 0) + Number(item.cantidad_fisica ?? 0),
            cantidad_documentada: Number(existente.cantidad_documentada ?? 0) + Number(item.cantidad_documentada ?? 0),
          }).eq('id', existente.id)
          await supabase.from('recepciones_items').delete().eq('id', item.id)
        } else {
          await supabase.from('recepciones_items')
            .update({ articulo_id: destino, fuera_de_oc: false })
            .eq('id', item.id)
        }
        recepcionActualizada++
      }
    }

    // ── 3. Aprender equivalencia para futuros comprobantes del proveedor ──
    if (body.aprender !== false && oc.proveedor_id && (codigoProveedor || descripcionProveedor)) {
      const { error: eqErr } = await supabase.rpc('compras_aprender_equivalencia', {
        p_articulo_id: destino,
        p_proveedor_id: oc.proveedor_id,
        p_codigo_proveedor: codigoProveedor,
        p_descripcion: descripcionProveedor,
      })
      if (eqErr) console.warn('[vincular-articulo] aprender:', eqErr.message)
    }

    // ── 4. Actualizar atributos del artículo correcto (opcional) ──
    const attrs: Record<string, any> = {}
    if (body.nuevo_ean && String(body.nuevo_ean).trim()) attrs.ean13 = String(body.nuevo_ean).trim()
    if (body.nueva_descripcion && String(body.nueva_descripcion).trim()) attrs.descripcion = String(body.nueva_descripcion).trim()
    if (Number(body.unidades_por_bulto) > 0) attrs.unidades_por_bulto = Number(body.unidades_por_bulto)
    if (Object.keys(attrs).length) {
      const { error: attrErr } = await supabase.from('articulos').update(attrs).eq('id', destino)
      if (attrErr) console.warn('[vincular-articulo] attrs:', attrErr.message)
    }

    return NextResponse.json({
      success: true,
      lineas_comprobante: detalleActualizado,
      items_recepcion: recepcionActualizada,
      equivalencia_aprendida: body.aprender !== false,
      atributos_actualizados: Object.keys(attrs),
    })
  } catch (error: any) {
    console.error('[vincular-articulo] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
