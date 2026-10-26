import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear, fetchAllRows, fetchByIds } from '@/lib/playroom/queries'
import { todayArgentina, startOfDayArgentina, endOfDayArgentina } from '@/lib/utils'
import { fechaISO, hoyISO } from '@/lib/formato'
import { comisionesGanadas, repartirPorLinea } from '@/lib/comisiones/ganadas'
import { sinPedidosExcluidos } from '@/lib/comisiones/pedidos-sin-comision'

function firstDayOfMonthArgentina(): string {
  return `${hoyISO().slice(0, 7)}-01`
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

    const vendedores = await fetchAllRows(() => supabase.from('vendedores').select('id, nombre'))
    const vendedoresMap = new Map(vendedores.map(v => [v.id, v.nombre]))

    // ── COBRADA = comisión GANADA, acreditada en la cuenta personal (#42) ────
    // Fuente única desde la etapa 3 (lib/comisiones/ganadas.ts): la tabla vieja
    // `comisiones` tipo 'cobrada' ya no se escribe y el tablero daba $0. El
    // renglón ya viene neto (10% contado, devoluciones) y se revierte solo si el
    // cobro se anula. "Pagado" = acreditado en su cuenta (de ahí la retira).
    if (tipoFiltro === 'cobrada') {
      const [actual, anterior] = await Promise.all([
        comisionesGanadas(supabase, { desde: dateFrom, hasta: dateTo, vendedorId: viajanteId }),
        comisionesGanadas(supabase, { desde: prev.from, hasta: prev.to, vendedorId: viajanteId }),
      ])
      type AggC = { devengado: number; devengadoPrev: number; pedidos: Set<string>; clientes: Set<string>; por_segmento: Record<string, number> }
      const aggC = new Map<string, AggC>()
      const ensureC = (vid: string) => {
        if (!aggC.has(vid)) aggC.set(vid, { devengado: 0, devengadoPrev: 0, pedidos: new Set(), clientes: new Set(), por_segmento: {} })
        return aggC.get(vid)!
      }
      const pasaFiltros = (g: (typeof actual)[number]) =>
        (!clienteId || g.cliente_id === clienteId) &&
        (!pedidoId || g.pedido_id === pedidoId) &&
        (!comprobanteId || g.comprobante_id === comprobanteId)
      for (const [lista, esActual] of [[actual, true], [anterior, false]] as const) {
        for (const g of lista) {
          if (!pasaFiltros(g)) continue
          const partes = repartirPorLinea(g).filter((p) => !articuloId || p.articulo_id === articuloId)
          if (!partes.length) continue
          const monto = partes.reduce((s, p) => s + p.monto, 0)
          const agg = ensureC(g.vendedor_id)
          if (!esActual) { agg.devengadoPrev += monto; continue }
          agg.devengado += monto
          if (g.pedido_id) agg.pedidos.add(g.pedido_id)
          if (g.cliente_id) agg.clientes.add(g.cliente_id)
          for (const p of partes) {
            const seg = p.articulo_categoria ?? 'sin_segmento'
            agg.por_segmento[seg] = (agg.por_segmento[seg] ?? 0) + p.monto
          }
        }
      }
      const rowsC = [...aggC.entries()]
        .map(([vId, agg]) => ({
          viajante_id: vId,
          nombre: vendedoresMap.get(vId) ?? vId,
          devengado: agg.devengado,
          devengado_anterior: agg.devengadoPrev,
          variacion_pct: agg.devengadoPrev > 0
            ? ((agg.devengado - agg.devengadoPrev) / Math.abs(agg.devengadoPrev)) * 100
            : agg.devengado > 0 ? 100 : 0,
          cobrable: agg.devengado,
          pagado: agg.devengado,
          pendiente_cobro: 0,
          cantidad_pedidos: agg.pedidos.size,
          cantidad_clientes: agg.clientes.size,
          por_segmento: agg.por_segmento,
        }))
        .filter(r => Math.abs(r.devengado) >= 0.005 || Math.abs(r.devengado_anterior) >= 0.005)
        .sort((a, b) => b.devengado - a.devengado)
      if (!rowsC.length) return NextResponse.json(empty)
      return NextResponse.json({
        rows: rowsC,
        summary: {
          total_devengado: rowsC.reduce((s, r) => s + r.devengado, 0),
          total_cobrable: rowsC.reduce((s, r) => s + r.cobrable, 0),
          total_pagado: rowsC.reduce((s, r) => s + r.pagado, 0),
          total_pendiente: 0,
        },
        meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, tipo: tipoFiltro, fuente: 'cuenta_personal' },
      })
    }

    // ── Camino rápido (RPC): sin filtros granulares, agrega en Postgres ────────
    if (!clienteId && !pedidoId && !articuloId && !comprobanteId) {
      const rpcRows = await fetchAllRows(() => supabase.rpc('playroom_comisiones_viajantes', {
        p_from: dateFrom,
        p_to: dateTo,
        p_prev_from: prev.from,
        p_prev_to: prev.to,
        p_tipo: tipoFiltro,
        p_viajante_id: viajanteId || null,
      }), 'vendedor_id')

      const rows = rpcRows
        .map((r: any) => {
          const devengado = Number(r.devengado ?? 0)
          const devengadoPrev = Number(r.devengado_prev ?? 0)
          return {
            viajante_id: r.vendedor_id ?? 'sin_vendedor',
            nombre: vendedoresMap.get(r.vendedor_id) ?? r.vendedor_id ?? 'Sin vendedor',
            devengado,
            devengado_anterior: devengadoPrev,
            variacion_pct: devengadoPrev > 0
              ? ((devengado - devengadoPrev) / Math.abs(devengadoPrev)) * 100
              : devengado > 0 ? 100 : 0,
            cobrable: Number(r.cobrable ?? 0),
            pagado: Number(r.pagado ?? 0),
            pendiente_cobro: Number(r.pendiente ?? 0),
            cantidad_pedidos: Number(r.cantidad_pedidos ?? 0),
            cantidad_clientes: Number(r.cantidad_clientes ?? 0),
            por_segmento: r.por_segmento ?? {},
          }
        })
        .filter(r => r.devengado !== 0 || r.devengado_anterior !== 0)
        .sort((a, b) => b.devengado - a.devengado)

      if (!rows.length) return NextResponse.json(empty)

      return NextResponse.json({
        rows,
        summary: {
          total_devengado: rows.reduce((s, r) => s + r.devengado, 0),
          total_cobrable: rows.reduce((s, r) => s + r.cobrable, 0),
          total_pagado: rows.reduce((s, r) => s + r.pagado, 0),
          total_pendiente: rows.reduce((s, r) => s + r.pendiente_cobro, 0),
        },
        meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, tipo: tipoFiltro },
      })
    }

    // ── Camino con filtros granulares (cliente/pedido/artículo/comprobante) ──

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

      // ORDER BY estable: sin él la paginación duplica/pierde filas
      return q.order('id', { ascending: true })
    }

    // ── VENDIDA: comisiones por fecha de creación del movimiento (kardex) ────
    const dateField = 'fecha'

    // Paginate to bypass Supabase PostgREST max_rows server-side cap (default 1000)
    const PAGE_SIZE = 1000
    let kardexRows: any[] = []
    let offset = 0
    while (true) {
      let q = buildKardexQuery(dateField, prev.from, dateTo)
      const { data: page, error: pageError } = await q.range(offset, offset + PAGE_SIZE - 1)
      if (pageError) throw pageError
      if (!page?.length) break
      kardexRows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    // Sin pedidos eliminados ni del sistema viejo (#10)
    kardexRows = await sinPedidosExcluidos(supabase, kardexRows)
    if (!kardexRows.length) return NextResponse.json(empty)

    // Obtener flag pagado desde tabla comisiones (join por kardex_id, por tandas:
    // con .in() de miles de ids la URL explota y el resultado se corta en 1000)
    const kardexIds = kardexRows.map(r => r.id)
    const comisionesRows = await fetchByIds(chunk => supabase
      .from('comisiones')
      .select('kardex_id, pagado')
      .in('kardex_id', chunk), kardexIds)

    const pagadoMap = new Map<string, boolean>(
      comisionesRows.map(c => [c.kardex_id, c.pagado])
    )

    for (const k of kardexRows) {
      const monto = Number(k.comision_viajante_monto ?? 0)
      const vid = k.vendedor_id ?? 'sin_vendedor'
      const fechaFiltro = fechaISO(k.fecha) // timestamptz → día argentino
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
