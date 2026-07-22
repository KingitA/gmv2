import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchMovimientosMP } from "@/lib/finanzas/extracto-fuentes/mp"
import { importarExtracto } from "@/lib/finanzas/extractos-import"
import { todayArgentina } from "@/lib/utils"

export const maxDuration = 60

/**
 * Cron: sincroniza los movimientos de MercadoPago (últimos 7 días) como
 * extracto fuente 'api_mp' y corre el matching. Idempotente por referencia
 * real de MP — correrlo N veces no duplica nada.
 * Ver vercel.json (cada 30 min). Requiere MP_ACCESS_TOKEN y CRON_SECRET.
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!process.env.MP_ACCESS_TOKEN) {
      return NextResponse.json({ success: false, message: "MP_ACCESS_TOKEN no configurado — sync deshabilitado" })
    }

    const supabase = createAdminClient()
    const { data: cuenta } = await supabase
      .from("cuentas_bancarias")
      .select("id, nombre")
      .ilike("banco", "%mercadopago%")
      .eq("activo", true)
      .limit(1)
      .single()
    if (!cuenta) {
      return NextResponse.json({ success: false, message: "No hay cuenta bancaria MercadoPago activa" })
    }

    const hasta = todayArgentina()
    const desde = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    })

    const { movimientos, fuente_detalle } = await fetchMovimientosMP(desde, hasta)
    if (!movimientos.length) {
      return NextResponse.json({ success: true, message: "Sin movimientos en la ventana", desde, hasta })
    }

    const res = await importarExtracto(supabase, {
      cuenta_bancaria_id: cuenta.id,
      fuente: "api_mp",
      movimientos,
      periodo_desde: desde,
      periodo_hasta: hasta,
    })

    console.log(`[CRON mp-sync] ${fuente_detalle}: ${res.importados} nuevos, ${res.duplicados} dup, matching:`, res.matching)
    return NextResponse.json({ success: true, fuente_detalle, desde, hasta, ...res })
  } catch (error: any) {
    console.error("[CRON mp-sync] error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
