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

    // Todo el kardex de ventas (incluye precio_costo como fallback de costo)
    const kardex = await fetchAllRows(() => supabase
      .from('kardex')
      .select('articulo_id, fecha, cantidad, precio_costo')
      .eq('tipo_movimiento', 'venta'))

    const now = new Date()
    const hace90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()

    // Mapa: última venta, unidades vendidas en 90 días, y último precio_costo conocido
    const ultimaVentaMap = new Map<string, string>()
    const vel90Map = new Map<string, number>()
    const costoPorKardexMap = new Map<string, number>()

    for (const row of kardex ?? []) {
      const prev = ultimaVentaMap.get(row.articulo_id)
      if (!prev || row.fecha > prev) {
        ultimaVentaMap.set(row.articulo_id, row.fecha)
        // Guardamos el precio_costo de la venta más reciente como fallback
        if (Number(row.precio_costo) > 0) costoPorKardexMap.set(row.articulo_id, Number(row.precio_costo))
      }
      if (row.fecha >= hace90) {
        vel90Map.set(row.articulo_id, (vel90Map.get(row.articulo_id) ?? 0) + Number(row.cantidad))
      }
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
