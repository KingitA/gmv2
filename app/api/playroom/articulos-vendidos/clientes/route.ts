import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { todayArgentina, startOfDayArgentina, endOfDayArgentina } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const articuloId = searchParams.get('articulo_id')
    if (!articuloId) return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 })

    const dateFrom = searchParams.get('from') ?? todayArgentina()
    const dateTo   = searchParams.get('to')   ?? todayArgentina()
    const fuente   = searchParams.get('fuente') // 'comprobante' | ''

    // Mismos filtros que el reporte principal (articulos-vendidos/route.ts)
    const parseList = (p: string | null) => p ? p.split(',').map(s => s.trim()).filter(Boolean) : []
    const vendedorIds    = parseList(searchParams.get('vendedor_id'))
    const provincias     = parseList(searchParams.get('provincia'))
    const clienteId      = searchParams.get('cliente_id')
    const tipoComp       = searchParams.get('tipo_comprobante')
    const conDescuento   = searchParams.get('con_descuento')
    const condicionesIva = parseList(searchParams.get('condicion_iva'))
    const localidades    = parseList(searchParams.get('localidad'))
    const zonas          = parseList(searchParams.get('zona'))

    // Lookup de clientes para filtros que no están denormalizados en kardex
    let clienteIdsFiltro: string[] | null = null
    if (condicionesIva.length || localidades.length || zonas.length) {
      let q = supabase.from('clientes').select('id')
      if (condicionesIva.length) q = q.or(condicionesIva.map(v => `condicion_iva.ilike.%${v}%`).join(','))
      if (localidades.length)    q = q.in('localidad', localidades)
      if (zonas.length)          q = q.in('zona', zonas)
      const { data: matchingClientes } = await q
      clienteIdsFiltro = (matchingClientes ?? []).map((c: any) => c.id)
      if (clienteIdsFiltro.length === 0) {
        return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })
      }
    }

    // Leer directamente del kardex — única fuente de verdad
    let query = supabase
      .from('kardex')
      .select('cliente_id, cantidad, subtotal_total, subtotal_neto, precio_unitario_final, tipo_movimiento, descuentos_json')
      .eq('articulo_id', articuloId)
      .gte('fecha', startOfDayArgentina(dateFrom))
      .lte('fecha', endOfDayArgentina(dateTo))
      .in('tipo_movimiento', ['venta', 'nota_credito_venta'])
      .not('cliente_id', 'is', null)
      .eq('pedido_eliminado', false)

    if (fuente === 'comprobante') query = query.not('comprobante_venta_id', 'is', null)
    if (vendedorIds.length) query = query.in('vendedor_id', vendedorIds)
    if (provincias.length)  query = query.in('provincia_destino', provincias)
    if (clienteId)          query = query.eq('cliente_id', clienteId)
    if (clienteIdsFiltro !== null) query = query.in('cliente_id', clienteIdsFiltro)
    if (tipoComp === 'factura')          query = query.in('tipo_comprobante', ['FA', 'FB', 'FC'])
    else if (tipoComp === 'presupuesto') query = query.in('tipo_comprobante', ['PRES', 'REV'])

    // Paginado con ORDER BY estable (PostgREST corta en 1000 filas por default)
    query = query.order('id', { ascending: true })
    const PAGE_SIZE = 1000
    const movimientos: any[] = []
    let offset = 0
    while (true) {
      const { data: page, error: pageError } = await query.range(offset, offset + PAGE_SIZE - 1)
      if (pageError) throw pageError
      if (!page?.length) break
      movimientos.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (!movimientos.length) {
      return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })
    }

    // Agregar por cliente — NC resta unidades y revenue
    const aggMap = new Map<string, { unidades: number; neto: number; revenue: number }>()
    for (const m of movimientos) {
      if (!m.cliente_id) continue

      if (conDescuento) {
        const desc: any[] = Array.isArray(m.descuentos_json) ? m.descuentos_json : []
        if (conDescuento === 'sin_descuento') {
          if (desc.some(d => d.porcentaje > 0)) continue
        } else {
          if (!desc.some(d => d.tipo === conDescuento && d.porcentaje > 0)) continue
        }
      }

      const signo = m.tipo_movimiento === 'nota_credito_venta' ? -1 : 1
      const qty  = Number(m.cantidad ?? 0) * signo
      const rev  = Number(m.subtotal_total ?? 0) * signo
      const neto = Number(m.subtotal_neto ?? m.subtotal_total ?? 0) * signo

      if (!aggMap.has(m.cliente_id)) aggMap.set(m.cliente_id, { unidades: 0, neto: 0, revenue: 0 })
      const agg = aggMap.get(m.cliente_id)!
      agg.unidades += qty
      agg.neto     += neto
      agg.revenue  += rev
    }

    // Nombres de clientes
    const clienteIds = [...aggMap.keys()]
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nombre_razon_social, nombre, localidad')
      .in('id', clienteIds)
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c]))

    const totalNeto     = [...aggMap.values()].reduce((s, a) => s + a.neto, 0)
    const totalRevenue  = [...aggMap.values()].reduce((s, a) => s + a.revenue, 0)
    const totalUnidades = [...aggMap.values()].reduce((s, a) => s + a.unidades, 0)

    const rows = [...aggMap.entries()]
      .map(([clienteId, agg]) => {
        const cl = clienteMap.get(clienteId)
        // precio unitario promedio ponderado (neto) por las ventas del período
        const precioUnitario = agg.unidades !== 0
          ? Math.abs(agg.neto / agg.unidades)
          : 0
        return {
          cliente_id: clienteId,
          nombre: cl?.nombre_razon_social ?? cl?.nombre ?? clienteId,
          localidad: cl?.localidad ?? '—',
          unidades: Math.round(agg.unidades),
          neto: agg.neto,
          revenue: agg.revenue,
          precio_unitario: precioUnitario,
          porcentaje: totalNeto > 0 ? (agg.neto / totalNeto) * 100 : 0,
        }
      })
      .filter(r => r.neto > 0)
      .sort((a, b) => b.neto - a.neto)

    return NextResponse.json({
      clientes: rows,
      totales: { unidades: Math.round(totalUnidades), neto: totalNeto, revenue: totalRevenue },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
