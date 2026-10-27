import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { redondear } from "@/lib/formato"
import { CODIGO_TOPE_DEVOLUCION, esErrorTopeDevolucion, excedeTopeDevolucion, mensajeErrorTopeDevolucion } from "@/lib/cobranzas/tope-devolucion"

// PUT /api/devoluciones/[id] — editar cantidades / quitar renglones ANTES de la NC.
// Solo en estado "pendiente" (todavía no se controló en depósito ni se devolvió stock).
// Body: { items: [{ id, cantidad }], eliminar: [detalleId] }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("revisar_devoluciones")
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

    // R8 (#25): la revisión tampoco puede devolver más de lo vendido. Se controla
    // con las cantidades FINALES de esta devolución (sin contarla a ella misma);
    // la base vuelve a controlar al grabar, con candado (20261027_devoluciones_tope.sql).
    const { data: actuales } = await supabase
      .from("devoluciones_detalle").select("id, articulo_id, cantidad, comprobante_venta_id").eq("devolucion_id", id)
    const quitar = new Set<string>((eliminar ?? []).map(String))
    const nueva = new Map<string, number>()
    for (const it of (items ?? [])) {
      const cant = Number(it.cantidad)
      if (it.id && Number.isFinite(cant) && cant > 0) nueva.set(String(it.id), cant)
    }
    const finales = (actuales || [])
      .filter((d: any) => !quitar.has(d.id))
      .map((d: any) => ({ articulo_id: d.articulo_id, comprobante_venta_id: d.comprobante_venta_id, cantidad: nueva.get(d.id) ?? Number(d.cantidad) }))
    const tope = await excedeTopeDevolucion(supabase, finales, { excluirDevolucionId: id })
    if (tope) return NextResponse.json({ error: tope, codigo: CODIGO_TOPE_DEVOLUCION }, { status: 409 })

    for (const detId of (eliminar ?? [])) {
      const { error } = await supabase.from("devoluciones_detalle").delete().eq("id", detId).eq("devolucion_id", id)
      if (error) throw error
    }
    for (const it of (items ?? [])) {
      const cant = Number(it.cantidad)
      if (!it.id || !Number.isFinite(cant) || cant <= 0) continue
      const { data: det } = await supabase
        .from("devoluciones_detalle").select("id, cantidad, cantidad_original, precio_venta_original").eq("id", it.id).eq("devolucion_id", id).single()
      if (!det) continue
      const subtotal = redondear(cant * Number(det.precio_venta_original || 0))
      // La cantidad que cargó el vendedor/chofer queda para la auditoría
      const original = det.cantidad_original ?? det.cantidad
      const { error } = await supabase.from("devoluciones_detalle")
        .update({ cantidad: cant, subtotal, cantidad_original: original }).eq("id", it.id)
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
    if (esErrorTopeDevolucion(error)) {
      return NextResponse.json({ error: mensajeErrorTopeDevolucion(error), codigo: CODIGO_TOPE_DEVOLUCION }, { status: 409 })
    }
    console.error("[devoluciones PUT] error:", error)
    return NextResponse.json({ error: error.message || "Error editando devolución" }, { status: 500 })
  }
}

// DELETE /api/devoluciones/[id] — eliminar una devolución sin NC emitida.
// Pendiente: borra directo. Confirmada (depósito ya devolvió stock de los
// vendibles): primero revierte ese stock para no dejarlo inflado.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("revisar_devoluciones")
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
