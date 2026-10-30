import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { leerCajaAjustes, saldoCajaAjustes } from "@/lib/finanzas/caja-ajustes"

// GET /api/finanzas/caja-ajustes?mes=aaaa-mm&origen=&usuario_id= — caja de ajustes
// (P2-03): saldo total, y el detalle filtrado por mes, tipo y usuario. Solo admin.
// ?solo_saldo=1 → { saldo } (la tarjeta de Finanzas).
export async function GET(req: NextRequest) {
  const auth = await requirePermiso("caja_ajustes")
  if (auth.error) return auth.error
  try {
    const p = req.nextUrl.searchParams
    if (p.get("solo_saldo") === "1") return NextResponse.json({ saldo: await saldoCajaAjustes(createAdminClient()) })
    return NextResponse.json(
      await leerCajaAjustes(createAdminClient(), { mes: p.get("mes"), origen: p.get("origen"), usuarioId: p.get("usuario_id") }),
    )
  } catch (error: any) {
    console.error("[finanzas/caja-ajustes]", error)
    return NextResponse.json({ error: error.message || "Error leyendo la caja de ajustes" }, { status: 500 })
  }
}
