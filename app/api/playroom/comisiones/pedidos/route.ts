import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { startOfDayArgentina, endOfDayArgentina } from '@/lib/utils'
import { fechaISO } from '@/lib/formato'
import { comisionesGanadas } from '@/lib/comisiones/ganadas'
import { sinPedidosExcluidos } from '@/lib/comisiones/pedidos-sin-comision'

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

    // COBRADA = comisión ganada en la cuenta personal (#42, lib/comisiones/ganadas.ts),
    // agrupada por pedido. El monto del pedido sale de la tabla pedidos.
    if (tipo === 'cobrada') {
      const ganadas = await comisionesGanadas(supabase, { desde: dateFrom, hasta: dateTo, vendedorId: viajanteId })
      const porPedido = new Map<string, { comision: number; fecha_cobro: string; cliente_id: string | null; skus: Set<string> }>()
      for (const g of ganadas) {
        const pid = g.pedido_id ?? 'sin_pedido'
        const a = porPedido.get(pid) || { comision: 0, fecha_cobro: '', cliente_id: g.cliente_id, skus: new Set<string>() }
        a.comision += g.monto
        if (g.fecha > a.fecha_cobro) a.fecha_cobro = g.fecha
        for (const l of g.lineas) if (l.articulo_id) a.skus.add(l.articulo_id)
        porPedido.set(pid, a)
      }
      const pedidoIds = [...porPedido.keys()].filter((id) => id !== 'sin_pedido')
      const { data: peds } = pedidoIds.length
        ? await supabase.from('pedidos').select('id, numero_pedido, fecha, total').in('id', pedidoIds)
        : { data: [] as any[] }
      const pedMap = new Map((peds ?? []).map((p: any) => [p.id, p]))
      const cliIds = [...new Set([...porPedido.values()].map((a) => a.cliente_id).filter(Boolean))] as string[]
      const { data: clis } = cliIds.length
        ? await supabase.from('clientes').select('id, nombre_razon_social, nombre').in('id', cliIds)
        : { data: [] as any[] }
      const cliMap = new Map((clis ?? []).map((c: any) => [c.id, c.nombre_razon_social ?? c.nombre ?? c.id]))
      const pedidos = [...porPedido.entries()]
        .map(([pid, a]) => {
          const p: any = pedMap.get(pid)
          return {
            pedido_id: pid,
            numero_pedido: p?.numero_pedido ?? '—',
            cliente_id: a.cliente_id,
            cliente_nombre: cliMap.get(a.cliente_id ?? '') ?? '—',
            fecha: p?.fecha ? fechaISO(p.fecha) : a.fecha_cobro,
            fecha_cobro: a.fecha_cobro || null,
            total_monto: Number(p?.total ?? 0),
            total_comision: Math.round(a.comision * 100) / 100,
            cantidad_skus: a.skus.size,
          }
        })
        .sort((a, b) => b.total_comision - a.total_comision)
      return NextResponse.json({ pedidos, fuente: 'cuenta_personal' })
    }

    const dateField = 'fecha'

    const PAGE_SIZE = 1000
    let kardexRows: any[] = []
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

      // ORDER BY estable: sin él la paginación duplica/pierde filas
      q = q.order('id', { ascending: true })

      const { data: page, error } = await q.range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error
      if (!page?.length) break
      kardexRows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    // Sin pedidos eliminados ni del sistema viejo (#10)
    kardexRows = await sinPedidosExcluidos(supabase, kardexRows)
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
          fecha: fechaISO(k.fecha), // timestamptz → día argentino
          fecha_cobro: fechaISO(k.fecha_comprobante_cobrado) || null,
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
