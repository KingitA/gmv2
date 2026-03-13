import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

// PATCH: Actualizar un item de picking (escaneo/cantidad)
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { sesion_id, picking_item_id, cantidad_preparada, estado, observaciones } = body

    if (!sesion_id || !picking_item_id) {
      return NextResponse.json({ error: "sesion_id y picking_item_id requeridos" }, { status: 400 })
    }

    // Get current user name
    const { data: { user } } = await supabase.auth.getUser()
    let userName = user?.email?.split("@")[0] || "Operario"
    if (user?.id) {
      const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", user.id).single()
      if (u?.nombre) userName = u.nombre
    }

    const updateData: any = {
      estado: estado || "preparado",
      fecha_escaneo: new Date().toISOString(),
      usuario_id: user?.id,
      usuario_nombre: userName,
      updated_at: new Date().toISOString(),
    }
    if (cantidad_preparada !== undefined) updateData.cantidad_preparada = cantidad_preparada
    if (observaciones) updateData.observaciones = observaciones

    const { data: item, error } = await supabase
      .from("picking_items")
      .update(updateData)
      .eq("id", picking_item_id)
      .eq("sesion_id", sesion_id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(item)
  } catch (error: any) {
    console.error("[deposito] Error PATCH picking item:", error)
    return NextResponse.json({ error: "Error al actualizar item" }, { status: 500 })
  }
}

// POST: Finalizar sesión de picking completa
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { sesion_id, pedido_id } = await request.json()

    // Verificar que todos los items están resueltos
    const { data: items } = await supabase
      .from("picking_items")
      .select("id, estado")
      .eq("sesion_id", sesion_id)

    const pendientes = items?.filter((i: any) => i.estado === "pendiente") || []
    if (pendientes.length > 0) {
      return NextResponse.json(
        { error: `Quedan ${pendientes.length} artículos sin escanear` },
        { status: 400 }
      )
    }

    // Finalizar sesión
    await supabase
      .from("picking_sesiones")
      .update({ estado: "finalizado", fecha_fin: new Date().toISOString() })
      .eq("id", sesion_id)

    // Actualizar estado del pedido
    await supabase
      .from("pedidos")
      .update({ estado: "pendiente_facturacion" })
      .eq("id", pedido_id)

    return NextResponse.json({ ok: true, message: "Picking finalizado correctamente" })
  } catch (error: any) {
    console.error("[deposito] Error finalizando picking:", error)
    return NextResponse.json({ error: "Error al finalizar picking" }, { status: 500 })
  }
}
