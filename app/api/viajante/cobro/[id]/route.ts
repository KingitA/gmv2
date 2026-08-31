import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { anularCobranza } from "@/lib/actions/cobranzas"

/**
 * DELETE /api/viajante/cobro/[id]
 *
 * El viajante corrige (elimina) un cobro propio SOLO mientras la plata sigue
 * en su poder: estado 'pendiente_rendicion' y sin haber sido declarado en
 * ninguna rendición viva. Una vez que rindió a oficina, no se toca — lo
 * resuelve la oficina rechazando el pago desde el control de rendición
 * (regla del dueño: si ya lo declaró, cualquier cambio pasa por oficina).
 *
 * La reversa completa (billetera, cheques, imputaciones, libro) la hace el
 * RPC cobranza_anular; acá se limpian además los vínculos que el RPC no toca:
 * anticipos de pedidos y fotos del comprobante.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireVendedor()
  if (session.error) return session.error
  try {
    const supabase = await createClient()
    const { id: pagoId } = await params

    const { data: pago } = await supabase
      .from("pagos_clientes")
      .select("id, estado, cobrador_tipo, vendedor_id, creado_por")
      .eq("id", pagoId)
      .single()
    if (!pago) {
      return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 })
    }
    const esPropio =
      pago.cobrador_tipo === "viajante" &&
      (session.vendedorIds.includes(pago.vendedor_id) || pago.creado_por === session.user.id)
    if (!esPropio) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    if (pago.estado !== "pendiente_rendicion") {
      return NextResponse.json(
        { error: `El cobro ya fue ${pago.estado === "confirmado" ? "confirmado por oficina" : pago.estado} — no se puede eliminar` },
        { status: 409 }
      )
    }

    // Más estricto que el chofer: declarado en CUALQUIER rendición no
    // cancelada (aunque siga abierta) ya viajó a oficina — no se toca.
    const { data: enRendicion } = await supabase
      .from("rendicion_items")
      .select("rendicion_id, rendiciones!inner(estado)")
      .eq("pago_id", pagoId)
      .neq("rendiciones.estado", "cancelada")
      .limit(1)
    if (enRendicion?.length) {
      return NextResponse.json(
        { error: "Ya declaraste este cobro en una rendición — no se puede tocar. Pedile a oficina que lo rechace." },
        { status: 409 }
      )
    }

    // Vínculos que el RPC no limpia: anticipos de pedidos y fotos
    await supabase
      .from("pedidos")
      .update({ anticipo_pago_id: null, pago_contado_10: false })
      .eq("anticipo_pago_id", pagoId)
    await supabase.from("pago_comprobantes").delete().eq("pago_id", pagoId)

    await anularCobranza(supabase, {
      pagoId,
      usuarioId: session.user.id,
      motivo: "Corrección del vendedor antes de rendir",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[viajante/cobro] DELETE error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
