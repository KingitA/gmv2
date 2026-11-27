import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { leerMercadoPago } from "@/lib/bancos/lectura-servidor"
import { parseFecha } from "@/lib/formato"

export const maxDuration = 60

/**
 * POST /api/finanzas/extractos/mp — lectura manual de MercadoPago.
 * Body opcional: { desde?, hasta? } (default: últimos 7 días).
 * Sin MP_ACCESS_TOKEN responde { conectado: false, mensaje: "MercadoPago no conectado" } (no es un error).
 * Mismo circuito idempotente que la lectura periódica (/api/cron/bancos-lectura).
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const res = await leerMercadoPago(createAdminClient(), {
      dias: 7,
      desde: parseFecha(body?.desde) ?? undefined,
      hasta: parseFecha(body?.hasta) ?? undefined,
      usuarioId: auth.user?.id ?? null,
    })
    return NextResponse.json({ success: true, ...res })
  } catch (error: any) {
    console.error("[finanzas/extractos/mp] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
