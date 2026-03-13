import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET: Devoluciones pendientes de recibir físicamente
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: devoluciones, error } = await supabase
      .from("devoluciones")
      .select(`
        id,
        numero_devolucion,
        estado,
        observaciones,
        created_at,
        clientes(id, nombre, razon_social),
        devoluciones_detalle(
          id,
          cantidad,
          motivo,
          es_vendible,
          articulos(id, sku, descripcion, ean13)
        )
      `)
      .in("estado", ["pendiente"])
      .order("created_at", { ascending: true })

    if (error) throw error

    return NextResponse.json(devoluciones || [])
  } catch (error: any) {
    console.error("[deposito] Error GET devoluciones:", error)
    return NextResponse.json({ error: "Error al obtener devoluciones" }, { status: 500 })
  }
}

// POST: Confirmar recepción física de devolución
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { devolucion_id, items_confirmados } = await request.json()
    // items_confirmados: [{ detalle_id, articulo_id, cantidad_recibida, es_vendible }]

    const { data: { user } } = await supabase.auth.getUser()
    let userName = user?.email?.split("@")[0] || "Operario"
    if (user?.id) {
      const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", user.id).single()
      if (u?.nombre) userName = u.nombre
    }

    // Update each item with confirmed vendible status
    for (const item of items_confirmados || []) {
      await supabase
        .from("devoluciones_detalle")
        .update({ es_vendible: item.es_vendible })
        .eq("id", item.detalle_id)

      // If vendible, restore stock
      if (item.es_vendible && item.cantidad_recibida > 0) {
        const { data: art } = await supabase
          .from("articulos")
          .select("stock_actual")
          .eq("id", item.articulo_id)
          .single()

        await supabase
          .from("articulos")
          .update({ stock_actual: (art?.stock_actual || 0) + item.cantidad_recibida })
          .eq("id", item.articulo_id)

        await supabase.from("movimientos_stock").insert({
          articulo_id: item.articulo_id,
          tipo_movimiento: "entrada",
          cantidad: item.cantidad_recibida,
          observaciones: `Devolución #${devolucion_id} — mercadería vendible`,
        })
      }
    }

    // Mark devolucion as confirmed (ERP will generate nota de crédito)
    await supabase
      .from("devoluciones")
      .update({
        estado: "confirmado",
        confirmado_por: userName,
        fecha_confirmacion: new Date().toISOString(),
      })
      .eq("id", devolucion_id)

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error("[deposito] Error POST devoluciones:", error)
    return NextResponse.json({ error: "Error al confirmar devolución" }, { status: 500 })
  }
}
