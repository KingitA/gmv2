/**
 * GET /api/reportes/iva
 *
 * Posición IVA para el contador.
 * Devuelve débito fiscal (IVA ventas), crédito fiscal (IVA compras),
 * percepciones IVA, IIBB por provincia y percepciones de ganancias.
 *
 * Query params:
 *   desde   YYYY-MM-DD  (requerido)
 *   hasta   YYYY-MM-DD  (requerido)
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    if (!desde || !hasta) {
      return NextResponse.json({ error: "Los parámetros 'desde' y 'hasta' son requeridos (YYYY-MM-DD)" }, { status: 400 })
    }

    const desdeTs = `${desde}T00:00:00`
    const hastaTs = `${hasta}T23:59:59`

    // ── 1. IVA Ventas (Débito Fiscal) — desde kardex, ventas con IVA discriminado ──
    const { data: kardexVentas } = await supabase
      .from("kardex")
      .select("subtotal_neto, subtotal_iva, subtotal_total, iva_porcentaje, iva_incluido, tipo_comprobante, provincia_destino, percepcion_iva_monto, percepcion_iibb_monto, percepcion_ganancias_monto")
      .eq("tipo_movimiento", "venta")
      .eq("iva_incluido", false)          // solo facturas A/B/C con IVA discriminado
      .neq("tipo_comprobante", "PRES")    // excluir presupuestos
      .gte("fecha", desdeTs)
      .lte("fecha", hastaTs)

    let debito_fiscal_21 = 0
    let debito_fiscal_10 = 0
    let debito_fiscal_0 = 0
    let base_imponible_ventas = 0
    const iibb_por_provincia: Record<string, number> = {}
    const ganancias_por_provincia: Record<string, number> = {}
    let percepciones_iva_total = 0

    for (const f of kardexVentas || []) {
      const iva = f.subtotal_iva || 0
      const neto = f.subtotal_neto || 0
      base_imponible_ventas += neto

      if (f.iva_porcentaje === 21) debito_fiscal_21 += iva
      else if (f.iva_porcentaje === 10.5) debito_fiscal_10 += iva
      else debito_fiscal_0 += iva

      // Percepciones
      percepciones_iva_total += f.percepcion_iva_monto || 0
      const prov = f.provincia_destino || "Sin provincia"
      iibb_por_provincia[prov] = (iibb_por_provincia[prov] || 0) + (f.percepcion_iibb_monto || 0)
      ganancias_por_provincia[prov] = (ganancias_por_provincia[prov] || 0) + (f.percepcion_ganancias_monto || 0)
    }

    // También sumar percepciones desde comprobantes_venta directamente
    // (para los que se generaron antes de que existiera el kardex)
    const { data: compVenta } = await supabase
      .from("comprobantes_venta")
      .select("percepcion_iva, percepcion_iibb, total_iva, total_neto, tipo_comprobante")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .neq("tipo_comprobante", "PRES")
      .not("percepcion_iva", "is", null)

    // ── 2. IVA Compras (Crédito Fiscal) — desde comprobantes_compra_detalle ──
    const { data: comprasDetalle } = await supabase
      .from("comprobantes_compra_detalle")
      .select(`
        cantidad_facturada, precio_unitario, iva_porcentaje,
        descuento1, descuento2, descuento3, descuento4,
        comprobante:comprobante_id(
          fecha_comprobante, tipo_comprobante, estado_pago
        )
      `)
      .gte("comprobante.fecha_comprobante", desde)
      .lte("comprobante.fecha_comprobante", hasta)

    let credito_fiscal_21 = 0
    let credito_fiscal_10 = 0
    let credito_fiscal_0 = 0
    let base_imponible_compras = 0

    for (const d of comprasDetalle || []) {
      const comp = Array.isArray(d.comprobante) ? d.comprobante[0] : d.comprobante
      if (!comp) continue
      // Solo facturas A (tipo_comprobante FA) generan crédito fiscal
      if (!["FA", "NDA"].includes(comp.tipo_comprobante || "")) continue

      let precio = d.precio_unitario || 0
      if (d.descuento1) precio *= (1 - d.descuento1 / 100)
      if (d.descuento2) precio *= (1 - d.descuento2 / 100)
      if (d.descuento3) precio *= (1 - d.descuento3 / 100)
      if (d.descuento4) precio *= (1 - d.descuento4 / 100)

      const neto = precio * (d.cantidad_facturada || 0)
      const ivaAmt = neto * ((d.iva_porcentaje || 0) / 100)
      base_imponible_compras += neto

      if (d.iva_porcentaje === 21) credito_fiscal_21 += ivaAmt
      else if (d.iva_porcentaje === 10.5) credito_fiscal_10 += ivaAmt
      else credito_fiscal_0 += ivaAmt
    }

    const r = (n: number) => Math.round(n * 100) / 100

    // ── Comprobantes de venta — resumen por tipo ──────────────────────────────
    const { data: compVentaResumen } = await supabase
      .from("comprobantes_venta")
      .select("tipo_comprobante, total_neto, total_iva, total_factura, percepcion_iva, percepcion_iibb")
      .gte("fecha", desde)
      .lte("fecha", hasta)

    const resumen_por_tipo: Record<string, { cantidad: number; neto: number; iva: number; total: number }> = {}
    for (const cv of compVentaResumen || []) {
      const tipo = cv.tipo_comprobante || "?"
      if (!resumen_por_tipo[tipo]) resumen_por_tipo[tipo] = { cantidad: 0, neto: 0, iva: 0, total: 0 }
      resumen_por_tipo[tipo].cantidad++
      resumen_por_tipo[tipo].neto  += cv.total_neto || 0
      resumen_por_tipo[tipo].iva   += cv.total_iva || 0
      resumen_por_tipo[tipo].total += cv.total_factura || 0
    }

    return NextResponse.json({
      periodo: { desde, hasta },

      // ── Débito fiscal (IVA Ventas) ─────────────────────────────────────────
      debito_fiscal: {
        base_imponible: r(base_imponible_ventas),
        iva_21: r(debito_fiscal_21),
        iva_10_5: r(debito_fiscal_10),
        iva_exento: r(debito_fiscal_0),
        total_debito: r(debito_fiscal_21 + debito_fiscal_10),
      },

      // ── Crédito fiscal (IVA Compras) ──────────────────────────────────────
      credito_fiscal: {
        base_imponible: r(base_imponible_compras),
        iva_21: r(credito_fiscal_21),
        iva_10_5: r(credito_fiscal_10),
        iva_exento: r(credito_fiscal_0),
        total_credito: r(credito_fiscal_21 + credito_fiscal_10),
      },

      // ── Saldo IVA ─────────────────────────────────────────────────────────
      saldo_iva: r((debito_fiscal_21 + debito_fiscal_10) - (credito_fiscal_21 + credito_fiscal_10)),

      // ── Percepciones IVA ──────────────────────────────────────────────────
      percepciones_iva: r(percepciones_iva_total),

      // ── IIBB por provincia ────────────────────────────────────────────────
      iibb_por_provincia: Object.entries(iibb_por_provincia)
        .map(([provincia, monto]) => ({ provincia, monto: r(monto) }))
        .sort((a, b) => b.monto - a.monto),

      // ── Percepciones de ganancias por provincia ───────────────────────────
      ganancias_por_provincia: Object.entries(ganancias_por_provincia)
        .map(([provincia, monto]) => ({ provincia, monto: r(monto) }))
        .sort((a, b) => b.monto - a.monto),

      // ── Resumen de comprobantes emitidos ──────────────────────────────────
      comprobantes_emitidos: Object.entries(resumen_por_tipo)
        .map(([tipo, datos]) => ({
          tipo,
          cantidad: datos.cantidad,
          neto: r(datos.neto),
          iva: r(datos.iva),
          total: r(datos.total),
        }))
        .sort((a, b) => b.total - a.total),
    })
  } catch (error: any) {
    console.error("[Reportes/IVA] Error:", error)
    return NextResponse.json({ error: error.message || "Error generando reporte IVA" }, { status: 500 })
  }
}
