import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/finanzas/tablero — todos los KPIs de tesorería en una llamada.
 * Solo SELECT sobre las vistas de la migración 20260725_h1.
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const [posicion, cheques, verificacion, rendiciones, calle, cierres, costos, proyeccion, aging] =
      await Promise.all([
        supabase.from("v_posicion_tesoreria").select("*"),
        supabase.from("v_cheques_vencimientos").select("*"),
        supabase.from("v_verificacion_pendiente").select("*").single(),
        supabase.from("v_rendicion_diferencias").select("*"),
        supabase.from("v_dias_calle").select("*"),
        supabase.from("v_cierres_resumen").select("*"),
        supabase.from("v_costo_cheques").select("*").limit(6),
        supabase.from("v_proyeccion_caja").select("*"),
        supabase.from("v_aging_clientes").select("corriente, dias_30_59, dias_60_89, mas_90, saldo_total"),
      ])

    const err = [posicion, cheques, rendiciones, calle, cierres, costos, proyeccion, aging].find((r) => r.error)
    if (err?.error) throw err.error

    // Aging agregado (la vista es por cliente)
    const agingTotal = (aging.data || []).reduce(
      (acc, r: any) => ({
        corriente: acc.corriente + Number(r.corriente || 0),
        dias_30_59: acc.dias_30_59 + Number(r.dias_30_59 || 0),
        dias_60_89: acc.dias_60_89 + Number(r.dias_60_89 || 0),
        mas_90: acc.mas_90 + Number(r.mas_90 || 0),
        saldo_total: acc.saldo_total + Number(r.saldo_total || 0),
      }),
      { corriente: 0, dias_30_59: 0, dias_60_89: 0, mas_90: 0, saldo_total: 0 }
    )

    return NextResponse.json({
      posicion: posicion.data || [],
      cheques: cheques.data || [],
      verificacion: verificacion.data || null,
      rendiciones: rendiciones.data || [],
      dias_calle: calle.data || [],
      cierres: cierres.data || [],
      costo_cheques: costos.data || [],
      proyeccion: proyeccion.data || [],
      aging: agingTotal,
    })
  } catch (error: any) {
    console.error("[finanzas/tablero] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
