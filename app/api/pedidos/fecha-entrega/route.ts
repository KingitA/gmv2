import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// Fecha de entrega "suelta" (sin viaje) de uno o varios pedidos, desde el
// calendario de CLIENTES. fecha = null la quita. Mismo patrón que /api/pedidos/prioridad.
// Requiere la migración 20261008_pedidos_fecha_entrega.sql.
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_ids, fecha } = await request.json()

    if (!Array.isArray(pedido_ids) || pedido_ids.length === 0) {
      return NextResponse.json({ error: "pedido_ids requerido" }, { status: 400 })
    }
    if (fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) {
      return NextResponse.json({ error: "Fecha inválida (AAAA-MM-DD o null)" }, { status: 400 })
    }

    const { error } = await supabase
      .from("pedidos")
      .update({ fecha_entrega: fecha })
      .in("id", pedido_ids)

    if (error) {
      if (/fecha_entrega/.test(error.message)) {
        return NextResponse.json({ error: "Falta aplicar en la base la migración de fecha de entrega (20261008_pedidos_fecha_entrega.sql)." }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({ ok: true, fecha })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
