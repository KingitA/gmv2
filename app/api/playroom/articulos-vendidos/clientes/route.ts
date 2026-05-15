import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { todayArgentina } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const articuloId = searchParams.get('articulo_id')
    if (!articuloId) return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 })

    const dateFrom = searchParams.get('from') ?? todayArgentina()
    const dateTo   = searchParams.get('to')   ?? todayArgentina()
    const fuente   = searchParams.get('fuente') // 'comprobante' | ''

    // Leer directamente del kardex — única fuente de verdad
    let query = supabase
      .from('kardex')
      .select('cliente_id, cantidad, subtotal_total, precio_unitario_final, tipo_movimiento')
      .eq('articulo_id', articuloId)
      .gte('fecha', dateFrom)
      .lte('fecha', dateTo)
      .in('tipo_movimiento', ['venta', 'nota_credito_venta'])
      .not('cliente_id', 'is', null)

    if (fuente === 'comprobante') query = query.not('comprobante_venta_id', 'is', null)

    const { data: movimientos, error } = await query

    if (error) throw error
    if (!movimientos?.length) {
      return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })
    }

    // Agregar por cliente — NC resta unidades y revenue
    const aggMap = new Map<string, { unidades: number; revenue: number }>()
    for (const m of movimientos) {
      if (!m.cliente_id) continue
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
