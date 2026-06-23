import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { startOfDayArgentina, endOfDayArgentina } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(req.url)

    const viajanteId = searchParams.get('viajante_id')
    const dateFrom = searchParams.get('from')
    const dateTo = searchParams.get('to')
    const tipo = searchParams.get('tipo') ?? 'cobrada'

    if (!viajanteId || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'viajante_id, from, to requeridos' }, { status: 400 })
    }

    const dateField = tipo === 'cobrada' ? 'fecha_comprobante_cobrado' : 'fecha'

    const PAGE_SIZE = 1000
    const kardexRows: any[] = []
    let offset = 0
    while (true) {
      let q = supabase
        .from('kardex')
        .select('pedido_id, numero_pedido, cliente_id, fecha, fecha_comprobante_cobrado, articulo_id, subtotal_total, comision_viajante_monto, comprobante_cobrado')
        .eq('tipo_movimiento', 'venta')
        .not('comision_viajante_monto', 'is', null)
        .neq('comision_viajante_monto', 0)
        .eq('pedido_eliminado', false)
        .eq('vendedor_id', viajanteId)
        .gte(dateField, startOfDayArgentina(dateFrom))
        .lte(dateField, endOfDayArgentina(dateTo))

      if (tipo === 'cobrada') q = q.eq('comprobante_cobrado', true)

      const { data: page, error } = await q.range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error
      if (!page?.length) break
      kardexRows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (!kardexRows.length) return NextResponse.json({ pedidos: [] })

    type PedidoAgg = {
      pedido_id: string
      numero_pedido: string
      cliente_id: string | null
      fecha: string
      fecha_cobro: string | null
      total_monto: number
      total_comision: number
      skus: Set<string>
    }

    const aggMap = new Map<string, PedidoAgg>()

    for (const k of kardexRows) {
      const pid = k.pedido_id ?? 'sin_pedido'
      if (!aggMap.has(pid)) {
        aggMap.set(pid, {
          pedido_id: pid,
          numero_pedido: k.numero_pedido ?? '—',
          cliente_id: k.cliente_id,
          fecha: k.fecha?.slice(0, 10) ?? '',
          fecha_cobro: k.fecha_comprobante_cobrado?.slice(0, 10) ?? null,
          total_monto: 0,
          total_comision: 0,
          skus: new Set(),
        })
      }
      const agg = aggMap.get(pid)!
      agg.total_monto += Number(k.subtotal_total ?? 0)
      agg.total_comision += Number(k.comision_viajante_monto ?? 0)
      if (k.articulo_id) agg.skus.add(k.articulo_id)
    }

    const clienteIds = [...new Set([...aggMap.values()].map(a => a.cliente_id).filter(Boolean))] as string[]
    const { data: clientes } = clienteIds.length > 0
      ? await supabase.from('clientes').select('id, nombre_razon_social, nombre').in('id', clienteIds)
      : { data: [] }
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c.nombre_razon_social ?? c.nombre ?? c.id]))

    const pedidos = [...aggMap.values()]
      .map(agg => ({
        pedido_id: agg.pedido_id,
        numero_pedido: agg.numero_pedido,
        cliente_id: agg.cliente_id,
        cliente_nombre: clienteMap.get(agg.cliente_id ?? '') ?? '—',
        fecha: agg.fecha,
        fecha_cobro: agg.fecha_cobro,
        total_monto: agg.total_monto,
        total_comision: agg.total_comision,
        cantidad_skus: agg.skus.size,
      }))
      .sort((a, b) => b.total_comision - a.total_comision)

    return NextResponse.json({ pedidos })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
