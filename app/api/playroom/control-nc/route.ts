import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear } from '@/lib/playroom/queries'
import { todayArgentina } from '@/lib/utils'

const TIPOS_NC = ['NCA', 'NCB', 'NCC']
const TIPOS_VENTA = ['FA', 'FB', 'FC']

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

    // NCs y facturas en ambos períodos para calcular ratio
    const { data: comprobantes, error } = await supabase
      .from('comprobantes_venta')
      .select('id, cliente_id, tipo_comprobante, fecha, total_factura, numero_comprobante, punto_venta')
      .gte('fecha', prev.from)
      .lte('fecha', dateTo)
      .in('tipo_comprobante', [...TIPOS_NC, ...TIPOS_VENTA])

    if (error) throw error
    if (!comprobantes?.length) return NextResponse.json({ rows: [], summary: { total_nc: 0, total_nc_prev: 0, total_facturado: 0, ratio_pct: 0 } })

    // Clientes
    const clienteIds = [...new Set(comprobantes.map(c => c.cliente_id).filter(Boolean))]
    const { data: clientes } = clienteIds.length
      ? await supabase.from('clientes').select('id, nombre, nombre_razon_social').in('id', clienteIds)
      : { data: [] }
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c]))

    // Agregar NCs por cliente
    type Agg = {
      nc_count: number; nc_monto: number; nc_count_prev: number; nc_monto_prev: number
      fact_monto: number
      tipos_nc: Record<string, number>
      ultima_nc: string | null
    }
    const aggMap = new Map<string, Agg>()

    let globalFactCurrent = 0
    let globalNCCurrent = 0
    let globalNCPrev = 0

    for (const c of comprobantes) {
      const monto = Number(c.total_factura ?? 0)
      const isNC = TIPOS_NC.includes(c.tipo_comprobante)
      const inCurrent = c.fecha >= dateFrom && c.fecha <= dateTo
      const inPrev = c.fecha >= prev.from && c.fecha <= prev.to

      if (inCurrent && !isNC) globalFactCurrent += monto
      if (inCurrent && isNC) globalNCCurrent += monto
      if (inPrev && isNC) globalNCPrev += monto

      if (!isNC) continue

      const cid = c.cliente_id
      if (!aggMap.has(cid)) {
        aggMap.set(cid, { nc_count: 0, nc_monto: 0, nc_count_prev: 0, nc_monto_prev: 0, fact_monto: 0, tipos_nc: {}, ultima_nc: null })
      }
      const agg = aggMap.get(cid)!

      if (inCurrent) {
        agg.nc_count++
        agg.nc_monto += monto
        agg.tipos_nc[c.tipo_comprobante] = (agg.tipos_nc[c.tipo_comprobante] ?? 0) + 1
        if (!agg.ultima_nc || c.fecha > agg.ultima_nc) agg.ultima_nc = c.fecha
      }
      if (inPrev) {
        agg.nc_count_prev++
        agg.nc_monto_prev += monto
      }
    }

    // Agregar facturación corriente por cliente
    for (const c of comprobantes) {
      if (!TIPOS_VENTA.includes(c.tipo_comprobante)) continue
      if (c.fecha < dateFrom || c.fecha > dateTo) continue
      const agg = aggMap.get(c.cliente_id)
      if (agg) agg.fact_monto += Number(c.total_factura ?? 0)
    }

    const rows = [...aggMap.entries()]
      .map(([clienteId, agg]) => {
        const cl = clienteMap.get(clienteId)
        const variacionPct = agg.nc_monto_prev > 0
          ? ((agg.nc_monto - agg.nc_monto_prev) / Math.abs(agg.nc_monto_prev)) * 100
          : agg.nc_monto > 0 ? 100 : 0
        const ratioPct = agg.fact_monto > 0 ? (agg.nc_monto / agg.fact_monto) * 100 : null
        const tipoMasFrecuente = Object.entries(agg.tipos_nc).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
        return {
          cliente_id: clienteId,
          nombre: cl?.nombre_razon_social ?? cl?.nombre ?? '—',
          nc_count: agg.nc_count,
          nc_monto: agg.nc_monto,
          nc_monto_anterior: agg.nc_monto_prev,
          variacion_pct: variacionPct,
          fact_monto: agg.fact_monto,
          ratio_nc_pct: ratioPct,
          tipo_mas_frecuente: tipoMasFrecuente,
          ultima_nc: agg.ultima_nc,
        }
      })
      .sort((a, b) => b.nc_monto - a.nc_monto)

    const summary = {
      total_nc: globalNCCurrent,
      total_nc_prev: globalNCPrev,
      total_facturado: globalFactCurrent,
      ratio_pct: globalFactCurrent > 0 ? (globalNCCurrent / globalFactCurrent) * 100 : 0,
      variacion_nc_pct: globalNCPrev > 0 ? ((globalNCCurrent - globalNCPrev) / globalNCPrev) * 100 : 0,
    }

    return NextResponse.json({ rows, summary, meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
