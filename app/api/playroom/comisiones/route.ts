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
    const tipoFiltro = searchParams.get('tipo') ?? 'cobrada'
    const clienteId = searchParams.get('cliente_id')
    const pedidoId = searchParams.get('pedido_id')
    const articuloId = searchParams.get('articulo_id')
    const comprobanteId = searchParams.get('comprobante_id')
    const viajanteId = searchParams.get('viajante_id')

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    const empty = {
      rows: [],
      summary: { total_devengado: 0, total_cobrable: 0, total_pagado: 0, total_pendiente: 0 },
      meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, tipo: tipoFiltro },
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

    function ensureAgg(vid: string) {
      if (!aggMap.has(vid)) {
        aggMap.set(vid, {
          devengado: 0, devengadoPrev: 0, cobrable: 0, pagado: 0, pendiente: 0,
          pedidos: new Set(), clientes: new Set(),
          nombre: vendedoresMap.get(vid) ?? vid,
          por_segmento: {},
        })
      }
      return aggMap.get(vid)!
    }

    // ── VENDIDA: filtramos por pedido.fecha ───────────────────────────────────
    if (tipoFiltro === 'vendida') {
      let pedidosQuery = supabase
        .from('pedidos')
        .select('id, fecha, cliente_id')
        .gte('fecha', prev.from)
        .lte('fecha', dateTo)
        .is('eliminado_at', null)

      if (clienteId) pedidosQuery = pedidosQuery.eq('cliente_id', clienteId)
      if (pedidoId) pedidosQuery = pedidosQuery.eq('id', pedidoId)

      const { data: pedidosData } = await pedidosQuery
      if (!pedidosData?.length) return NextResponse.json(empty)

      const pedidoMap = new Map(pedidosData.map(p => [p.id, p]))
      const pedidoIds = [...pedidoMap.keys()]

      let comisionesQuery = supabase
        .from('comisiones')
        .select('id, monto, porcentaje, pagado, comprobante_cobrado, viajante_id, pedido_id, comprobante_venta_id, tipo, segmento, articulo_id')
        .eq('tipo', 'vendida')
        .in('pedido_id', pedidoIds)

      if (viajanteId) comisionesQuery = comisionesQuery.eq('viajante_id', viajanteId)
      if (articuloId) comisionesQuery = comisionesQuery.eq('articulo_id', articuloId)
      if (comprobanteId) comisionesQuery = comisionesQuery.eq('comprobante_venta_id', comprobanteId)

      const { data: comisiones, error } = await comisionesQuery
      if (error) throw error

      for (const c of comisiones ?? []) {
        const pedido = pedidoMap.get(c.pedido_id)
        const fechaPedido = pedido?.fecha?.slice(0, 10) ?? ''
        const monto = Number(c.monto ?? 0)
        const vid = c.viajante_id ?? 'sin_vendedor'

        const inCurrent = fechaPedido >= dateFrom && fechaPedido <= dateTo
        const inPrev = fechaPedido >= prev.from && fechaPedido <= prev.to
        if (!inCurrent && !inPrev) continue

        const agg = ensureAgg(vid)
        if (inCurrent) {
          agg.devengado += monto
          if (c.comprobante_cobrado) agg.cobrable += monto
          if (c.pagado) agg.pagado += monto
          if (c.comprobante_cobrado && !c.pagado) agg.pendiente += monto
          if (c.pedido_id) agg.pedidos.add(c.pedido_id)
          if (pedido?.cliente_id) agg.clientes.add(pedido.cliente_id)
          const seg = c.segmento ?? 'sin_segmento'
          agg.por_segmento[seg] = (agg.por_segmento[seg] ?? 0) + monto
        }
        if (inPrev) agg.devengadoPrev += monto
      }
    }

    // ── COBRADA: filtramos por fecha_comprobante_cobrado ─────────────────────
    if (tipoFiltro === 'cobrada') {
      let comisionesQuery = supabase
        .from('comisiones')
        .select('id, monto, porcentaje, pagado, comprobante_cobrado, viajante_id, pedido_id, comprobante_venta_id, tipo, segmento, articulo_id, fecha_comprobante_cobrado')
        .eq('tipo', 'cobrada')
        .gte('fecha_comprobante_cobrado', prev.from)
        .lte('fecha_comprobante_cobrado', dateTo)

      if (viajanteId) comisionesQuery = comisionesQuery.eq('viajante_id', viajanteId)
      if (articuloId) comisionesQuery = comisionesQuery.eq('articulo_id', articuloId)
      if (comprobanteId) comisionesQuery = comisionesQuery.eq('comprobante_venta_id', comprobanteId)
      if (pedidoId) comisionesQuery = comisionesQuery.eq('pedido_id', pedidoId)

      const { data: comisiones, error } = await comisionesQuery
      if (error) throw error

      // Para cliente_id necesitamos los pedidos
      const pedidoIds = [...new Set((comisiones ?? []).map(c => c.pedido_id).filter(Boolean))]
      const pedidoMap = new Map<string, { cliente_id: string }>()
      if (pedidoIds.length) {
        let pq = supabase.from('pedidos').select('id, cliente_id').in('id', pedidoIds)
        if (clienteId) pq = pq.eq('cliente_id', clienteId)
        const { data: pedidosData } = await pq
        for (const p of pedidosData ?? []) pedidoMap.set(p.id, p)
      }

      // Si hay filtro de cliente, excluir comisiones cuyo pedido no pertenece a ese cliente
      const comisionesFinales = clienteId
        ? (comisiones ?? []).filter(c => !c.pedido_id || pedidoMap.has(c.pedido_id))
        : (comisiones ?? [])

      for (const c of comisionesFinales) {
        const fecha = c.fecha_comprobante_cobrado?.slice(0, 10) ?? ''
        const monto = Number(c.monto ?? 0)
        const vid = c.viajante_id ?? 'sin_vendedor'

        const inCurrent = fecha >= dateFrom && fecha <= dateTo
        const inPrev = fecha >= prev.from && fecha <= prev.to
        if (!inCurrent && !inPrev) continue

        const agg = ensureAgg(vid)
        if (inCurrent) {
          agg.devengado += monto
          if (c.comprobante_cobrado) agg.cobrable += monto
          if (c.pagado) agg.pagado += monto
          if (c.comprobante_cobrado && !c.pagado) agg.pendiente += monto
          if (c.pedido_id) agg.pedidos.add(c.pedido_id)
          const pedido = pedidoMap.get(c.pedido_id)
          if (pedido?.cliente_id) agg.clientes.add(pedido.cliente_id)
          const seg = c.segmento ?? 'sin_segmento'
          agg.por_segmento[seg] = (agg.por_segmento[seg] ?? 0) + monto
        }
        if (inPrev) agg.devengadoPrev += monto
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
      rows, summary,
      meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, tipo: tipoFiltro },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
