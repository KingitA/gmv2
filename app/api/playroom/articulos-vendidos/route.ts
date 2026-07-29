import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getPreviousPeriod, getSameLastYear, fetchAllRows, fetchByIds } from '@/lib/playroom/queries'
import { todayArgentina } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? todayArgentina()
    const dateTo   = searchParams.get('to')   ?? todayArgentina()
    const comparePeriod = searchParams.get('compare') ?? 'previous'

    // ── Filtros backend (los de lista aceptan valores múltiples separados por coma) ──
    const parseList = (p: string | null) => p ? p.split(',').map(s => s.trim()).filter(Boolean) : []
    const vendedorIds     = parseList(searchParams.get('vendedor_id'))
    const provincias      = parseList(searchParams.get('provincia'))
    const clienteId       = searchParams.get('cliente_id')
    const tipoComp        = searchParams.get('tipo_comprobante')           // 'factura'|'presupuesto'|''
    const conDescuento    = searchParams.get('con_descuento')              // tipo o 'sin_descuento'|''
    const condicionesIva  = parseList(searchParams.get('condicion_iva'))
    const localidades     = parseList(searchParams.get('localidad'))
    const zonas           = parseList(searchParams.get('zona'))
    const fuente          = searchParams.get('fuente')                     // 'pedido'|'comprobante'|''

    const prev = comparePeriod === 'year_ago'
      ? getSameLastYear(dateFrom, dateTo)
      : getPreviousPeriod(dateFrom, dateTo)

    const emptyResponse = () => NextResponse.json({
      rows: [], meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalRevenue: 0 },
    })

    // ── Lookup de clientes para filtros que no están en kardex ─────────────────
    let clienteIdsFiltro: string[] | null = null
    if (condicionesIva.length || localidades.length || zonas.length) {
      let q = supabase.from('clientes').select('id')
      if (condicionesIva.length) q = q.or(condicionesIva.map(v => `condicion_iva.ilike.%${v}%`).join(','))
      if (localidades.length)    q = q.in('localidad', localidades)
      if (zonas.length)          q = q.in('zona', zonas)
      const { data: matchingClientes } = await q
      clienteIdsFiltro = (matchingClientes ?? []).map((c: any) => c.id)
      if (clienteIdsFiltro.length === 0) return emptyResponse()
    }
    let clienteIdsParam: string[] | null = clienteIdsFiltro
    if (clienteId) {
      clienteIdsParam = clienteIdsFiltro ? clienteIdsFiltro.filter(id => id === clienteId) : [clienteId]
      if (clienteIdsParam.length === 0) return emptyResponse()
    }

    const tipos = tipoComp === 'factura' ? ['FA', 'FB', 'FC']
      : tipoComp === 'presupuesto' ? ['PRES', 'REV']
      : null

    // ── Agregación en Postgres (RPC): escala a millones de movimientos ─────────
    const rpcRows = await fetchAllRows(() => supabase.rpc('playroom_articulos_vendidos', {
      p_from: dateFrom,
      p_to: dateTo,
      p_prev_from: prev.from,
      p_prev_to: prev.to,
      p_vendedor_ids: vendedorIds.length ? vendedorIds : null,
      p_provincias: provincias.length ? provincias : null,
      p_cliente_ids: clienteIdsParam,
      p_tipos_comprobante: tipos,
      p_solo_comprobante: fuente === 'comprobante',
      p_descuento: conDescuento || null,
    }), 'articulo_id')

    if (!rpcRows.length) return emptyResponse()

    // Nombres de rubro/marca/proveedor (catálogos chicos + artículos por tandas)
    const articuloIds = rpcRows.map((r: any) => r.articulo_id)
    const [articulos, rubros, marcas, proveedores] = await Promise.all([
      fetchByIds(chunk => supabase.from('articulos').select('id, rubro_id, rubro, marca_id').in('id', chunk), articuloIds),
      fetchAllRows(() => supabase.from('rubros').select('id, nombre')),
      fetchAllRows(() => supabase.from('marcas').select('id, descripcion')),
      fetchAllRows(() => supabase.from('proveedores').select('id, sigla, nombre')),
    ])

    const artMap   = new Map(articulos.map(a => [a.id, a]))
    const rubroMap = new Map(rubros.map(r => [r.id, r.nombre]))
    const marcaMap = new Map(marcas.map(m => [m.id, m.descripcion]))
    const provMap  = new Map(proveedores.map(p => [p.id, p.nombre]))

    const rows = rpcRows
      .map((r: any) => {
        const art = artMap.get(r.articulo_id)
        const neto     = Number(r.neto ?? 0)
        const netoPrev = Number(r.neto_prev ?? 0)
        const costo    = Number(r.costo ?? 0)
        const variacionPct = netoPrev > 0
          ? ((neto - netoPrev) / Math.abs(netoPrev)) * 100
          : neto > 0 ? 100 : 0
        const margenBruto = costo > 0 && neto > 0 ? ((neto - costo) / neto) * 100 : null
        return {
          articulo_id: r.articulo_id,
          sku: r.sku ?? '—',
          descripcion: r.descripcion ?? r.articulo_id,
          rubro: rubroMap.get(art?.rubro_id) ?? art?.rubro ?? '—',
          marca: marcaMap.get(r.marca_id ?? art?.marca_id ?? '') ?? '—',
          proveedor: provMap.get(r.proveedor_id ?? '') ?? '—',
          unidades: Math.round(Number(r.unidades ?? 0)),
          unidades_anterior: Math.round(Number(r.unidades_prev ?? 0)),
          neto,
          neto_anterior: netoPrev,
          iva: Number(r.iva ?? 0),
          revenue: Number(r.total ?? 0),
          variacion_pct: variacionPct,
          costo_total: costo,
          margen_bruto_pct: margenBruto,
          bonificadas: 0,
        }
      })
      .filter(r => r.neto > 0 || r.neto_anterior > 0)
      .sort((a, b) => b.neto - a.neto)

    const totalNeto = rows.reduce((s, r) => s + r.neto, 0)
    let cumulative = 0
    const rowsWithABC = rows.map(r => {
      cumulative += r.neto
      const pct = totalNeto > 0 ? cumulative / totalNeto : 1
      return { ...r, clasificacion: pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C' as const }
    })

    return NextResponse.json({
      rows: rowsWithABC,
      meta: { dateFrom, dateTo, prevFrom: prev.from, prevTo: prev.to, totalRevenue: totalNeto },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
