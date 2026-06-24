import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

/**
 * Recalcula EN VIVO las cantidades de los artículos bonificados de un pedido
 * según lo realmente preparado: monto = % mercadería × neto preparado (sin
 * bonificados), repartido parejo entre los artículos elegidos. Devuelve el
 * resumen [{ id, cantidad }] para que la UI lo refleje.
 */
async function recalcularBonificados(supabase: any, pedido_id: string) {
  const [{ data: pedido }, { data: dets }] = await Promise.all([
    supabase.from("pedidos").select("bonif_mercaderia_pct").eq("id", pedido_id).single(),
    supabase.from("pedidos_detalle")
      .select("id, cantidad, cantidad_preparada, precio_final, es_bonificado")
      .eq("pedido_id", pedido_id),
  ])
  const bonificados = (dets || []).filter((d: any) => d.es_bonificado)
  if (bonificados.length === 0) return []
  const pct = Number(pedido?.bonif_mercaderia_pct ?? 0)
  // Sin % no se recalcula: deja las cantidades como las cargó el usuario manualmente.
  if (pct <= 0) return bonificados.map((b: any) => ({ id: b.id, cantidad: Number(b.cantidad || 0) }))
  const netoPreparado = (dets || [])
    .filter((d: any) => !d.es_bonificado)
    .reduce((s: number, d: any) => s + Number(d.precio_final || 0) * Number(d.cantidad_preparada || 0), 0)
  const monto = netoPreparado * pct / 100
  const share = bonificados.length > 0 ? monto / bonificados.length : 0
  const out: Array<{ id: string; cantidad: number }> = []
  for (const b of bonificados) {
    const precio = Number(b.precio_final || 0)
    const units = precio > 0 ? Math.round(share / precio) : 0
    if (units !== Number(b.cantidad) || units !== Number(b.cantidad_preparada)) {
      await supabase.from("pedidos_detalle")
        .update({ cantidad: units, cantidad_preparada: units, estado_item: "COMPLETO" })
        .eq("id", b.id)
    }
    out.push({ id: b.id, cantidad: units })
  }
  return out
}

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

    // Recalcular en vivo las cantidades bonificadas según lo realmente preparado
    let bonificados_actualizados: Array<{ id: string; cantidad: number }> = []
    if (data?.pedido_id && !data?.es_bonificado) {
      bonificados_actualizados = await recalcularBonificados(supabase, data.pedido_id)
    }

    return NextResponse.json({ ...data, bonificados_actualizados })

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
      .update({ estado: "TERMINADO", fin_at: nowArgentina() })
      .eq("pedido_id", pedido_id)
      .eq("estado", "EN_PROGRESO")

    return NextResponse.json({ ok: true })

  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}
