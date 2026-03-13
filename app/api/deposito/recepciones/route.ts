import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET: Órdenes de compra pendientes de recibir
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: ordenes, error } = await supabase
      .from("ordenes_compra")
      .select(`
        id,
        numero_orden,
        estado,
        fecha_orden,
        observaciones,
        proveedores(id, nombre),
        ordenes_compra_detalle(
          id,
          cantidad_pedida,
          articulo_id,
          precio_unitario,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto)
        )
      `)
      .in("estado", ["pendiente", "recibida_parcial"])
      .order("fecha_orden", { ascending: true })

    if (error) throw error

    // Enrich with recepcion progress
    const ordenesConProgreso = await Promise.all(
      (ordenes || []).map(async (orden) => {
        const { data: recepcion } = await supabase
          .from("recepciones")
          .select(`
            id, estado, fecha_inicio,
            recepciones_items(id, articulo_id, cantidad_oc, cantidad_fisica, estado_linea),
            recepciones_documentos(id, tipo_documento, url_imagen, procesado)
          `)
          .eq("orden_compra_id", orden.id)
          .neq("estado", "cancelada")
          .single()

        return { ...orden, recepcion: recepcion || null }
      })
    )

    return NextResponse.json(ordenesConProgreso)
  } catch (error: any) {
    console.error("[deposito] Error GET recepciones:", error)
    return NextResponse.json({ error: "Error al obtener órdenes" }, { status: 500 })
  }
}

// POST: Crear o retomar recepción de mercadería
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { orden_compra_id } = await request.json()

    const { data: { user } } = await supabase.auth.getUser()

    // Buscar recepción activa
    let { data: recepcion } = await supabase
      .from("recepciones")
      .select(`*, recepciones_items(*), recepciones_documentos(*)`)
      .eq("orden_compra_id", orden_compra_id)
      .not("estado", "eq", "cancelada")
      .single()

    if (!recepcion) {
      // Obtener detalle de la OC
      const { data: detalles } = await supabase
        .from("ordenes_compra_detalle")
        .select("articulo_id, cantidad_pedida")
        .eq("orden_compra_id", orden_compra_id)

      // Crear recepción
      const { data: nueva, error } = await supabase
        .from("recepciones")
        .insert({
          orden_compra_id,
          estado: "en_proceso",
          usuario_id: user?.id,
        })
        .select()
        .single()

      if (error) throw error

      // Crear items de recepción
      if (detalles && detalles.length > 0) {
        await supabase.from("recepciones_items").insert(
          detalles.map((d: any) => ({
            recepcion_id: nueva.id,
            articulo_id: d.articulo_id,
            cantidad_oc: d.cantidad_pedida,
            cantidad_fisica: 0,
            estado_linea: "pendiente",
          }))
        )
      }

      // Update OC estado
      await supabase
        .from("ordenes_compra")
        .update({ estado: "recibida_parcial" })
        .eq("id", orden_compra_id)

      const { data: full } = await supabase
        .from("recepciones")
        .select(`*, recepciones_items(*), recepciones_documentos(*)`)
        .eq("id", nueva.id)
        .single()
      recepcion = full
    }

    return NextResponse.json(recepcion)
  } catch (error: any) {
    console.error("[deposito] Error POST recepcion:", error)
    return NextResponse.json({ error: "Error al crear recepción" }, { status: 500 })
  }
}

// PATCH: Actualizar item de recepción + ajustar stock
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { recepcion_id, articulo_id, cantidad_fisica, finalizar } = await request.json()

    if (finalizar) {
      // Finalizar recepción: actualizar stock y cerrar
      const { data: items } = await supabase
        .from("recepciones_items")
        .select("articulo_id, cantidad_fisica")
        .eq("recepcion_id", recepcion_id)

      // Update stock for each item
      for (const item of items || []) {
        if (item.cantidad_fisica > 0) {
          const { data: art } = await supabase
            .from("articulos")
            .select("stock_actual")
            .eq("id", item.articulo_id)
            .single()

          const nuevoStock = (art?.stock_actual || 0) + item.cantidad_fisica

          await supabase
            .from("articulos")
            .update({ stock_actual: nuevoStock })
            .eq("id", item.articulo_id)

          // Movimiento de stock
          await supabase.from("movimientos_stock").insert({
            articulo_id: item.articulo_id,
            tipo_movimiento: "entrada",
            cantidad: item.cantidad_fisica,
            observaciones: `Recepción depósito #${recepcion_id}`,
          })
        }
      }

      // Cerrar recepción
      await supabase
        .from("recepciones")
        .update({ estado: "finalizada", fecha_fin: new Date().toISOString() })
        .eq("id", recepcion_id)

      // Update OC
      const { data: rec } = await supabase
        .from("recepciones")
        .select("orden_compra_id")
        .eq("id", recepcion_id)
        .single()

      if (rec?.orden_compra_id) {
        await supabase
          .from("ordenes_compra")
          .update({ estado: "recibida_completa" })
          .eq("id", rec.orden_compra_id)
      }

      return NextResponse.json({ ok: true })
    }

    // Update single item
    const estadoLinea = cantidad_fisica > 0 ? "ok" : "pendiente"
    const { data: item, error } = await supabase
      .from("recepciones_items")
      .update({ cantidad_fisica, estado_linea: estadoLinea })
      .eq("recepcion_id", recepcion_id)
      .eq("articulo_id", articulo_id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(item)
  } catch (error: any) {
    console.error("[deposito] Error PATCH recepcion:", error)
    return NextResponse.json({ error: "Error al actualizar recepción" }, { status: 500 })
  }
}
