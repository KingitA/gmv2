import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const TIPOS_VENTA = ['FA', 'FB', 'FC']
const TIPOS_NC = ['NCA', 'NCB', 'NCC']

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const articuloId = searchParams.get('articulo_id')
    if (!articuloId) return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 })

    const dateFrom = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = searchParams.get('to') ?? new Date().toISOString().slice(0, 10)

    // Comprobantes del período → mapa pedido_id → signo
    const { data: comprobantes } = await supabase
      .from('comprobantes_venta')
      .select('pedido_id, tipo_comprobante, fecha')
      .gte('fecha', dateFrom)
      .lte('fecha', dateTo)
      .in('tipo_comprobante', [...TIPOS_VENTA, ...TIPOS_NC])

    if (!comprobantes?.length) return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })

    const pedidoSignoMap = new Map<string, number>()
    for (const c of comprobantes) {
      if (!c.pedido_id) continue
      const signo = TIPOS_NC.includes(c.tipo_comprobante) ? -1 : 1
      // Si el mismo pedido tiene FA y NC, el último gana (edge case raro)
      pedidoSignoMap.set(c.pedido_id, signo)
    }

    const pedidoIds = [...pedidoSignoMap.keys()]

    // Detalles del artículo en esos pedidos
    const { data: detalles } = await supabase
      .from('pedidos_detalle')
      .select('pedido_id, cantidad, precio_final')
      .eq('articulo_id', articuloId)
      .in('pedido_id', pedidoIds)

    if (!detalles?.length) return NextResponse.json({ clientes: [], totales: { unidades: 0, revenue: 0 } })

    // Pedidos → cliente_id
    const detPedidoIds = [...new Set(detalles.map(d => d.pedido_id))]
    const { data: pedidos } = await supabase
      .from('pedidos')
      .select('id, cliente_id')
      .in('id', detPedidoIds)

    const pedidoClienteMap = new Map((pedidos ?? []).map(p => [p.id, p.cliente_id]))

    // Agregar por cliente
    const aggMap = new Map<string, { unidades: number; revenue: number }>()
    for (const d of detalles) {
      const clienteId = pedidoClienteMap.get(d.pedido_id)
      if (!clienteId) continue
      const signo = pedidoSignoMap.get(d.pedido_id) ?? 1
      const qty = Number(d.cantidad ?? 0) * signo
      const rev = Number(d.precio_final ?? 0) * Number(d.cantidad ?? 0) * signo

      if (!aggMap.has(clienteId)) aggMap.set(clienteId, { unidades: 0, revenue: 0 })
      const agg = aggMap.get(clienteId)!
      agg.unidades += qty
      agg.revenue += rev
    }

    // Clientes
    const clienteIds = [...aggMap.keys()]
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nombre_razon_social, nombre, localidad')
      .in('id', clienteIds)
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c]))

    const totalRevenue = [...aggMap.values()].reduce((s, a) => s + a.revenue, 0)
    const totalUnidades = [...aggMap.values()].reduce((s, a) => s + a.unidades, 0)

    const rows = [...aggMap.entries()]
      .map(([clienteId, agg]) => {
        const cl = clienteMap.get(clienteId)
        return {
          cliente_id: clienteId,
          nombre: cl?.nombre_razon_social ?? cl?.nombre ?? clienteId,
          localidad: cl?.localidad ?? '—',
          unidades: Math.round(agg.unidades),
          revenue: agg.revenue,
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
