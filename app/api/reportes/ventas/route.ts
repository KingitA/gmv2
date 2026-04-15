/**
 * GET /api/reportes/ventas
 *
 * Reporte de ventas desde el kardex unificado.
 *
 * Query params (todos opcionales):
 *   desde            YYYY-MM-DD
 *   hasta            YYYY-MM-DD
 *   cliente_id       UUID
 *   proveedor_id     UUID  (proveedor del artículo)
 *   vendedor_id      UUID
 *   lista_precio_id  UUID
 *   tipo_comprobante 'FA' | 'FB' | 'FC' | 'PRES' | ...
 *   metodo_facturacion 'Factura' | 'Presupuesto' | 'Final'
 *   categoria        string (articulo_categoria)
 *   articulo_id      UUID
 *   color_dinero     'BLANCO' | 'NEGRO'
 *   agrupar_por      'articulo' | 'cliente' | 'vendedor' | 'categoria' | 'dia' | 'mes'  (default: ninguno)
 *   page             número de página (default: 1)
 *   per_page         filas por página (default: 100, max: 500)
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

const TIPOS_VENTA = ["venta", "nota_credito_venta", "nota_debito_venta"]

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const clienteId = searchParams.get("cliente_id")
    const proveedorId = searchParams.get("proveedor_id")
    const vendedorId = searchParams.get("vendedor_id")
    const listaPrecioId = searchParams.get("lista_precio_id")
    const tipoComprobante = searchParams.get("tipo_comprobante")
    const metodoFacturacion = searchParams.get("metodo_facturacion")
    const categoria = searchParams.get("categoria")
    const articuloId = searchParams.get("articulo_id")
    const colorDinero = searchParams.get("color_dinero")
    const agruparPor = searchParams.get("agrupar_por") // 'articulo'|'cliente'|'vendedor'|'categoria'|'dia'|'mes'
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const perPage = Math.min(500, Math.max(1, parseInt(searchParams.get("per_page") || "100")))

    // ── Construir query base ───────────────────────────────────────────────────
    let query = supabase
      .from("kardex")
      .select(`
        id, fecha, tipo_movimiento, signo,
        articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, articulo_proveedor_id,
        articulo_iva_compras, articulo_iva_ventas,
        cantidad,
        cliente_id, vendedor_id,
        precio_costo, precio_unitario_neto, precio_unitario_final,
        iva_porcentaje, iva_monto_unitario, iva_incluido,
        descuento_cliente_pct,
        subtotal_neto, subtotal_iva, subtotal_total,
        margen_unitario, margen_porcentaje,
        tipo_comprobante, numero_comprobante, metodo_facturacion, color_dinero, va_en_comprobante,
        percepcion_iva_monto, percepcion_iibb_monto, percepcion_ganancias_monto,
        provincia_destino,
        comprobante_venta_id, pedido_id, lista_precio_id,
        clientes:cliente_id(razon_social, zona, condicion_iva),
        comprobante:comprobante_venta_id(estado_pago, saldo_pendiente, fecha_vencimiento)
      `, { count: "exact" })
      .in("tipo_movimiento", TIPOS_VENTA)

    if (desde) query = query.gte("fecha", `${desde}T00:00:00`)
    if (hasta) query = query.lte("fecha", `${hasta}T23:59:59`)
    if (clienteId) query = query.eq("cliente_id", clienteId)
    if (proveedorId) query = query.eq("articulo_proveedor_id", proveedorId)
    if (vendedorId) query = query.eq("vendedor_id", vendedorId)
    if (listaPrecioId) query = query.eq("lista_precio_id", listaPrecioId)
    if (tipoComprobante) query = query.eq("tipo_comprobante", tipoComprobante)
    if (metodoFacturacion) query = query.eq("metodo_facturacion", metodoFacturacion)
    if (categoria) query = query.ilike("articulo_categoria", `%${categoria}%`)
    if (articuloId) query = query.eq("articulo_id", articuloId)
    if (colorDinero) query = query.eq("color_dinero", colorDinero)

    // Paginación
    const from = (page - 1) * perPage
    query = query.order("fecha", { ascending: false }).range(from, from + perPage - 1)

    const { data: filas, count, error } = await query
    if (error) throw error

    // ── Totales agregados ─────────────────────────────────────────────────────
    // Segunda query sin paginación para totales del filtro completo
    let totalesQuery = supabase
      .from("kardex")
      .select("subtotal_neto, subtotal_iva, subtotal_total, cantidad, precio_costo, margen_unitario, signo")
      .in("tipo_movimiento", TIPOS_VENTA)

    if (desde) totalesQuery = totalesQuery.gte("fecha", `${desde}T00:00:00`)
    if (hasta) totalesQuery = totalesQuery.lte("fecha", `${hasta}T23:59:59`)
    if (clienteId) totalesQuery = totalesQuery.eq("cliente_id", clienteId)
    if (proveedorId) totalesQuery = totalesQuery.eq("articulo_proveedor_id", proveedorId)
    if (vendedorId) totalesQuery = totalesQuery.eq("vendedor_id", vendedorId)
    if (listaPrecioId) totalesQuery = totalesQuery.eq("lista_precio_id", listaPrecioId)
    if (tipoComprobante) totalesQuery = totalesQuery.eq("tipo_comprobante", tipoComprobante)
    if (metodoFacturacion) totalesQuery = totalesQuery.eq("metodo_facturacion", metodoFacturacion)
    if (categoria) totalesQuery = totalesQuery.ilike("articulo_categoria", `%${categoria}%`)
    if (articuloId) totalesQuery = totalesQuery.eq("articulo_id", articuloId)
    if (colorDinero) totalesQuery = totalesQuery.eq("color_dinero", colorDinero)

    const { data: totalesData } = await totalesQuery

    let total_neto = 0, total_iva = 0, total_bruto = 0
    let total_costo = 0, total_margen = 0, total_unidades = 0

    for (const f of totalesData || []) {
      const s = f.signo === -1 ? 1 : -1   // venta = signo -1, pero para el total sumamos positivo
      total_neto += (f.subtotal_neto || 0) * s
      total_iva += (f.subtotal_iva || 0) * s
      total_bruto += (f.subtotal_total || 0) * s
      total_unidades += (f.cantidad || 0) * s
      if (f.precio_costo && f.cantidad) total_costo += f.precio_costo * f.cantidad * s
      if (f.margen_unitario && f.cantidad) total_margen += f.margen_unitario * f.cantidad * s
    }

    const margen_porcentaje_promedio = total_neto > 0
      ? Math.round((total_margen / total_neto) * 10000) / 100 : 0

    // ── Agrupación opcional ───────────────────────────────────────────────────
    let agrupado: any[] | null = null
    if (agruparPor && totalesData) {
      const grupos: Record<string, any> = {}
      for (const f of totalesData) {
        let key: string
        switch (agruparPor) {
          case "categoria": key = (f as any).articulo_categoria || "Sin categoría"; break
          case "dia":       key = (f as any).fecha?.slice(0, 10) || ""; break
          case "mes":       key = (f as any).fecha?.slice(0, 7) || ""; break
          default:          key = ""; break
        }
        if (!grupos[key]) grupos[key] = { key, neto: 0, iva: 0, total: 0, unidades: 0, margen: 0 }
        const s = f.signo === -1 ? 1 : -1
        grupos[key].neto      += (f.subtotal_neto || 0) * s
        grupos[key].iva       += (f.subtotal_iva || 0) * s
        grupos[key].total     += (f.subtotal_total || 0) * s
        grupos[key].unidades  += (f.cantidad || 0) * s
        grupos[key].margen    += ((f.margen_unitario || 0) * (f.cantidad || 0)) * s
      }
      agrupado = Object.values(grupos).sort((a, b) => b.total - a.total)
    }

    return NextResponse.json({
      filas,
      pagination: { page, per_page: perPage, total: count || 0 },
      totales: {
        total_neto: Math.round(total_neto * 100) / 100,
        total_iva: Math.round(total_iva * 100) / 100,
        total_bruto: Math.round(total_bruto * 100) / 100,
        total_costo: Math.round(total_costo * 100) / 100,
        total_margen: Math.round(total_margen * 100) / 100,
        margen_porcentaje_promedio,
        total_unidades: Math.round(total_unidades * 100) / 100,
      },
      agrupado,
    })
  } catch (error: any) {
    console.error("[Reportes/Ventas] Error:", error)
    return NextResponse.json({ error: error.message || "Error generando reporte" }, { status: 500 })
  }
}
