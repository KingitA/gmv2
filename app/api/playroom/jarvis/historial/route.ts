import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { historialDecisiones } from "@/lib/jarvis/agenda"

// Historial de decisiones: quién hizo qué y cuándo (de la bitácora inborrable).
export async function GET(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const u = new URL(req.url).searchParams
  try {
    const filas = await historialDecisiones(createAdminClient(), { texto: u.get("texto"), desde: u.get("desde"), limite: Number(u.get("limite")) || 100 })
    return NextResponse.json({ filas: filas.map(({ detalle: _d, ...f }) => f) })
  } catch (e) {
    console.error("[jarvis] historial", e)
    return NextResponse.json({ filas: [] })
  }
}
