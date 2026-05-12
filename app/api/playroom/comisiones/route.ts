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

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    // Comisiones cuyo pedido cae en el rango ampliado (actual + anterior)
    // Primero obtenemos los pedido_ids del rango, luego filtramos comisiones
    const { data: pedidosEnRango } = await supabase
      .from('pedidos')
      .select('id, fecha, cliente_id')
      .gte('fecha', prev.from)
      .lte('fecha', dateTo)

    const pedidoMap = new Map((pedidosEnRango ?? []).map(p => [p.id, p]))
    const pedidoIds = [...pedidoMap.keys()]

    if (!pedidoIds.length) {
      return NextResponse.json({ rows: [], summary: { total_devengado: 0, total_cobrable: 0, total_pagado: 0, total_pendiente: 0 }, meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to } })
    }

    const { data: comisiones, error } = await supabase
      .from('comisiones')
      .select('id, monto, porcentaje, pagado, comprobante_cobrado, viajante_id, pedido_id, comprobante_venta_id')
      .in('pedido_id', pedidoIds)

    if (error) throw error

    const { data: vendedores } = await supabase
      .from('vendedores').select('id, nombre')
    const vendedoresMap = new Map((vendedores ?? []).map(v => [v.id, v.nombre]))

    type Agg = {
      devengado: number; devengadoPrev: number
      cobrable: number; pagado: number; pendiente: number
      pedidos: Set<string>; clientes: Set<string>
      nombre: string
    }
    const aggMap = new Map<string, Agg>()

    for (const c of comisiones ?? []) {
      const vid = c.viajante_id ?? 'sin_vendedor'
      const pedido = pedidoMap.get(c.pedido_id)
      const fechaPedido = pedido?.fecha?.slice(0, 10) ?? ''
      const monto = Number(c.monto ?? 0)

      const inCurrent = fechaPedido >= dateFrom && fechaPedido <= dateTo
      const inPrev = fechaPedido >= prev.from && fechaPedido <= prev.to

      if (!inCurrent && !inPrev) continue

      if (!aggMap.has(vid)) {
        const nombre = vendedoresMap.get(vid) ?? vid
        aggMap.set(vid, { devengado: 0, devengadoPrev: 0, cobrable: 0, pagado: 0, pendiente: 0, pedidos: new Set(), clientes: new Set(), nombre })
      }
      const agg = aggMap.get(vid)!

      if (inCurrent) {
        agg.devengado += monto
        if (c.comprobante_cobrado) agg.cobrable += monto
        if (c.pagado) agg.pagado += monto
        if (c.comprobante_cobrado && !c.pagado) agg.pendiente += monto
        if (c.pedido_id) agg.pedidos.add(c.pedido_id)
        const clienteId = pedido?.cliente_id ?? null
        if (clienteId) agg.clientes.add(clienteId)
      }
      if (inPrev) {
        agg.devengadoPrev += monto
      }
    }

    const rows = [...aggMap.entries()]
      .map(([viajanteId, agg]) => ({
        viajante_id: viajanteId,
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
      }))
      .filter(r => r.devengado > 0 || r.devengado_anterior > 0)
      .sort((a, b) => b.devengado - a.devengado)

    const summary = {
      total_devengado: rows.reduce((s, r) => s + r.devengado, 0),
      total_cobrable: rows.reduce((s, r) => s + r.cobrable, 0),
      total_pagado: rows.reduce((s, r) => s + r.pagado, 0),
      total_pendiente: rows.reduce((s, r) => s + r.pendiente_cobro, 0),
    }

    return NextResponse.json({ rows, summary, meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
