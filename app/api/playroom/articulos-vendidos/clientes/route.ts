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
    const vendedorId   = searchParams.get('vendedor_id')
    const provincia    = searchParams.get('provincia')
    const clienteId    = searchParams.get('cliente_id')
    const tipoComp     = searchParams.get('tipo_comprobante')
    const conDescuento = searchParams.get('con_descuento')
    const condicionIva = searchParams.get('condicion_iva')
    const localidad    = searchParams.get('localidad')
    const zona         = searchParams.get('zona')

    // Lookup de clientes para filtros que no están denormalizados en kardex
    let clienteIdsFiltro: string[] | null = null
    if (condicionIva || localidad || zona) {
      let q = supabase.from('clientes').select('id')
      if (condicionIva) q = q.ilike('condicion_iva', `%${condicionIva}%`)
      if (localidad)    q = q.ilike('localidad', `%${localidad}%`)
      if (zona)         q = q.eq('zona', zona)
      const { data: matchingClientes } = await q
      clienteIdsFiltro = (matchingClientes ?? []).map((c: any) => c.id)
      if (clienteIdsFiltro.length === 0) {
        return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })
      }
    }

    // Leer directamente del kardex — única fuente de verdad
    let query = supabase
      .from('kardex')
      .select('cliente_id, cantidad, subtotal_total, precio_unitario_final, tipo_movimiento, descuentos_json')
      .eq('articulo_id', articuloId)
      .gte('fecha', startOfDayArgentina(dateFrom))
      .lte('fecha', endOfDayArgentina(dateTo))
      .in('tipo_movimiento', ['venta', 'nota_credito_venta'])
      .not('cliente_id', 'is', null)
      .eq('pedido_eliminado', false)

    if (fuente === 'comprobante') query = query.not('comprobante_venta_id', 'is', null)
    if (vendedorId) query = query.eq('vendedor_id', vendedorId)
    if (provincia)  query = query.eq('provincia_destino', provincia)
    if (clienteId)  query = query.eq('cliente_id', clienteId)
    if (clienteIdsFiltro !== null) query = query.in('cliente_id', clienteIdsFiltro)
    if (tipoComp === 'factura')          query = query.in('tipo_comprobante', ['FA', 'FB', 'FC'])
    else if (tipoComp === 'presupuesto') query = query.in('tipo_comprobante', ['PRES', 'REV'])

    const { data: movimientos, error } = await query

    if (error) throw error
    if (!movimientos?.length) {
      return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })
    }

    // Agregar por cliente — NC resta unidades y revenue
    const aggMap = new Map<string, { unidades: number; revenue: number }>()
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
      const qty = Number(m.cantidad ?? 0) * signo
      const rev = Number(m.subtotal_total ?? 0) * signo

      if (!aggMap.has(m.cliente_id)) aggMap.set(m.cliente_id, { unidades: 0, revenue: 0 })
      const agg = aggMap.get(m.cliente_id)!
      agg.unidades += qty
      agg.revenue  += rev
    }

    // Nombres de clientes
    const clienteIds = [...aggMap.keys()]
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nombre_razon_social, nombre, localidad')
      .in('id', clienteIds)
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c]))

    const totalRevenue  = [...aggMap.values()].reduce((s, a) => s + a.revenue, 0)
    const totalUnidades = [...aggMap.values()].reduce((s, a) => s + a.unidades, 0)

    const rows = [...aggMap.entries()]
      .map(([clienteId, agg]) => {
        const cl = clienteMap.get(clienteId)
        // precio unitario promedio ponderado por las ventas del período
        const precioUnitario = agg.unidades !== 0
          ? Math.abs(agg.revenue / agg.unidades)
          : 0
        return {
          cliente_id: clienteId,
          nombre: cl?.nombre_razon_social ?? cl?.nombre ?? clienteId,
          localidad: cl?.localidad ?? '—',
          unidades: Math.round(agg.unidades),
          revenue: agg.revenue,
          precio_unitario: precioUnitario,
          porcentaje: totalRevenue > 0 ? (agg.revenue / totalRevenue) * 100 : 0,
        }
      })
      .filter(r => r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)

    return NextResponse.json({
      clientes: rows,
      totales: { unidades: Math.round(totalUnidades), revenue: totalRevenue },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
