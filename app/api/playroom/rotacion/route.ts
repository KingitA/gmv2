import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { fetchAllRows } from '@/lib/playroom/queries'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Artículos activos (paginado: son más de 1000)
    const articulos = await fetchAllRows(() => supabase
      .from('articulos')
      .select('id, sku, descripcion, stock_actual, ultimo_costo, precio_compra, precio_base, rubro, rubro_id, categoria, proveedor_id, marca_id')
      .eq('activo', true))

    if (!articulos.length) return NextResponse.json([])

    // Proveedores, marcas y rubros (para nombres)
    const [proveedores, marcas, rubros] = await Promise.all([
      fetchAllRows(() => supabase.from('proveedores').select('id, nombre, sigla')),
      fetchAllRows(() => supabase.from('marcas').select('id, descripcion')),
      fetchAllRows(() => supabase.from('rubros').select('id, nombre')),
    ])

    const provMap = new Map(proveedores.map(p => [p.id, p.sigla || p.nombre]))
    const marcaMap = new Map(marcas.map(m => [m.id, m.descripcion]))
    const rubroMap = new Map(rubros.map(r => [r.id, r.nombre]))

    // Agregado del kardex en Postgres (RPC): última venta, unidades 90d y
    // último costo por artículo — escala a millones de movimientos
    const kardexAgg = await fetchAllRows(() => supabase.rpc('playroom_rotacion_kardex'), 'articulo_id')

    const now = new Date()

    const ultimaVentaMap = new Map<string, string>()
    const vel90Map = new Map<string, number>()
    const costoPorKardexMap = new Map<string, number>()

    for (const row of kardexAgg) {
      if (row.ultima_venta) ultimaVentaMap.set(row.articulo_id, row.ultima_venta)
      if (Number(row.unidades_90d) > 0) vel90Map.set(row.articulo_id, Number(row.unidades_90d))
      if (Number(row.costo_ultima_venta) > 0) costoPorKardexMap.set(row.articulo_id, Number(row.costo_ultima_venta))
    }

    const result = articulos.map(a => {
      const ultimaVenta = ultimaVentaMap.get(a.id) ?? null
      const diasSinVenta = ultimaVenta
        ? Math.floor((now.getTime() - new Date(ultimaVenta).getTime()) / (1000 * 60 * 60 * 24))
        : null

      const unidades90 = vel90Map.get(a.id) ?? 0
      const velocidad90d = unidades90 / 90
      const stock = Number(a.stock_actual ?? 0)
      // Cascada de costo (solo campos de compra, nunca precio de venta)
      const costo =
        Number(a.ultimo_costo) > 0 ? Number(a.ultimo_costo) :
        Number(a.precio_compra) > 0 ? Number(a.precio_compra) :
        costoPorKardexMap.get(a.id) ?? 0
      const capital = stock * costo

      const diasStockProyectados = velocidad90d > 0
        ? Math.round(stock / velocidad90d)
        : stock > 0 ? null : 0

      const dias = diasSinVenta ?? 99999
      let sugerencia: 'OK' | 'Devolver' | 'Liquidar' = 'OK'
      if (stock > 0) {
        if (dias >= 180) sugerencia = 'Liquidar'
        else if (dias >= 90) sugerencia = 'Devolver'
      }

      return {
        articulo_id: a.id,
        sku: a.sku,
        descripcion: a.descripcion,
        proveedor_nombre: provMap.get(a.proveedor_id ?? '') ?? '—',
        marca_nombre: marcaMap.get(a.marca_id ?? '') ?? '—',
        rubro: rubroMap.get(a.rubro_id ?? '') ?? a.rubro ?? '—',
        stock_actual: stock,
        ultimo_costo: costo,
        capital_inmovilizado: capital,
        ultima_venta: ultimaVenta,
        dias_sin_venta: diasSinVenta,
        velocidad_90d: Math.round(velocidad90d * 100) / 100,
        dias_stock_proyectados: diasStockProyectados,
        sugerencia,
      }
    }).sort((a, b) => b.capital_inmovilizado - a.capital_inmovilizado)

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
