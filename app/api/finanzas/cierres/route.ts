import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * Cierre de caja / arqueo diario (Fase F1, migración 20260722).
 *
 * GET  /api/finanzas/cierres?fecha=YYYY-MM-DD
 *   → { cajas, cierres, pagos_sin_verificar, historial }
 *     · cajas: cajas_financieras con saldo por color (saldos_financieros)
 *     · cierres: los del día (todos los estados menos cancelado)
 *     · pagos_sin_verificar: confirmados del día sin segunda firma
 *     · historial: últimos 30 cierres confirmados
 *
 * POST /api/finanzas/cierres
 *   { action: "abrir", fecha, cuenta_id, color }            → RPC cierre_caja_abrir
 *   { action: "confirmar", cierre_id, saldo_contado,
 *     desglose?, pago_ids?, notas? }                        → RPC cierre_caja_confirmar
 */

export async function GET(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha")
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "fecha (YYYY-MM-DD) es obligatoria" }, { status: 400 })
    }

    const supabase = await createClient()

    const [cajasRes, saldosRes, cierresRes, pagosRes, histRes] = await Promise.all([
      supabase.from("cajas_financieras").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("saldos_financieros").select("cuenta_tipo, cuenta_id, color, saldo").eq("cuenta_tipo", "CAJA"),
      supabase
        .from("cierres_caja")
        .select("*")
        .eq("fecha", fecha)
        .neq("estado", "CANCELADO"),
      supabase
        .from("pagos_clientes")
        .select(
          "id, monto, fecha_pago, cobrador_tipo, creado_por, cliente_id, clientes(nombre), pagos_detalle(tipo_pago, monto, color_cheque, caja_id)"
        )
        .eq("estado", "confirmado")
        .is("verificado_por", null)
        .eq("fecha_pago", fecha)
        .order("created_at", { ascending: true }),
      supabase
        .from("cierres_caja")
        .select("id, fecha, cuenta_id, color, saldo_teorico, saldo_contado, diferencia, pagos_verificados, confirmado_at")
        .eq("estado", "CONFIRMADO")
        .order("fecha", { ascending: false })
        .limit(30),
    ])

    const saldos = saldosRes.data || []
    const cajas = (cajasRes.data || []).map((c) => ({
      cuenta_id: c.id,
      nombre: c.nombre,
      saldos: {
        BLANCO: Number(saldos.find((s) => s.cuenta_id === c.id && s.color === "BLANCO")?.saldo ?? 0),
        NEGRO: Number(saldos.find((s) => s.cuenta_id === c.id && s.color === "NEGRO")?.saldo ?? 0),
      },
    }))

    return NextResponse.json({
      cajas,
      cierres: cierresRes.data || [],
      pagos_sin_verificar: pagosRes.data || [],
      historial: histRes.data || [],
    })
  } catch (error: any) {
    console.error("[finanzas/cierres] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const supabase = createAdminClient()

    if (body.action === "abrir") {
      const { fecha, cuenta_id, color } = body
      if (!fecha || !cuenta_id || !color) {
        return NextResponse.json({ error: "fecha, cuenta_id y color son obligatorios" }, { status: 400 })
      }
      const { data, error } = await supabase.rpc("cierre_caja_abrir", {
        p_fecha: fecha,
        p_cuenta_tipo: "CAJA",
        p_cuenta_id: cuenta_id,
        p_color: color,
        p_usuario_id: auth.user?.id ?? null,
      })
      if (error) throw error
      return NextResponse.json(data)
    }

    if (body.action === "confirmar") {
      const { cierre_id, saldo_contado, desglose, pago_ids, notas } = body
      if (!cierre_id || saldo_contado === undefined || saldo_contado === null || isNaN(Number(saldo_contado))) {
        return NextResponse.json({ error: "cierre_id y saldo_contado son obligatorios" }, { status: 400 })
      }
      const { data, error } = await supabase.rpc("cierre_caja_confirmar", {
        p_cierre_id: cierre_id,
        p_usuario_id: auth.user?.id ?? null,
        p_saldo_contado: Number(saldo_contado),
        p_desglose: desglose ?? null,
        p_pago_ids: Array.isArray(pago_ids) ? pago_ids : [],
        p_notas: notas ?? null,
      })
      if (error) throw error
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: "action inválida (abrir | confirmar)" }, { status: 400 })
  } catch (error: any) {
    console.error("[finanzas/cierres] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
