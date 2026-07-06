import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

/**
 * POST /api/viajante/devolucion — devolución registrada en la calle (Fase E).
 * Contrato: docs/CONTRATO-API-VIAJANTES.md §6. Queda `pendiente` hasta la
 * confirmación física de depósito; la NC se genera desde revisión y se
 * imputa automáticamente contra la FA de origen (Fase A3).
 */
export async function POST(request: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { cliente_id, pedido_id, items, observaciones } = body

    if (!cliente_id || !Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: "cliente_id e items son requeridos" }, { status: 400 })
    }

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, vendedor_id")
      .eq("id", cliente_id)
      .single()
    if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    const vendedorId = session.vendedorIds.includes(cliente.vendedor_id)
      ? cliente.vendedor_id
      : session.vendedorIds[0]

    const montoTotal = items.reduce(
      (s: number, i: any) => s + Number(i.precio_venta_original || 0) * Number(i.cantidad || 0),
      0
    )

    const { count } = await supabase
      .from("devoluciones")
      .select("*", { count: "exact", head: true })
    const numeroDevolucion = `DEV-${String((count || 0) + 1).padStart(5, "0")}`

    const { data: devolucion, error: devErr } = await supabase
      .from("devoluciones")
      .insert({
        numero_devolucion: numeroDevolucion,
        cliente_id,
        vendedor_id: vendedorId,
        creado_por: session.user.id,
        pedido_id: pedido_id || null,
        viaje_id: null,
        retira_viajante: true,
        observaciones: observaciones || "Devolución registrada por viajante",
        estado: "pendiente",
        monto_total: montoTotal,
      })
      .select("id")
      .single()
    if (devErr) throw devErr

    const { error: itemsErr } = await supabase.from("devoluciones_detalle").insert(
      items.map((i: any) => ({
        devolucion_id: devolucion.id,
        articulo_id: i.articulo_id,
        cantidad: Number(i.cantidad),
        precio_venta_original: Number(i.precio_venta_original || 0),
        motivo: i.motivo || "Devolución en la calle",
        condicion: i.condicion || "vendible",
        es_vendible: i.condicion ? i.condicion === "vendible" : true,
        comprobante_venta_id: i.comprobante_venta_id || null,
      }))
    )
    if (itemsErr) throw itemsErr

    return NextResponse.json(
      {
        success: true,
        devolucion_id: devolucion.id,
        numero_devolucion: numeroDevolucion,
        monto_total: montoTotal,
        estado: "pendiente",
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[viajante/devolucion] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
