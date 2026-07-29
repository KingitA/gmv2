import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { todayArgentina } from '@/lib/utils'
import { fetchAllRows } from '@/lib/playroom/queries'

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

    const emptyResponse = () => NextResponse.json({ clientes: [], totales: { unidades: 0, neto: 0, revenue: 0 } })

    // Lookup de clientes para filtros que no están denormalizados en kardex
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

    // Agregación por cliente en Postgres (RPC)
    const rpcRows = await fetchAllRows(() => supabase.rpc('playroom_articulo_clientes', {
      p_articulo_id: articuloId,
      p_from: dateFrom,
      p_to: dateTo,
      p_vendedor_ids: vendedorIds.length ? vendedorIds : null,
      p_provincias: provincias.length ? provincias : null,
      p_cliente_ids: clienteIdsParam,
      p_tipos_comprobante: tipos,
      p_solo_comprobante: fuente === 'comprobante',
      p_descuento: conDescuento || null,
    }), 'cliente_id')

    if (!rpcRows.length) return emptyResponse()

    const totalNeto     = rpcRows.reduce((s: number, r: any) => s + Number(r.neto ?? 0), 0)
    const totalRevenue  = rpcRows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
    const totalUnidades = rpcRows.reduce((s: number, r: any) => s + Number(r.unidades ?? 0), 0)

    const rows = rpcRows
      .map((r: any) => {
        const neto = Number(r.neto ?? 0)
        const unidades = Number(r.unidades ?? 0)
        return {
          cliente_id: r.cliente_id,
          nombre: r.nombre,
          localidad: r.localidad ?? '—',
          unidades: Math.round(unidades),
          neto,
          revenue: Number(r.total ?? 0),
          // precio unitario promedio ponderado (neto) por las ventas del período
          precio_unitario: unidades !== 0 ? Math.abs(neto / unidades) : 0,
          porcentaje: totalNeto > 0 ? (neto / totalNeto) * 100 : 0,
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
