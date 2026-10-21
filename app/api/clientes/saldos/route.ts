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

  let ids = (request.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500)
  // ?todos=1 → todos los clientes que tienen algo (saldo en el libro, cobros sin
  // verificar o devoluciones en proceso). Los demás están en cero. Lo usa la
  // columna Saldo de la lista de clientes (auditoría 21/10).
  const todos = request.nextUrl.searchParams.get("todos") === "1"
  if (!ids.length && !todos) return NextResponse.json({ saldos: {} })

  try {
    const supabase = await createClient()
    if (todos) {
      const [libro, pagos, devs] = await Promise.all([
        supabase.from("v_saldo_clientes").select("cliente_id").neq("saldo_actual", 0),
        supabase.from("pagos_clientes").select("cliente_id").in("estado", ["pendiente", "pendiente_rendicion"]),
        supabase.from("devoluciones").select("cliente_id").in("estado", ["pendiente", "confirmado"]),
      ])
      for (const r of [libro, pagos, devs]) if (r.error) throw r.error
      ids = [...new Set([...(libro.data || []), ...(pagos.data || []), ...(devs.data || [])].map((r: any) => r.cliente_id).filter(Boolean))]
    }
    const saldos = await getSaldosClientes(supabase, ids)
    return NextResponse.json({ saldos: Object.fromEntries(saldos) })
  } catch (error: any) {
    console.error("[clientes/saldos] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
