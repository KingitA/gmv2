import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/chofer/billetera
// Retorna el saldo y movimientos de la billetera del chofer
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const userId = auth.user.id

    const { data: movimientos } = await supabase
      .from("billetera_movimientos")
      .select("id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, created_at")
      .eq("viajante_id", userId)
      .order("fecha", { ascending: false })
      .limit(100)

    const todos = movimientos || []

    const saldo = todos.reduce((s, m) => s + Number(m.monto), 0)

    const cobros = todos
      .filter((m) => m.tipo === "cobro_cliente")
      .reduce((s, m) => s + Number(m.monto), 0)

    const fondos = todos
      .filter((m) => m.tipo === "credito")
      .reduce((s, m) => s + Number(m.monto), 0)

    const gastos = todos
      .filter((m) => m.tipo === "debito")
      .reduce((s, m) => s + Math.abs(Number(m.monto)), 0)

    // Agrupar por viaje para historial
    const porViaje = new Map<string, any[]>()
    for (const m of todos) {
      const key = m.referencia_tipo === "viaje" && m.referencia_id ? m.referencia_id : "_sin_viaje"
      if (!porViaje.has(key)) porViaje.set(key, [])
      porViaje.get(key)!.push(m)
    }

    return NextResponse.json({
      saldo,
      desglose: {
        cobros,
        fondos_recibidos: fondos,
        gastos,
      },
      movimientos: todos,
    })
  } catch (error: any) {
    console.error("[chofer] Error en GET billetera:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
