import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || "pendiente"

    const { data: devoluciones, error } = await supabase
      .from("devoluciones")
      .select(
        `
        *,
        clientes(nombre, razon_social)
      `
      )
      .eq("estado", estado)
      .order("created_at", { ascending: false })

    if (error) throw error

    // Obtener detalle de cada devolución y el vendedor por separado
    const devolucionesConDetalle = await Promise.all(
      (devoluciones || []).map(async (dev) => {
        // Obtener items
        const { data: items } = await supabase
          .from("devoluciones_detalle")
          .select(
            `
            *,
            articulos(nombre, sku)
          `
          )
          .eq("devolucion_id", dev.id)

        // Obtener vendedor por separado
        let vendedor = null
        if (dev.vendedor_id) {
          const { data: vendedorData } = await supabase
            .from("usuarios")
            .select("nombre, email")
            .eq("id", dev.vendedor_id)
            .single()
          vendedor = vendedorData
        }

        return {
          ...dev,
          items: items || [],
          vendedor,
        }
      })
    )

    return NextResponse.json(devolucionesConDetalle)
  } catch (error: any) {
    console.error("[v0] Error obteniendo devoluciones:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo devoluciones" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()

    const {
      cliente_id,
      vendedor_id,
      pedido_id,
      viaje_id,
      retira_viajante,
      observaciones,
      items, // [{ articulo_id, cantidad, precio_venta_original, motivo, es_vendible, fecha_venta_original?, comprobante_venta_id? }]
    } = body

    // Validaciones
    if (!cliente_id || !items || items.length === 0) {
      return NextResponse.json({ error: "cliente_id e items son requeridos" }, { status: 400 })
    }

    // Calcular monto total
    const montoTotal = items.reduce((sum: number, item: any) => sum + item.cantidad * item.precio_venta_original, 0)

    // Generar número de devolución
    const { count } = await supabase
      .from("devoluciones")
      .select("*", { count: "exact", head: true })

    const numeroDevolucion = `DEV-${String((count || 0) + 1).padStart(5, "0")}`

    // Crear devolución en estado pendiente
    const { data: devolucion, error: devolucionError } = await supabase
      .from("devoluciones")
      .insert({
        numero_devolucion: numeroDevolucion,
        cliente_id,
        vendedor_id,
        pedido_id,
        viaje_id,
        retira_viajante: retira_viajante || false,
        observaciones,
        estado: "pendiente",
        monto_total: montoTotal,
      })
      .select()
      .single()

    if (devolucionError) throw devolucionError

    // Crear items de devolución
    const itemsConDevolucionId = items.map((item: any) => ({
      devolucion_id: devolucion.id,
      articulo_id: item.articulo_id,
      cantidad: item.cantidad,
      precio_venta_original: item.precio_venta_original,
      motivo: item.motivo || "",
      es_vendible: item.es_vendible !== undefined ? item.es_vendible : true,
      fecha_venta_original: item.fecha_venta_original,
      comprobante_venta_id: item.comprobante_venta_id,
      // subtotal es generado automáticamente en la DB
    }))

    const { error: itemsError } = await supabase.from("devoluciones_detalle").insert(itemsConDevolucionId)

    if (itemsError) throw itemsError

    return NextResponse.json({
      success: true,
      devolucion,
      numero_devolucion: numeroDevolucion,
      mensaje: "Devolución registrada. Pendiente de aprobación desde ERP.",
      monto_total: montoTotal,
    })
  } catch (error: any) {
    console.error("[v0] Error registrando devolución:", error)
    return NextResponse.json({ error: error.message || "Error registrando devolución" }, { status: 500 })
  }
}

