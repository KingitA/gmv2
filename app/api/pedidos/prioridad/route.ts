import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id, prioridad } = await request.json()

    if (!pedido_id || prioridad === undefined) {
      return NextResponse.json({ error: "pedido_id y prioridad requeridos" }, { status: 400 })
    }

    // Validar prioridad: 1=urgente, 2=alta, 3=normal
    if (![1, 2, 3].includes(prioridad)) {
      return NextResponse.json({ error: "Prioridad inválida (1=urgente, 2=alta, 3=normal)" }, { status: 400 })
    }

    const { error } = await supabase
      .from("pedidos")
      .update({ prioridad })
      .eq("id", pedido_id)

    if (error) throw error

    return NextResponse.json({ ok: true, prioridad })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
