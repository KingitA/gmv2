import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// PUT /api/devoluciones/[id] — editar cantidades / quitar renglones ANTES de la NC.
// Solo en estado "pendiente" (todavía no se controló en depósito ni se devolvió stock).
// Body: { items: [{ id, cantidad }], eliminar: [detalleId] }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params
    const { items, eliminar } = await request.json()

    const { data: dev, error: devErr } = await supabase
      .from("devoluciones").select("id, estado").eq("id", id).single()
    if (devErr || !dev) return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 })
    if (dev.estado !== "pendiente") {
      return NextResponse.json(
        { error: "Solo se puede editar una devolución pendiente (antes del control de depósito)." },
        { status: 400 }
      )
    }

    for (const detId of (eliminar ?? [])) {
      const { error } = await supabase.from("devoluciones_detalle").delete().eq("id", detId).eq("devolucion_id", id)
      if (error) throw error
    }
    for (const it of (items ?? [])) {
      const cant = Number(it.cantidad)
      if (!it.id || !Number.isFinite(cant) || cant <= 0) continue
      const { data: det } = await supabase
        .from("devoluciones_detalle").select("id, precio_venta_original").eq("id", it.id).eq("devolucion_id", id).single()
      if (!det) continue
      const subtotal = Math.round(cant * Number(det.precio_venta_original || 0) * 100) / 100
      const { error } = await supabase.from("devoluciones_detalle")
        .update({ cantidad: cant, subtotal }).eq("id", it.id)
      if (error) throw error
    }

    // Recalcular el total; si no quedan renglones, la devolución se elimina
    const { data: restantes } = await supabase
      .from("devoluciones_detalle").select("cantidad, precio_venta_original").eq("devolucion_id", id)
    if (!restantes || restantes.length === 0) {
      await supabase.from("devoluciones").delete().eq("id", id)
      return NextResponse.json({ success: true, eliminada: true })
    }
    const total = Math.round(restantes.reduce((s, r: any) => s + Number(r.cantidad) * Number(r.precio_venta_original || 0), 0) * 100) / 100
    const { error: upErr } = await supabase.from("devoluciones").update({ monto_total: total }).eq("id", id)
    if (upErr) throw upErr

    return NextResponse.json({ success: true, monto_total: total })
  } catch (error: any) {
    console.error("[devoluciones PUT] error:", error)
    return NextResponse.json({ error: error.message || "Error editando devolución" }, { status: 500 })
  }
}

// DELETE /api/devoluciones/[id] — eliminar una devolución sin NC emitida.
// Pendiente: borra directo. Confirmada (depósito ya devolvió stock de los
// vendibles): primero revierte ese stock para no dejarlo inflado.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: dev, error: devErr } = await supabase
      .from("devoluciones").select("id, estado, numero_devolucion").eq("id", id).single()
    if (devErr || !dev) return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 })
    if (!["pendiente", "confirmado"].includes(dev.estado)) {
      return NextResponse.json(
        { error: `No se puede eliminar una devolución ${dev.estado} (ya tiene documento o resolución).` },
        { status: 400 }
      )
    }

    if (dev.estado === "confirmado") {
      // Depósito ya sumó stock de los vendibles al confirmar: se revierte
      const { data: items } = await supabase
        .from("devoluciones_detalle").select("articulo_id, cantidad, es_vendible").eq("devolucion_id", id)
      for (const item of (items ?? [])) {
        if (item.es_vendible === false) continue
        const { error } = await supabase.rpc("incrementar_stock", {
          p_articulo_id: item.articulo_id,
          p_cantidad: -Number(item.cantidad),
        })
        if (error) console.error("[devoluciones DELETE] revirtiendo stock:", error)
      }
    }

    const { error: delDet } = await supabase.from("devoluciones_detalle").delete().eq("devolucion_id", id)
    if (delDet) throw delDet
    const { error: delDev } = await supabase.from("devoluciones").delete().eq("id", id)
    if (delDev) throw delDev

    return NextResponse.json({ success: true, numero_devolucion: dev.numero_devolucion })
  } catch (error: any) {
    console.error("[devoluciones DELETE] error:", error)
    return NextResponse.json({ error: error.message || "Error eliminando devolución" }, { status: 500 })
  }
}
