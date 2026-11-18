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
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { finDiaAR, inicioDiaAR } from "@/lib/formato"

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

    // kardex.fecha es timestamptz: días argentinos completos (no UTC)
    const desdeTs = inicioDiaAR(desde)
    const hastaTs = finDiaAR(hasta)

    // ── 1. IVA Ventas (Débito Fiscal) — desde kardex, ventas con IVA discriminado ──
    const kardexVentas = await fetchAllRows(() => supabase
      .from("kardex")
      .select("subtotal_neto, subtotal_iva, subtotal_total, iva_porcentaje, iva_incluido, tipo_comprobante, provincia_destino, percepcion_iva_monto, percepcion_iibb_monto, percepcion_ganancias_monto")
      .eq("tipo_movimiento", "venta")
      .eq("iva_incluido", false)          // solo facturas A/B/C con IVA discriminado
      .in("tipo_comprobante", ["FA", "FB", "NCA", "NCB", "NDA", "NDB"])  // solo fiscales — PRES/REV/REM nunca van a reportes fiscales
      .gte("fecha", desdeTs)
      .lte("fecha", hastaTs))

    let debito_fiscal_21 = 0
    let debito_fiscal_10 = 0
    let debito_fiscal_0 = 0
    let base_imponible_ventas = 0
    const iibb_por_provincia: Record<string, number> = {}
    const ganancias_por_provincia: Record<string, number> = {}
    let percepciones_iva_total = 0

    for (const f of kardexVentas) {
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

    // Percepciones desde comprobantes_venta (para comprobantes anteriores al kardex o con percepcion_iva > 0)
    const compVenta = await fetchAllRows(() => supabase
      .from("comprobantes_venta")
      .select("percepcion_iva, percepcion_iibb, total_iva, total_neto, tipo_comprobante, clientes(provincia)")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .in("tipo_comprobante", ["FA", "FB", "NCA", "NCB", "NDA", "NDB"])
      .gt("percepcion_iva", 0))

    // Sumar percepciones de comprobantes que no están en kardex
    const kardexCompIds = new Set<string>()
    for (const cv of compVenta) {
      const percIva  = Number(cv.percepcion_iva  ?? 0)
      const percIibb = Number(cv.percepcion_iibb ?? 0)
      if (percIva > 0)  percepciones_iva_total += percIva
      if (percIibb > 0) {
        const prov = (cv as any).clientes?.provincia || "Sin provincia"
        iibb_por_provincia[prov] = (iibb_por_provincia[prov] || 0) + percIibb
      }
    }

    // ── 2. IVA Compras (Crédito Fiscal) ──
    // E-81: la cuenta la hace la base (función reporte_iva_compras, migración 20261119c). Antes se
    // traían TODOS los renglones de compras a este servidor, no se restaban las notas de crédito
    // y entraban comprobantes sin validar. Ahora: solo comprobantes VALIDADOS con IVA discriminado
    // (factura A, notas de débito y de crédito A), las notas de crédito restan, y el total sale del
    // IVA del encabezado de cada comprobante (el que se controló al validar).
    let credito_fiscal_21 = 0
    let credito_fiscal_10 = 0
    let credito_fiscal_0 = 0
    let base_imponible_compras = 0
    let percepciones_iva_compras = 0
    let percepciones_iibb_compras = 0
    let comprobantes_compra = 0
    let notas_credito_compra = 0
    let aviso_compras: string | null = null
    {
      const { data: ivaCompras, error: ivaComprasError } = await supabase.rpc("reporte_iva_compras", { p_desde: desde, p_hasta: hasta })
      if (ivaComprasError) {
        // No se inventa un crédito fiscal: sin la consulta, va en cero y se avisa
        console.error("[Reportes/IVA] IVA compras:", ivaComprasError.message)
        aviso_compras = "No se pudo calcular el IVA de compras (falta aplicar la migración 20261119c_jarvis_compras.sql): el crédito fiscal figura en cero y el saldo de IVA NO es válido."
      } else {
        const c = (ivaCompras ?? {}) as Record<string, number>
        credito_fiscal_21 = Number(c.iva_21 ?? 0)
        credito_fiscal_10 = Number(c.iva_10_5 ?? 0)
        credito_fiscal_0 = Number(c.iva_otras ?? 0)
        base_imponible_compras = Number(c.base_imponible ?? 0)
        percepciones_iva_compras = Number(c.percepciones_iva ?? 0)
        percepciones_iibb_compras = Number(c.percepciones_iibb ?? 0)
        comprobantes_compra = Number(c.comprobantes ?? 0)
        notas_credito_compra = Number(c.notas_credito ?? 0)
      }
    }

    const r = (n: number) => Math.round(n * 100) / 100

    // ── Comprobantes de venta — resumen por tipo ──────────────────────────────
    const compVentaResumen = await fetchAllRows(() => supabase
      .from("comprobantes_venta")
      .select("tipo_comprobante, total_neto, total_iva, total_factura, percepcion_iva, percepcion_iibb")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .in("tipo_comprobante", ["FA", "FB", "NCA", "NCB", "NDA", "NDB"]))

    const resumen_por_tipo: Record<string, { cantidad: number; neto: number; iva: number; total: number }> = {}
    for (const cv of compVentaResumen) {
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
        // Otras alícuotas (ni 21 % ni 10,5 %): antes este campo sumaba renglones sin IVA y daba siempre 0
        iva_exento: r(credito_fiscal_0),
        total_credito: r(credito_fiscal_21 + credito_fiscal_10 + credito_fiscal_0),
        // Percepciones que nos hicieron los proveedores en esas compras (a cuenta nuestra)
        percepciones_iva_sufridas: r(percepciones_iva_compras),
        percepciones_iibb_sufridas: r(percepciones_iibb_compras),
        comprobantes: comprobantes_compra,
        notas_credito: notas_credito_compra,
        aviso: aviso_compras,
      },

      // ── Saldo IVA ─────────────────────────────────────────────────────────
      saldo_iva: r((debito_fiscal_21 + debito_fiscal_10) - (credito_fiscal_21 + credito_fiscal_10 + credito_fiscal_0)),

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
