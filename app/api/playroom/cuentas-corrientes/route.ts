import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { todayArgentina } from '@/lib/utils'
import { fetchAllRows, fetchByIds } from '@/lib/playroom/queries'

// Débitos cobrables: facturas, presupuestos y notas de débito. Antes solo
// FA/FB/FC — el aging ignoraba PRES/ND y sobreestimaba o subestimaba la deuda
// vs. el libro mayor y la pantalla de cuenta corriente.
const TIPOS_DEBITO = ['FA', 'FB', 'FC', 'PRES', 'ND', 'NDA', 'NDB', 'NDC']

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Comprobantes con saldo pendiente (paginado). Excluye anulados.
    const comprobantes = await fetchAllRows(() => supabase
      .from('comprobantes_venta')
      .select('id, cliente_id, pedido_id, tipo_comprobante, numero_comprobante, punto_venta, fecha, fecha_vencimiento, total_factura, saldo_pendiente, estado_pago')
      .in('tipo_comprobante', TIPOS_DEBITO)
      .is('anulado_en', null)
      .gt('saldo_pendiente', 0))

    if (!comprobantes.length) return NextResponse.json({ rows: [], summary: { total: 0, t0_30: 0, t31_60: 0, t61_90: 0, t90_mas: 0 } })

    // Vendedor desde pedidos (lookup por tandas)
    const pedidoIds = [...new Set(comprobantes.map(c => c.pedido_id).filter(Boolean))] as string[]
    const pedidos = await fetchByIds(chunk => supabase.from('pedidos').select('id, vendedor_id').in('id', chunk), pedidoIds)
    const pedVendMap = new Map(pedidos.map(p => [p.id, p.vendedor_id]))

    // Clientes y vendedores (paginado)
    const [clientes, vendedores] = await Promise.all([
      fetchAllRows(() => supabase.from('clientes').select('id, nombre, nombre_razon_social, localidad, vendedor_id')),
      fetchAllRows(() => supabase.from('vendedores').select('id, nombre')),
    ])
    const clienteMap = new Map(clientes.map(c => [c.id, c]))
    const vendedorMap = new Map(vendedores.map(v => [v.id, v.nombre]))

    // Fecha de hoy en Argentina, anclada a mediodía UTC para comparar contra
    // fechas DATE (que JS parsea como medianoche UTC) sin corrimiento de día
    const hoy = new Date(todayArgentina() + 'T12:00:00Z')

    // Calcular antigüedad de cada comprobante
    const withAge = comprobantes.map(c => {
      const ref = (c.fecha_vencimiento ?? c.fecha)?.slice(0, 10)
      const dias = Math.floor((hoy.getTime() - new Date(ref + 'T12:00:00Z').getTime()) / (1000 * 60 * 60 * 24))
      const saldo = Number(c.saldo_pendiente)
      return { ...c, dias_mora: Math.max(0, dias), saldo }
    })

    // Agregar por cliente
    type Agg = {
      total: number; t0_30: number; t31_60: number; t61_90: number; t90_mas: number
      comprobante_mas_viejo: string | null; dias_mora_sum: number; vendedor_id: string | null
      count: number
    }
    const aggMap = new Map<string, Agg>()

    for (const c of withAge) {
      if (!aggMap.has(c.cliente_id)) {
        aggMap.set(c.cliente_id, { total: 0, t0_30: 0, t31_60: 0, t61_90: 0, t90_mas: 0, comprobante_mas_viejo: null, dias_mora_sum: 0, vendedor_id: null, count: 0 })
      }
      const agg = aggMap.get(c.cliente_id)!
      agg.total += c.saldo
      agg.count++
      agg.dias_mora_sum += c.dias_mora

      if (c.dias_mora <= 30) agg.t0_30 += c.saldo
      else if (c.dias_mora <= 60) agg.t31_60 += c.saldo
      else if (c.dias_mora <= 90) agg.t61_90 += c.saldo
      else agg.t90_mas += c.saldo

      const ref = c.fecha_vencimiento ?? c.fecha
      if (!agg.comprobante_mas_viejo || ref < agg.comprobante_mas_viejo) agg.comprobante_mas_viejo = ref
      if (!agg.vendedor_id && c.pedido_id) agg.vendedor_id = pedVendMap.get(c.pedido_id) ?? null
    }

    const rows = [...aggMap.entries()]
      .map(([clienteId, agg]) => {
        const cl = clienteMap.get(clienteId)
        const vendedorId = agg.vendedor_id ?? cl?.vendedor_id ?? null
        return {
          cliente_id: clienteId,
          nombre: cl?.nombre_razon_social ?? cl?.nombre ?? clienteId,
          localidad: cl?.localidad ?? '—',
          vendedor_nombre: vendedorId ? (vendedorMap.get(vendedorId) ?? '—') : '—',
          total_deuda: agg.total,
          t0_30: agg.t0_30,
          t31_60: agg.t31_60,
          t61_90: agg.t61_90,
          t90_mas: agg.t90_mas,
          comprobante_mas_viejo: agg.comprobante_mas_viejo,
          dias_promedio_mora: agg.count > 0 ? Math.round(agg.dias_mora_sum / agg.count) : 0,
          cantidad_comprobantes: agg.count,
        }
      })
      .sort((a, b) => b.total_deuda - a.total_deuda)

    // Resumen global para KPIs
    const summary = {
      total: rows.reduce((s, r) => s + r.total_deuda, 0),
      t0_30: rows.reduce((s, r) => s + r.t0_30, 0),
      t31_60: rows.reduce((s, r) => s + r.t31_60, 0),
      t61_90: rows.reduce((s, r) => s + r.t61_90, 0),
      t90_mas: rows.reduce((s, r) => s + r.t90_mas, 0),
    }

    return NextResponse.json({ rows, summary })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
