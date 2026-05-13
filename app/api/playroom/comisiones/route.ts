import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear } from '@/lib/playroom/queries'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = searchParams.get('to') ?? new Date().toISOString().slice(0, 10)
    const comparePeriod = searchParams.get('compare') ?? 'previous'
    const tipoFiltro = searchParams.get('tipo') ?? 'cobrada' // 'vendida' | 'cobrada'
    const clienteId = searchParams.get('cliente_id')
    const pedidoId = searchParams.get('pedido_id')
    const articuloId = searchParams.get('articulo_id')
    const comprobanteId = searchParams.get('comprobante_id')
    const viajanteId = searchParams.get('viajante_id')

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    // Para tipo='cobrada': filtrar por fecha_comprobante_cobrado
    // Para tipo='vendida': filtrar por fecha del pedido
    let comisionesQuery = supabase
      .from('comisiones')
      .select('id, monto, porcentaje, pagado, comprobante_cobrado, viajante_id, pedido_id, comprobante_venta_id, tipo, segmento, articulo_id, cantidad, precio_neto_unitario, fecha_comprobante_cobrado, created_at')
      .eq('tipo', tipoFiltro)

    if (viajanteId) comisionesQuery = comisionesQuery.eq('viajante_id', viajanteId)
    if (pedidoId) comisionesQuery = comisionesQuery.eq('pedido_id', pedidoId)
    if (articuloId) comisionesQuery = comisionesQuery.eq('articulo_id', articuloId)
    if (comprobanteId) comisionesQuery = comisionesQuery.eq('comprobante_venta_id', comprobanteId)

    const { data: todasComisiones, error } = await comisionesQuery

    if (error) throw error

    // Filtrar por rango de fecha según tipo
    const comisionesFiltradas = (todasComisiones ?? []).filter(c => {
      const fecha = tipoFiltro === 'cobrada'
        ? (c.fecha_comprobante_cobrado?.slice(0, 10) ?? c.created_at?.slice(0, 10) ?? '')
        : (c.created_at?.slice(0, 10) ?? '')
      return fecha >= prev.from && fecha <= dateTo
    })

    // Si hay filtro de cliente, necesitamos cruzar con pedidos
    let comisiones = comisionesFiltradas
    let pedidoMap = new Map<string, { fecha: string; cliente_id: string }>()

    const pedidoIds = [...new Set(comisiones.map(c => c.pedido_id).filter(Boolean))]
    if (pedidoIds.length > 0) {
      let pedidosQuery = supabase
        .from('pedidos')
        .select('id, fecha, cliente_id')
        .in('id', pedidoIds)
      if (clienteId) pedidosQuery = pedidosQuery.eq('cliente_id', clienteId)

      const { data: pedidos } = await pedidosQuery
      pedidoMap = new Map((pedidos ?? []).map(p => [p.id, p]))

      if (clienteId) {
        const pedidoIdsValidos = new Set(pedidoMap.keys())
        comisiones = comisiones.filter(c => !c.pedido_id || pedidoIdsValidos.has(c.pedido_id))
      }
    }

    const { data: vendedores } = await supabase.from('vendedores').select('id, nombre')
    const vendedoresMap = new Map((vendedores ?? []).map(v => [v.id, v.nombre]))

    type Agg = {
      devengado: number; devengadoPrev: number
      cobrable: number; pagado: number; pendiente: number
      pedidos: Set<string>; clientes: Set<string>
      nombre: string
      por_segmento: Record<string, number>
    }
    const aggMap = new Map<string, Agg>()

    for (const c of comisiones) {
      const vid = c.viajante_id ?? 'sin_vendedor'
      const monto = Number(c.monto ?? 0)

      const fecha = tipoFiltro === 'cobrada'
        ? (c.fecha_comprobante_cobrado?.slice(0, 10) ?? c.created_at?.slice(0, 10) ?? '')
        : (c.created_at?.slice(0, 10) ?? '')

      const inCurrent = fecha >= dateFrom && fecha <= dateTo
      const inPrev = fecha >= prev.from && fecha <= prev.to

      if (!inCurrent && !inPrev) continue

      if (!aggMap.has(vid)) {
        aggMap.set(vid, {
          devengado: 0, devengadoPrev: 0, cobrable: 0, pagado: 0, pendiente: 0,
          pedidos: new Set(), clientes: new Set(),
          nombre: vendedoresMap.get(vid) ?? vid,
          por_segmento: {},
        })
      }
      const agg = aggMap.get(vid)!

      if (inCurrent) {
        agg.devengado += monto
        if (c.comprobante_cobrado) agg.cobrable += monto
        if (c.pagado) agg.pagado += monto
        if (c.comprobante_cobrado && !c.pagado) agg.pendiente += monto
        if (c.pedido_id) agg.pedidos.add(c.pedido_id)
        const pedido = pedidoMap.get(c.pedido_id)
        if (pedido?.cliente_id) agg.clientes.add(pedido.cliente_id)
        // Acumular por segmento
        const seg = c.segmento ?? 'sin_segmento'
        agg.por_segmento[seg] = (agg.por_segmento[seg] ?? 0) + monto
      }
      if (inPrev) {
        agg.devengadoPrev += monto
      }
    }

    const rows = [...aggMap.entries()]
      .map(([vId, agg]) => ({
        viajante_id: vId,
        nombre: agg.nombre,
        devengado: agg.devengado,
        devengado_anterior: agg.devengadoPrev,
        variacion_pct: agg.devengadoPrev > 0
          ? ((agg.devengado - agg.devengadoPrev) / Math.abs(agg.devengadoPrev)) * 100
          : agg.devengado > 0 ? 100 : 0,
        cobrable: agg.cobrable,
        pagado: agg.pagado,
        pendiente_cobro: agg.pendiente,
        cantidad_pedidos: agg.pedidos.size,
        cantidad_clientes: agg.clientes.size,
        por_segmento: agg.por_segmento,
      }))
      .filter(r => r.devengado !== 0 || r.devengado_anterior !== 0)
      .sort((a, b) => b.devengado - a.devengado)

    const summary = {
      total_devengado: rows.reduce((s, r) => s + r.devengado, 0),
      total_cobrable: rows.reduce((s, r) => s + r.cobrable, 0),
      total_pagado: rows.reduce((s, r) => s + r.pagado, 0),
      total_pendiente: rows.reduce((s, r) => s + r.pendiente_cobro, 0),
    }

    return NextResponse.json({
      rows,
      summary,
      meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, tipo: tipoFiltro },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
