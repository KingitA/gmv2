import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchMovimientosMP } from "@/lib/finanzas/extracto-fuentes/mp"
import { importarExtracto } from "@/lib/finanzas/extractos-import"
import { todayArgentina } from "@/lib/utils"

export const maxDuration = 60

/**
 * POST /api/finanzas/extractos/mp — sync manual de MercadoPago.
 * Body opcional: { desde?, hasta? } (default: últimos 7 días).
 * Mismo circuito idempotente que el cron /api/cron/mp-sync.
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: "MP_ACCESS_TOKEN no configurado en Vercel — pedile al admin que lo cargue" },
        { status: 400 }
      )
    }
    const body = await request.json().catch(() => ({}))

    const supabase = createAdminClient()
    const { data: cuenta } = await supabase
      .from("cuentas_bancarias")
      .select("id, nombre")
      .ilike("banco", "%mercadopago%")
      .eq("activo", true)
      .limit(1)
      .single()
    if (!cuenta) return NextResponse.json({ error: "No hay cuenta bancaria MercadoPago activa" }, { status: 400 })

    const hasta = body.hasta || todayArgentina()
    const desde =
      body.desde ||
      new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })

    const { movimientos, fuente_detalle } = await fetchMovimientosMP(desde, hasta)
    if (!movimientos.length) {
      return NextResponse.json({ success: true, importados: 0, duplicados: 0, message: "MP no devolvió movimientos en la ventana", desde, hasta })
    }

    const res = await importarExtracto(supabase, {
      cuenta_bancaria_id: cuenta.id,
      fuente: "api_mp",
      movimientos,
      periodo_desde: desde,
      periodo_hasta: hasta,
      importado_por: auth.user?.id ?? null,
    })

    return NextResponse.json({ success: true, fuente_detalle, desde, hasta, ...res })
  } catch (error: any) {
    console.error("[finanzas/extractos/mp] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
