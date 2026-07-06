import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/mostrador/devolucion — devolución en mostrador (Fase D).
 *
 * El cliente trae mercadería al mostrador. Se registra la devolución
 * `pendiente` con origen mostrador (retira_viajante=false, sin viaje):
 * depósito la confirma físicamente (repone stock) y desde
 * /revision-devoluciones se genera la NC, que se imputa automáticamente
 * contra la FA de origen (Fase A3).
 *
 * Body: {
 *   cliente_id, pedido_id?,
 *   items: [{ articulo_id, cantidad, precio_venta_original, comprobante_venta_id?, motivo?, condicion? }],
 *   observaciones?
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { cliente_id, pedido_id, items, observaciones } = body

    if (!cliente_id || !items?.length) {
      return NextResponse.json({ error: "cliente_id e items son requeridos" }, { status: 400 })
    }

    const montoTotal = (items as any[]).reduce(
      (s, i) => s + Number(i.precio_venta_original || 0) * Number(i.cantidad || 0),
      0
    )

    const { count } = await supabase
      .from("devoluciones")
      .select("*", { count: "exact", head: true })
    const numeroDevolucion = `DEV-${String((count || 0) + 1).padStart(5, "0")}`

    const { data: devolucion, error: devError } = await supabase
      .from("devoluciones")
      .insert({
        numero_devolucion: numeroDevolucion,
        cliente_id,
        vendedor_id: null,
        creado_por: auth.user.id,
        pedido_id: pedido_id || null,
        viaje_id: null,
        retira_viajante: false,
        observaciones: observaciones ? `Mostrador — ${observaciones}` : "Devolución en mostrador",
        estado: "pendiente",
        monto_total: montoTotal,
      })
      .select("id")
      .single()
    if (devError) throw devError

    const itemsInsert = (items as any[]).map((item) => ({
      devolucion_id: devolucion.id,
      articulo_id: item.articulo_id,
      cantidad: Number(item.cantidad),
      precio_venta_original: Number(item.precio_venta_original || 0),
      motivo: item.motivo || "Devolución en mostrador",
      condicion: item.condicion || "vendible",
      es_vendible: item.condicion ? item.condicion === "vendible" : true,
      comprobante_venta_id: item.comprobante_venta_id || null,
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
      mensaje: `Devolución ${numeroDevolucion} registrada. Depósito la confirma y luego se genera la NC desde Revisión de Devoluciones.`,
    })
  } catch (error: any) {
    console.error("[mostrador/devolucion] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
