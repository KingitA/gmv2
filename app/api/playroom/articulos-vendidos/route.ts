import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear } from '@/lib/playroom/queries'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo   = searchParams.get('to')   ?? new Date().toISOString().slice(0, 10)
    const comparePeriod = searchParams.get('compare') ?? 'previous'

    // ── Filtros backend ────────────────────────────────────────────────────────
    const vendedorId      = searchParams.get('vendedor_id')      // kardex directo
    const provincia       = searchParams.get('provincia')         // kardex directo
    const clienteId       = searchParams.get('cliente_id')        // kardex directo
    const tipoComp        = searchParams.get('tipo_comprobante')  // 'factura'|'presupuesto'|''
    const conDescuento    = searchParams.get('con_descuento')     // tipo o 'sin_descuento'|''
    const condicionIva    = searchParams.get('condicion_iva')     // necesita lookup clientes
    const localidad       = searchParams.get('localidad')         // necesita lookup clientes
    const zona            = searchParams.get('zona')              // necesita lookup clientes
    const fuente          = searchParams.get('fuente')            // 'pedido'|'comprobante'|''

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    // ── Lookup de clientes para filtros que no están en kardex ─────────────────
    let clienteIdsFiltro: string[] | null = null
    if (condicionIva || localidad || zona) {
      let q = supabase.from('clientes').select('id')
      if (condicionIva) q = q.ilike('condicion_iva', `%${condicionIva}%`)
      if (localidad)    q = q.ilike('localidad', `%${localidad}%`)
      if (zona)         q = q.eq('zona', zona)
      const { data: matchingClientes } = await q
      clienteIdsFiltro = (matchingClientes ?? []).map((c: any) => c.id)
      if (clienteIdsFiltro.length === 0) {
        return NextResponse.json({ rows: [], meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalRevenue: 0 } })
      }
    }

    // ── Query kardex con filtros dinámicos ─────────────────────────────────────
    let query = supabase
      .from('kardex')
      .select('articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, articulo_marca_id, articulo_proveedor_id, cantidad, subtotal_total, precio_costo, tipo_movimiento, fecha, descuentos_json')
      .gte('fecha', prev.from)
      .lte('fecha', dateTo)
      .in('tipo_movimiento', ['venta', 'nota_credito_venta'])
      .not('articulo_id', 'is', null)

    if (vendedorId)  query = query.eq('vendedor_id', vendedorId)
    if (provincia)   query = query.eq('provincia_destino', provincia)
    if (clienteId)   query = query.eq('cliente_id', clienteId)
    if (clienteIdsFiltro !== null) query = query.in('cliente_id', clienteIdsFiltro)
    if (tipoComp === 'factura')    query = query.in('tipo_comprobante', ['FA', 'FB', 'FC'])
    else if (tipoComp === 'presupuesto') query = query.in('tipo_comprobante', ['PRES', 'REV'])
    if (fuente === 'comprobante') query = query.not('comprobante_venta_id', 'is', null)

    const { data: movimientos, error } = await query.limit(10000)

    if (error) throw error
    if (!movimientos?.length) {
      return NextResponse.json({ rows: [], meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalRevenue: 0 } })
    }

    // Datos adicionales que no están denormalizados en kardex
    const articuloIds = [...new Set(movimientos.map(m => m.articulo_id))]
    const [{ data: articulos }, { data: rubros }, { data: marcas }, { data: proveedores }] = await Promise.all([
      supabase.from('articulos').select('id, rubro_id, rubro, precio_compra, ultimo_costo, marca_id').in('id', articuloIds),
      supabase.from('rubros').select('id, nombre'),
      supabase.from('marcas').select('id, descripcion'),
      supabase.from('proveedores').select('id, sigla, nombre'),
    ])

    const artMap   = new Map((articulos   ?? []).map(a => [a.id, a]))
    const rubroMap = new Map((rubros      ?? []).map(r => [r.id, r.nombre]))
    const marcaMap = new Map((marcas      ?? []).map(m => [m.id, m.descripcion]))
    const provMap  = new Map((proveedores ?? []).map(p => [p.id, p.nombre]))

    type Agg = {
      units: number; unitsPrev: number
      revenue: number; revenuePrev: number
      costo: number
      sku: string; descripcion: string; categoria: string
      marcaId: string | null; proveedorId: string | null
    }
    const aggMap = new Map<string, Agg>()

    for (const m of movimientos) {
      if (!m.articulo_id) continue

      // ── Filtro descuento en el loop JS ────────────────────────────────────
      if (conDescuento) {
        const desc: any[] = Array.isArray(m.descuentos_json) ? m.descuentos_json : []
        if (conDescuento === 'sin_descuento') {
          if (desc.some(d => d.porcentaje > 0)) continue
        } else {
          if (!desc.some(d => d.tipo === conDescuento && d.porcentaje > 0)) continue
        }
      }

      const signo = m.tipo_movimiento === 'nota_credito_venta' ? -1 : 1
      const fechaDate = m.fecha.slice(0, 10)  // "2026-05-05" from any timestamp format
      const inCurrent = fechaDate >= dateFrom && fechaDate <= dateTo
      const inPrev    = fechaDate >= prev.from && fechaDate <= prev.to

      if (!aggMap.has(m.articulo_id)) {
        aggMap.set(m.articulo_id, {
          units: 0, unitsPrev: 0, revenue: 0, revenuePrev: 0, costo: 0,
          sku: m.articulo_sku ?? '—',
          descripcion: m.articulo_descripcion ?? m.articulo_id,
          categoria: m.articulo_categoria ?? '—',
          marcaId: m.articulo_marca_id ?? null,
          proveedorId: m.articulo_proveedor_id ?? null,
        })
      }
      const agg = aggMap.get(m.articulo_id)!
      const qty = Number(m.cantidad ?? 0) * signo
      const rev = Number(m.subtotal_total ?? 0) * signo

      const art = artMap.get(m.articulo_id)
      const costoUnit = Number(m.precio_costo ?? 0) > 0
        ? Number(m.precio_costo)
        : art
          ? (Number(art.ultimo_costo) > 0 ? Number(art.ultimo_costo) : Number(art.precio_compra ?? 0))
          : 0

      if (inCurrent) {
        agg.units   += qty
        agg.revenue += rev
        agg.costo   += costoUnit * Math.abs(qty)
      }
      if (inPrev) {
        agg.unitsPrev   += qty
        agg.revenuePrev += rev
      }
    }

    const rows = [...aggMap.entries()]
      .map(([articuloId, agg]) => {
        const art = artMap.get(articuloId)
        const variacionPct = agg.revenuePrev > 0
          ? ((agg.revenue - agg.revenuePrev) / Math.abs(agg.revenuePrev)) * 100
          : agg.revenue > 0 ? 100 : 0
        const margenBruto = agg.costo > 0 && agg.revenue > 0
          ? ((agg.revenue - agg.costo) / agg.revenue) * 100
          : null
        return {
          articulo_id: articuloId,
          sku: agg.sku,
          descripcion: agg.descripcion,
          rubro: rubroMap.get(art?.rubro_id) ?? art?.rubro ?? '—',
          marca: marcaMap.get(agg.marcaId ?? art?.marca_id ?? '') ?? '—',
          proveedor: provMap.get(agg.proveedorId ?? '') ?? '—',
          unidades: Math.round(agg.units),
          unidades_anterior: Math.round(agg.unitsPrev),
          revenue: agg.revenue,
          revenue_anterior: agg.revenuePrev,
          variacion_pct: variacionPct,
          costo_total: agg.costo,
          margen_bruto_pct: margenBruto,
          bonificadas: 0,
        }
      })
      .filter(r => r.revenue > 0 || r.revenue_anterior > 0)
      .sort((a, b) => b.revenue - a.revenue)

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
    let cumulative = 0
    const rowsWithABC = rows.map(r => {
      cumulative += r.revenue
      const pct = totalRevenue > 0 ? cumulative / totalRevenue : 1
      return { ...r, clasificacion: pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C' as const }
    })

    return NextResponse.json({
      rows: rowsWithABC,
      meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalRevenue },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
