import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear } from '@/lib/playroom/queries'
import { todayArgentina } from '@/lib/utils'

const TIPOS_VENTA = ['FA', 'FB', 'FC']
const TIPOS_NC = ['NCA', 'NCB', 'NCC']

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? todayArgentina()
    const dateTo = searchParams.get('to') ?? todayArgentina()
    const comparePeriod = searchParams.get('compare') ?? 'previous'

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    // Todos los comprobantes de venta/NC en ambos períodos
    const { data: comprobantes, error } = await supabase
      .from('comprobantes_venta')
      .select('id, cliente_id, pedido_id, tipo_comprobante, fecha, total_factura, saldo_pendiente')
      .gte('fecha', prev.from)
      .lte('fecha', dateTo)
      .in('tipo_comprobante', [...TIPOS_VENTA, ...TIPOS_NC])

    if (error) throw error
    if (!comprobantes?.length) return NextResponse.json({ rows: [], meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalFact: 0 } })

    // Vendedor desde pedidos
    const pedidoIds = [...new Set(comprobantes.map(c => c.pedido_id).filter(Boolean))]
    const { data: pedidos } = pedidoIds.length
      ? await supabase.from('pedidos').select('id, vendedor_id').in('id', pedidoIds)
      : { data: [] }
    const pedVendMap = new Map((pedidos ?? []).map(p => [p.id, p.vendedor_id]))

    // Clientes y vendedores
    const [{ data: clientes }, { data: vendedores }] = await Promise.all([
      supabase.from('clientes').select('id, nombre, nombre_razon_social, localidad, vendedor_id, tipo_canal'),
      supabase.from('vendedores').select('id, nombre'),
    ])
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c]))
    const vendedorMap = new Map((vendedores ?? []).map(v => [v.id, v.nombre]))

    const isVenta = (t: string) => TIPOS_VENTA.includes(t?.trim())
    const isNC = (t: string) => TIPOS_NC.includes(t?.trim())
    const inCurrent = (f: string) => f >= dateFrom && f <= dateTo
    const inPrev = (f: string) => f >= prev.from && f <= prev.to

    // Agregar por cliente
    type Agg = {
      fact: number; factPrev: number
      saldo: number; count: number; countPrev: number
      ultimaCompra: string | null; vendedorId: string | null
    }
    const aggMap = new Map<string, Agg>()

    for (const c of comprobantes) {
      if (!aggMap.has(c.cliente_id)) {
        aggMap.set(c.cliente_id, { fact: 0, factPrev: 0, saldo: 0, count: 0, countPrev: 0, ultimaCompra: null, vendedorId: null })
      }
      const agg = aggMap.get(c.cliente_id)!
      const signo = isNC(c.tipo_comprobante) ? -1 : 1
      const monto = Number(c.total_factura ?? 0) * signo

      if (inCurrent(c.fecha)) {
        agg.fact += monto
        agg.count++
        agg.saldo += Number(c.saldo_pendiente ?? 0)
        if (!agg.ultimaCompra || c.fecha > agg.ultimaCompra) agg.ultimaCompra = c.fecha
        if (!agg.vendedorId && c.pedido_id) agg.vendedorId = pedVendMap.get(c.pedido_id) ?? null
      }
      if (inPrev(c.fecha)) {
        agg.factPrev += monto
        agg.countPrev++
      }
    }

    // Construir filas
    const rows = [...aggMap.entries()]
      .map(([clienteId, agg]) => {
        const cl = clienteMap.get(clienteId)
        const vendedorId = agg.vendedorId ?? cl?.vendedor_id ?? null
        const variacionPct = agg.factPrev > 0
          ? ((agg.fact - agg.factPrev) / Math.abs(agg.factPrev)) * 100
          : agg.fact > 0 ? 100 : 0

        const diasSinCompra = agg.ultimaCompra
          ? Math.floor((Date.now() - new Date(agg.ultimaCompra).getTime()) / (1000 * 60 * 60 * 24))
          : null

        let estado: 'Activo' | 'En riesgo' | 'Perdido' | 'Nuevo' = 'Activo'
        if (agg.count === 0 && agg.countPrev > 0) {
          estado = diasSinCompra && diasSinCompra > 60 ? 'Perdido' : 'En riesgo'
        } else if (agg.count > 0 && agg.countPrev === 0) {
          estado = 'Nuevo'
        } else if (agg.count > 0 && variacionPct < -30) {
          estado = 'En riesgo'
        }

        return {
          cliente_id: clienteId,
          nombre: cl?.nombre_razon_social ?? cl?.nombre ?? clienteId,
          localidad: cl?.localidad ?? '—',
          tipo_canal: cl?.tipo_canal ?? '—',
          vendedor_nombre: vendedorId ? (vendedorMap.get(vendedorId) ?? '—') : '—',
          facturacion: Math.max(0, agg.fact),
          facturacion_anterior: agg.factPrev,
          variacion_pct: variacionPct,
          cantidad_comprobantes: agg.count,
          saldo_pendiente: agg.saldo,
          ultima_compra: agg.ultimaCompra,
          estado,
          clasificacion: 'C' as 'A' | 'B' | 'C',
        }
      })
      .filter(r => r.facturacion > 0 || r.facturacion_anterior > 0)
      .sort((a, b) => b.facturacion - a.facturacion)

    // Clasificación ABC por acumulado
    const totalFact = rows.reduce((s, r) => s + r.facturacion, 0)
    let cumulative = 0
    for (const row of rows) {
      cumulative += row.facturacion
      const pct = totalFact > 0 ? cumulative / totalFact : 1
      row.clasificacion = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C'
    }

    return NextResponse.json({ rows, meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalFact } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
