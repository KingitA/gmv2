import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"
import { calcularIndicadores } from "@/lib/playroom/indicadores"

// Tablero de Playroom: calcula SOLO las tarjetas pedidas (?ids=a,b,c), leyendo la base.
// Las cuentas viven en lib/playroom/indicadores.ts (las comparte Jarvis).
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const pedidos = new URL(req.url).searchParams.get("ids")?.split(",").map(s => s.trim()).filter(Boolean) ?? []
  if (pedidos.length === 0) return NextResponse.json({ bloques: {} })
  return NextResponse.json(await calcularIndicadores(createAdminClient(), pedidos))
}
