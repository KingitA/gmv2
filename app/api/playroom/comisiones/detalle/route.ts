import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const pedidoId = searchParams.get('pedido_id')
    const tipo = searchParams.get('tipo') ?? 'cobrada'
    const viajanteId = searchParams.get('viajante_id')

    if (!pedidoId) {
      return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })
    }

    let q = supabase
      .from('kardex')
      .select('id, articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, cantidad, subtotal_total, precio_unitario_final, comision_viajante_pct, comision_viajante_monto, comprobante_venta_id, fecha_comprobante_cobrado, comprobante_cobrado')
      .eq('pedido_id', pedidoId)
      .eq('tipo_movimiento', 'venta')
      .not('comision_viajante_monto', 'is', null)
      .neq('comision_viajante_monto', 0)
      .eq('pedido_eliminado', false)

    if (viajanteId) q = q.eq('vendedor_id', viajanteId)
    if (tipo === 'cobrada') q = q.eq('comprobante_cobrado', true)

    const { data: rows, error } = await q
    if (error) throw error
    if (!rows?.length) {
      return NextResponse.json(tipo === 'vendida'
        ? { tipo, articulos: [] }
        : { tipo, comprobantes: [] }
      )
    }

    if (tipo === 'vendida') {
      const articulos = rows.map(r => ({
        kardex_id: r.id,
        articulo_id: r.articulo_id,
        sku: r.articulo_sku ?? '—',
        descripcion: r.articulo_descripcion ?? r.articulo_id ?? '—',
        categoria: r.articulo_categoria ?? '—',
        cantidad: Number(r.cantidad ?? 0),
        precio_unitario: Number(r.precio_unitario_final ?? 0),
        subtotal: Number(r.subtotal_total ?? 0),
        comision_pct: Number(r.comision_viajante_pct ?? 0),
        comision_monto: Number(r.comision_viajante_monto ?? 0),
      }))
      return NextResponse.json({ tipo, articulos })
    }

    // tipo === 'cobrada': group by comprobante
    const compIds = [...new Set(rows.map(r => r.comprobante_venta_id).filter(Boolean))] as string[]
    const { data: comprobantes } = compIds.length > 0
      ? await supabase
          .from('comprobantes_venta')
          .select('id, numero, tipo_comprobante, total_neto, total_iva, total')
          .in('id', compIds)
      : { data: [] }
    const compMap = new Map((comprobantes ?? []).map(c => [c.id, c]))

    type CompAgg = {
      comprobante_id: string
      numero: string
      tipo_comprobante: string
      fecha_cobro: string
      total_neto: number
      total_iva: number
      total: number
      total_comision: number
      articulos: {
        kardex_id: string
        articulo_id: string
        sku: string
        descripcion: string
        categoria: string
        cantidad: number
        precio_unitario: number
        subtotal: number
        comision_pct: number
        comision_monto: number
      }[]
    }

    const compAggMap = new Map<string, CompAgg>()

    for (const r of rows) {
      const cid = r.comprobante_venta_id ?? 'sin_comprobante'
      const comp = compMap.get(cid)

      if (!compAggMap.has(cid)) {
        compAggMap.set(cid, {
          comprobante_id: cid,
          numero: comp ? `${comp.tipo_comprobante} ${comp.numero}` : '—',
          tipo_comprobante: comp?.tipo_comprobante ?? '—',
          fecha_cobro: r.fecha_comprobante_cobrado?.slice(0, 10) ?? '',
          total_neto: comp?.total_neto ?? 0,
          total_iva: comp?.total_iva ?? 0,
          total: comp?.total ?? 0,
          total_comision: 0,
          articulos: [],
        })
      }

      const agg = compAggMap.get(cid)!
      const comMonto = Number(r.comision_viajante_monto ?? 0)
      agg.total_comision += comMonto
      agg.articulos.push({
        kardex_id: r.id,
        articulo_id: r.articulo_id,
        sku: r.articulo_sku ?? '—',
        descripcion: r.articulo_descripcion ?? r.articulo_id ?? '—',
        categoria: r.articulo_categoria ?? '—',
        cantidad: Number(r.cantidad ?? 0),
        precio_unitario: Number(r.precio_unitario_final ?? 0),
        subtotal: Number(r.subtotal_total ?? 0),
        comision_pct: Number(r.comision_viajante_pct ?? 0),
        comision_monto: comMonto,
      })
    }

    return NextResponse.json({ tipo, comprobantes: [...compAggMap.values()] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
