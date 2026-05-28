import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// POST /api/chofer/viaje/[id]/devolucion
// El chofer registra una devolución durante el reparto.
// Reutiliza la estructura de /api/devoluciones pero fija retira_viajante=true.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId } = await params
    const body = await request.json()

    const {
      cliente_id,
      pedido_id,
      items, // [{ articulo_id, cantidad, precio_venta_original, motivo, es_vendible, condicion, origen }]
      observaciones,
    } = body

    if (!cliente_id || !items?.length) {
      return NextResponse.json({ error: "cliente_id e items son requeridos" }, { status: 400 })
    }

    // Verificar que el viaje es del chofer y está activo
    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    if (viaje.estado !== "en_curso") {
      return NextResponse.json({ error: "El viaje no está activo" }, { status: 400 })
    }

    const montoTotal = items.reduce(
      (s: number, i: any) => s + Number(i.cantidad) * Number(i.precio_venta_original),
      0
    )

    // Número correlativo de devolución
    const { count } = await supabase
      .from("devoluciones")
      .select("*", { count: "exact", head: true })

    const numeroDevolucion = `DEV-${String((count || 0) + 1).padStart(5, "0")}`

    const { data: devolucion, error: devError } = await supabase
      .from("devoluciones")
      .insert({
        numero_devolucion: numeroDevolucion,
        cliente_id,
        vendedor_id: auth.user.id,
        pedido_id: pedido_id || null,
        viaje_id: viajeId,
        retira_viajante: true,
        observaciones,
        estado: "pendiente",
        monto_total: montoTotal,
      })
      .select()
      .single()

    if (devError) throw devError

    const itemsInsert = items.map((item: any) => ({
      devolucion_id: devolucion.id,
      articulo_id: item.articulo_id,
      cantidad: Number(item.cantidad),
      precio_venta_original: Number(item.precio_venta_original),
      motivo: item.motivo || "",
      es_vendible: item.condicion === "vendible",
      condicion: item.condicion || "vendible",
      comprobante_venta_id: item.comprobante_venta_id || null,
      fecha_venta_original: item.fecha_venta_original || null,
    }))

    const { error: itemsError } = await supabase
      .from("devoluciones_detalle")
      .insert(itemsInsert)

    if (itemsError) throw itemsError

    return NextResponse.json({
      success: true,
      devolucion_id: devolucion.id,
      numero_devolucion: numeroDevolucion,
      monto_total: montoTotal,
      mensaje: "Devolución registrada. Se procesará al confirmar la rendición.",
    })
  } catch (error: any) {
    console.error("[chofer] Error en POST devolucion:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
