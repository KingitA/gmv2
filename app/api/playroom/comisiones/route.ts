import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear } from '@/lib/playroom/queries'
import { todayArgentina, startOfDayArgentina, endOfDayArgentina } from '@/lib/utils'

function firstDayOfMonthArgentina(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? firstDayOfMonthArgentina()
    const dateTo = searchParams.get('to') ?? todayArgentina()
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

    // ── Base kardex query: todas las filas de venta con comisión ─────────────
    function buildKardexQuery(dateField: string, from: string, to: string) {
      let q = supabase
        .from('kardex')
        .select('id, vendedor_id, fecha, fecha_comprobante_cobrado, comprobante_cobrado, comision_viajante_pct, comision_viajante_monto, pedido_id, cliente_id, articulo_id, comprobante_venta_id, articulo_categoria')
        .eq('tipo_movimiento', 'venta')
        .not('comision_viajante_monto', 'is', null)
        // Incluye montos negativos: la mercadería bonificada resta comisión ("venta real")
        .neq('comision_viajante_monto', 0)
        .eq('pedido_eliminado', false)
        .gte(dateField, startOfDayArgentina(from))
        .lte(dateField, endOfDayArgentina(to))

      if (viajanteId) q = q.eq('vendedor_id', viajanteId)
      if (articuloId) q = q.eq('articulo_id', articuloId)
      if (pedidoId) q = q.eq('pedido_id', pedidoId)
      if (comprobanteId) q = q.eq('comprobante_venta_id', comprobanteId)
      if (clienteId) q = q.eq('cliente_id', clienteId)

      return q
    }

    // ── VENDIDA: comisiones por fecha de creación del movimiento ─────────────
    // ── COBRADA: comisiones donde el cliente ya pagó el comprobante ──────────
    const dateField = tipoFiltro === 'cobrada' ? 'fecha_comprobante_cobrado' : 'fecha'

    // Paginate to bypass Supabase PostgREST max_rows server-side cap (default 1000)
    const PAGE_SIZE = 1000
    const kardexRows: any[] = []
    let offset = 0
    while (true) {
      let q = buildKardexQuery(dateField, prev.from, dateTo)
      if (tipoFiltro === 'cobrada') q = q.eq('comprobante_cobrado', true)
      const { data: page, error: pageError } = await q.range(offset, offset + PAGE_SIZE - 1)
      if (pageError) throw pageError
      if (!page?.length) break
      kardexRows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (!kardexRows.length) return NextResponse.json(empty)

    // Obtener flag pagado desde tabla comisiones (join por kardex_id)
    const kardexIds = kardexRows.map(r => r.id)
    const { data: comisionesRows } = await supabase
      .from('comisiones')
      .select('kardex_id, pagado')
      .in('kardex_id', kardexIds)

    const pagadoMap = new Map<string, boolean>(
      (comisionesRows ?? []).map(c => [c.kardex_id, c.pagado])
    )

    for (const k of kardexRows) {
      const monto = Number(k.comision_viajante_monto ?? 0)
      const vid = k.vendedor_id ?? 'sin_vendedor'
      const fechaFiltro = (tipoFiltro === 'cobrada' ? k.fecha_comprobante_cobrado : k.fecha)?.slice(0, 10) ?? ''
      const pagado = pagadoMap.get(k.id) ?? false

      const inCurrent = fechaFiltro >= dateFrom && fechaFiltro <= dateTo
      const inPrev = fechaFiltro >= prev.from && fechaFiltro <= prev.to
      if (!inCurrent && !inPrev) continue

      const agg = ensureAgg(vid)
      if (inCurrent) {
        agg.devengado += monto
        if (k.comprobante_cobrado) agg.cobrable += monto
        if (pagado) agg.pagado += monto
        if (k.comprobante_cobrado && !pagado) agg.pendiente += monto
        if (k.pedido_id) agg.pedidos.add(k.pedido_id)
        if (k.cliente_id) agg.clientes.add(k.cliente_id)
        const seg = k.articulo_categoria ?? 'sin_segmento'
        agg.por_segmento[seg] = (agg.por_segmento[seg] ?? 0) + monto
      }
      if (inPrev) agg.devengadoPrev += monto
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
