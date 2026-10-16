import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSaldosClientes } from "@/lib/cuenta-corriente/saldo"

// GET /api/clientes/saldos?ids=uuid,uuid
// Saldo real y proyectado de uno o varios clientes desde la FUENTE ÚNICA
// (lib/cuenta-corriente/saldo.ts). Las pantallas del ERP lo usan en lugar de
// leer v_saldo_clientes por su cuenta, así todas muestran el mismo número.
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const ids = (request.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500)
  if (!ids.length) return NextResponse.json({ saldos: {} })

  try {
    const supabase = await createClient()
    const saldos = await getSaldosClientes(supabase, ids)
    return NextResponse.json({ saldos: Object.fromEntries(saldos) })
  } catch (error: any) {
    console.error("[clientes/saldos] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
