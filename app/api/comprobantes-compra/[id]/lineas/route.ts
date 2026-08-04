import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/comprobantes-compra/[id]/lineas — agrega a mano una línea que el
 * OCR no extrajo del documento (o que quedó sin matchear y se descartó).
 * Replica lo que hace el matching automático: crea la línea del detalle y
 * suma la cantidad documentada en el ítem de recepción correspondiente.
 *
 * Body: { articulo_id, cantidad, precio_unitario }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id: comprobanteId } = await params
  try {
    const body = await request.json()
    const articuloId = body.articulo_id
    const cantidad = Number(body.cantidad)
    const precio = Number(body.precio_unitario)
    if (!articuloId || !cantidad || cantidad <= 0) {
      return NextResponse.json({ error: 'articulo_id y cantidad son obligatorios' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: comp } = await supabase
      .from('comprobantes_compra')
      .select('id, orden_compra_id, tipo_comprobante')
      .eq('id', comprobanteId)
      .single()
    if (!comp) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    if (['NC', 'NCA', 'NCB', 'NCC', 'Reversa'].includes(comp.tipo_comprobante)) {
      return NextResponse.json({ error: 'Las líneas de créditos se cargan desde el circuito de NC' }, { status: 400 })
    }

    const { data: art } = await supabase
      .from('articulos')
      .select('id, sku, descripcion')
      .eq('id', articuloId)
      .single()
    if (!art) return NextResponse.json({ error: 'Artículo no encontrado' }, { status: 404 })

    // Tipo de cantidad según cómo se pidió en la OC (bulto/unidad)
    let tipoCantidad = 'unidad'
    if (comp.orden_compra_id) {
      const { data: ocItem } = await supabase
        .from('ordenes_compra_detalle')
        .select('tipo_cantidad')
        .eq('orden_compra_id', comp.orden_compra_id)
        .eq('articulo_id', articuloId)
        .maybeSingle()
      if (ocItem?.tipo_cantidad) tipoCantidad = ocItem.tipo_cantidad
    }

    // Ítem de recepción a documentar (preferir la fila real de la OC)
    let recepcionItemId: string | null = null
    if (comp.orden_compra_id) {
      const { data: recs } = await supabase
        .from('recepciones')
        .select('id')
        .eq('orden_compra_id', comp.orden_compra_id)
      const recIds = (recs ?? []).map((r) => r.id)
      if (recIds.length) {
        const { data: items } = await supabase
          .from('recepciones_items')
          .select('id, cantidad_documentada, cantidad_fisica, fuera_de_oc')
          .eq('articulo_id', articuloId)
          .in('recepcion_id', recIds)
        const item = (items ?? []).find((i) => !i.fuera_de_oc && Number(i.cantidad_fisica || 0) > 0)
          || (items ?? []).find((i) => !i.fuera_de_oc)
          || (items ?? [])[0]
        if (item) {
          recepcionItemId = item.id
          await supabase.from('recepciones_items')
            .update({ cantidad_documentada: Number(item.cantidad_documentada ?? 0) + cantidad })
            .eq('id', item.id)
        }
      }
    }

    const { data: linea, error: insErr } = await supabase
      .from('comprobantes_compra_detalle')
      .insert({
        comprobante_id: comprobanteId,
        articulo_id: articuloId,
        articulo_sugerido_id: articuloId,
        cantidad_facturada: cantidad,
        precio_unitario: precio || 0,
        costo_final: precio || 0,
        descripcion_proveedor: art.descripcion,
        tipo_cantidad: tipoCantidad,
        match_estado: 'manual',
        recepcion_item_id: recepcionItemId,
        iva_porcentaje: comp.tipo_comprobante === 'Adquisicion' ? 0 : 21,
      })
      .select('id')
      .single()
    if (insErr) throw insErr

    return NextResponse.json({ success: true, linea_id: linea.id, recepcion_documentada: !!recepcionItemId })
  } catch (error: any) {
    console.error('[comprobantes-compra/lineas] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
