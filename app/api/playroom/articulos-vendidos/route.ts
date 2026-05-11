import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear } from '@/lib/playroom/queries'

const TIPOS_VENTA = ['FA', 'FB', 'FC']
const TIPOS_NC = ['NCA', 'NCB', 'NCC']

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = searchParams.get('to') ?? new Date().toISOString().slice(0, 10)
    const comparePeriod = searchParams.get('compare') ?? 'previous'

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    // Comprobantes en ambos períodos
    const { data: comprobantes, error } = await supabase
      .from('comprobantes_venta')
      .select('id, pedido_id, tipo_comprobante, fecha, total_factura')
      .gte('fecha', prev.from)
      .lte('fecha', dateTo)
      .in('tipo_comprobante', [...TIPOS_VENTA, ...TIPOS_NC])

    if (error) throw error
    if (!comprobantes?.length) return NextResponse.json({ rows: [], meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to } })

    // IDs de pedidos y marcador de NC
    type CompInfo = { isNC: boolean; inCurrent: boolean; inPrev: boolean }
    const pedidoCompMap = new Map<string, CompInfo>()
    for (const c of comprobantes) {
      if (!c.pedido_id) continue
      const isNC = TIPOS_NC.includes(c.tipo_comprobante)
      const inCurrent = c.fecha >= dateFrom && c.fecha <= dateTo
      const inPrev = c.fecha >= prev.from && c.fecha <= prev.to
      if (!pedidoCompMap.has(c.pedido_id)) {
        pedidoCompMap.set(c.pedido_id, { isNC, inCurrent, inPrev })
      } else {
        const existing = pedidoCompMap.get(c.pedido_id)!
        if (inCurrent) existing.inCurrent = true
        if (inPrev) existing.inPrev = true
      }
    }

    const pedidoIds = [...pedidoCompMap.keys()]
    if (!pedidoIds.length) return NextResponse.json({ rows: [], meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to } })

    // Detalles de pedidos con artículo
    const { data: detalles, error: detError } = await supabase
      .from('pedidos_detalle')
      .select('pedido_id, articulo_id, cantidad, precio_final, precio_base, es_bonificado')
      .in('pedido_id', pedidoIds)

    if (detError) throw detError

    // Artículos
    const { data: articulos } = await supabase
      .from('articulos')
      .select('id, sku, descripcion, rubro_id, rubro, precio_compra, ultimo_costo, marca_id, proveedor_id')

    const [{ data: rubros }, { data: marcas }, { data: proveedores }] = await Promise.all([
      supabase.from('rubros').select('id, nombre'),
      supabase.from('marcas').select('id, descripcion'),
      supabase.from('proveedores').select('id, sigla, nombre'),
    ])

    const artMap = new Map((articulos ?? []).map(a => [a.id, a]))
    const rubroMap = new Map((rubros ?? []).map(r => [r.id, r.nombre]))
    const marcaMap = new Map((marcas ?? []).map(m => [m.id, m.descripcion]))
    const provMap = new Map((proveedores ?? []).map(p => [p.id, p.sigla || p.nombre]))

    type Agg = {
      units: number; unitsPrev: number
      revenue: number; revenuePrev: number
      costo: number
      bonificadas: number
    }
    const aggMap = new Map<string, Agg>()

    for (const d of detalles ?? []) {
      const info = pedidoCompMap.get(d.pedido_id)
      if (!info) continue
      const art = artMap.get(d.articulo_id)
      if (!art) continue

      if (!aggMap.has(d.articulo_id)) {
        aggMap.set(d.articulo_id, { units: 0, unitsPrev: 0, revenue: 0, revenuePrev: 0, costo: 0, bonificadas: 0 })
      }
      const agg = aggMap.get(d.articulo_id)!
      const signo = info.isNC ? -1 : 1
      const qty = Number(d.cantidad ?? 0) * signo
      const rev = Number(d.precio_final ?? 0) * Number(d.cantidad ?? 0) * signo
      const costo =
        Number(art.ultimo_costo) > 0 ? Number(art.ultimo_costo) :
        Number(art.precio_compra) > 0 ? Number(art.precio_compra) : 0

      if (info.inCurrent) {
        agg.units += qty
        agg.revenue += rev
        agg.costo += costo * Math.abs(qty)
        if (d.es_bonificado) agg.bonificadas += Math.abs(qty)
      }
      if (info.inPrev) {
        agg.unitsPrev += qty
        agg.revenuePrev += rev
      }
    }

    const rows = [...aggMap.entries()]
      .map(([articuloId, agg]) => {
        const art = artMap.get(articuloId)!
        const variacionPct = agg.revenuePrev > 0
          ? ((agg.revenue - agg.revenuePrev) / Math.abs(agg.revenuePrev)) * 100
          : agg.revenue > 0 ? 100 : 0
        const margenBruto = agg.costo > 0 ? ((agg.revenue - agg.costo) / agg.revenue) * 100 : null
        return {
          articulo_id: articuloId,
          sku: art.sku ?? '—',
          descripcion: art.descripcion ?? articuloId,
          rubro: rubroMap.get(art.rubro_id) ?? art.rubro ?? '—',
          marca: marcaMap.get(art.marca_id) ?? '—',
          proveedor: provMap.get(art.proveedor_id) ?? '—',
          unidades: Math.round(agg.units),
          unidades_anterior: Math.round(agg.unitsPrev),
          revenue: agg.revenue,
          revenue_anterior: agg.revenuePrev,
          variacion_pct: variacionPct,
          costo_total: agg.costo,
          margen_bruto_pct: margenBruto,
          bonificadas: agg.bonificadas,
        }
      })
      .filter(r => r.revenue > 0 || r.revenue_anterior > 0)
      .sort((a, b) => b.revenue - a.revenue)

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
    let cumulative = 0
    const rowsWithABC = rows.map(r => {
      cumulative += r.revenue
      const pct = totalRevenue > 0 ? cumulative / totalRevenue : 1
      return { ...r, clasificacion: pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C' }
    })

    return NextResponse.json({
      rows: rowsWithABC,
      meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalRevenue },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
