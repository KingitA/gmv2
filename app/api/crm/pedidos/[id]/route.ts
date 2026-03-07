import { type NextRequest, NextResponse } from "next/server"
import { ERP_CONFIG } from "@/lib/config/erp"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from '@/lib/auth'

const ERP_BASE_URL = ERP_CONFIG.baseUrl || "http://localhost:3001"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { id } = await params

    console.log("[v0] Fetching pedido detail from ERP:", id)

    const response = await fetch(`${ERP_BASE_URL}/api/pedidos/${id}`, {
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      console.error("[v0] ERP returned status:", response.status)

      if (response.status === 404) {
        return NextResponse.json(
          {
            error: "Pedido no encontrado",
            message: "El ERP debe implementar: GET /api/pedidos/{id}",
            details:
              "Este endpoint debe devolver el pedido completo con estructura: {id, numero, fecha, cliente_nombre, cliente_localidad, total, estado, detalle: [{articulos: {sku, nombre, precio, unidades_por_bulto}, cantidad, precio_unitario, subtotal}]}",
          },
          { status: 404 },
        )
      }

      return NextResponse.json({ error: `ERP error: ${response.status}` }, { status: response.status })
    }

    const data = await response.json()
    console.log("[v0] Pedido loaded successfully from ERP")

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error fetching pedido:", error)
    return NextResponse.json({ error: "Error de conexión con el ERP" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { id } = await params
    const body = await request.json()

    console.log("[v0] Updating pedido:", id)
    console.log("[v0] Update data:", body)

    const supabase = await createClient()

    const { data: pedido, error: pedidoError } = await supabase.from("pedidos").select("*").eq("id", id).single()

    if (pedidoError || !pedido) {
      console.error("[v0] Pedido not found:", pedidoError)
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    if (pedido.estado !== "pendiente") {
      return NextResponse.json({ error: "Solo se pueden editar pedidos pendientes" }, { status: 400 })
    }

    const { error: deleteError } = await supabase.from("pedidos_detalle").delete().eq("pedido_id", id)

    if (deleteError) {
      console.error("[v0] Error deleting old items:", deleteError)
      return NextResponse.json({ error: "Error eliminando items anteriores" }, { status: 500 })
    }

    const itemsToInsert = body.items.map((item: any) => ({
      pedido_id: id,
      articulo_id: item.articulo_id,
      cantidad: item.cantidad,
      precio_final: item.precio_unitario,
      subtotal: item.cantidad * item.precio_unitario,
      precio_base: item.precio_unitario,
      precio_costo: 0,
      descuento_articulo: 0,
      comision: 0,
      flete: 0,
      impuestos: 0,
    }))

    const { error: insertError } = await supabase.from("pedidos_detalle").insert(itemsToInsert)

    if (insertError) {
      console.error("[v0] Error inserting new items:", insertError)
      return NextResponse.json({ error: "Error insertando items" }, { status: 500 })
    }

    const total = body.items.reduce((sum: number, item: any) => sum + item.cantidad * item.precio_unitario, 0)

    const updateData: any = {
      total,
      subtotal: total,
      observaciones: body.observaciones || pedido.observaciones,
    }

    if (body.condiciones_temporales) {
      updateData.usar_datos_temporales = true
      updateData.direccion_temp = body.condiciones_temporales.direccion_entrega
      updateData.razon_social_temp = body.condiciones_temporales.razon_social_factura
      updateData.forma_facturacion_temp = body.condiciones_temporales.forma_facturacion
    }

    const { data: updatedPedido, error: updateError } = await supabase
      .from("pedidos")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      console.error("[v0] Error updating pedido:", updateError)
      return NextResponse.json({ error: "Error actualizando pedido" }, { status: 500 })
    }

    console.log("[v0] Pedido updated successfully")

    return NextResponse.json({
      ...updatedPedido,
      message: "Pedido actualizado exitosamente",
    })
  } catch (error) {
    console.error("[v0] Error updating pedido:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
