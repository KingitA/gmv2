import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

// PATCH: Actualizar cantidad_preparada y estado_item en pedidos_detalle
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { pedido_detalle_id, cantidad_preparada, es_faltante, cantidad_pedida } = body

    if (!pedido_detalle_id) {
      return NextResponse.json({ error: "pedido_detalle_id requerido" }, { status: 400 })
    }

    let estado_item = "PENDIENTE"
    if (es_faltante) {
      estado_item = "FALTANTE"
    } else if (cantidad_preparada >= cantidad_pedida) {
      estado_item = "COMPLETO"
    } else if (cantidad_preparada > 0) {
      estado_item = "PARCIAL"
    }

    const { data, error } = await supabase
      .from("pedidos_detalle")
      .update({ cantidad_preparada, estado_item })
      .eq("id", pedido_detalle_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: `Error: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json(data)

  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}

// POST: Finalizar picking de un pedido
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id } = await request.json()

    // Verificar que no haya items PENDIENTE
    const { data: items } = await supabase
      .from("pedidos_detalle")
      .select("id, estado_item")
      .eq("pedido_id", pedido_id)

    const pendientes = (items || []).filter(
      (i: any) => !i.estado_item || i.estado_item === "PENDIENTE"
    ).length

    if (pendientes > 0) {
      return NextResponse.json(
        { error: `Quedan ${pendientes} artículos sin resolver` },
        { status: 400 }
      )
    }

    // Marcar pedido como pendiente_facturacion
    await supabase
      .from("pedidos")
      .update({ estado: "pendiente_facturacion" })
      .eq("id", pedido_id)

    // Cerrar sesión de picking
    await supabase
      .from("picking_sesiones")
      .update({ estado: "TERMINADO", fin_at: new Date().toISOString() })
      .eq("pedido_id", pedido_id)
      .eq("estado", "EN_PROGRESO")

    return NextResponse.json({ ok: true })

  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}
