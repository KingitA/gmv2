import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

/**
 * POST /api/finanzas/rendiciones/[id]/rechazar-pago — la oficina RECHAZA un
 * cobro que un vendedor/chofer declaró en una rendición abierta (no llegó la
 * plata, está mal cargado, era una prueba).
 *
 * Body: { pago_id, motivo }
 *
 * Un pago pendiente nunca tocó el libro ni la caja, así que rechazarlo es
 * limpio: queda 'rechazado' (con motivo y quién), se borran sus imputaciones
 * pendientes, sus cheques (si tenía) pasan a ANULADO, y el ítem de la
 * rendición queda destildado con la observación. Si la rendición se queda sin
 * pagos rendibles, pasa a 'cancelada' (antes quedaba abierta para siempre:
 * el RPC no confirma "ningún pago verificado").
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id: rendicionId } = await params
    const { pago_id, motivo } = await request.json()
    if (!pago_id) return NextResponse.json({ error: "pago_id es requerido" }, { status: 400 })
    if (!motivo || !String(motivo).trim()) {
      return NextResponse.json({ error: "Indicá el motivo del rechazo" }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: rend } = await admin.from("rendiciones").select("id, estado, observaciones").eq("id", rendicionId).maybeSingle()
    if (!rend) return NextResponse.json({ error: "Rendición no encontrada" }, { status: 404 })
    if (rend.estado !== "abierta") {
      return NextResponse.json({ error: `La rendición está ${rend.estado}; solo se rechazan pagos de rendiciones abiertas` }, { status: 422 })
    }
    const { data: item } = await admin
      .from("rendicion_items")
      .select("id")
      .eq("rendicion_id", rendicionId)
      .eq("pago_id", pago_id)
      .maybeSingle()
    if (!item) return NextResponse.json({ error: "Ese pago no es parte de esta rendición" }, { status: 404 })

    const { data: pago } = await admin.from("pagos_clientes").select("id, estado, monto").eq("id", pago_id).maybeSingle()
    if (!pago) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
    if (!["pendiente", "pendiente_rendicion"].includes(pago.estado)) {
      return NextResponse.json(
        { error: `El pago está '${pago.estado}': si ya se confirmó hay que ANULARLO (⊘), no rechazarlo.` },
        { status: 422 },
      )
    }

    const motivoTxt = String(motivo).trim()
    const { error: upErr } = await admin
      .from("pagos_clientes")
      .update({
        estado: "rechazado",
        confirmado_por: auth.user.id,
        fecha_confirmacion: nowArgentina(),
        motivo_rechazo: motivoTxt,
      })
      .eq("id", pago_id)
      .in("estado", ["pendiente", "pendiente_rendicion"])
    if (upErr) throw new Error(upErr.message)

    // Imputaciones pendientes: fuera (nunca afectaron saldos)
    await admin.from("imputaciones").delete().eq("pago_id", pago_id).eq("estado", "pendiente")

    // Cheques cargados con el pago: ANULADO (no entraron a cartera de verdad)
    const { data: dets } = await admin.from("pagos_detalle").select("cheque_id").eq("pago_id", pago_id).not("cheque_id", "is", null)
    const chequeIds = (dets || []).map((d: any) => d.cheque_id).filter(Boolean)
    let chequesAnulados = 0
    if (chequeIds.length) {
      const { data: ch } = await admin
        .from("cheques")
        .update({ estado: "ANULADO" })
        .in("id", chequeIds)
        .eq("estado", "EN_CARTERA")
        .select("id")
      chequesAnulados = ch?.length ?? 0
    }

    // Ítem de la rendición: destildado, con rastro
    await admin
      .from("rendicion_items")
      .update({ verificado: false, observacion: `RECHAZADO: ${motivoTxt}` })
      .eq("id", item.id)

    // ¿Queda algo rendible? Si no, la rendición se cancela.
    const { data: restantes } = await admin
      .from("rendicion_items")
      .select("pago_id, pagos_clientes:pago_id(estado)")
      .eq("rendicion_id", rendicionId)
    const rendibles = (restantes || []).filter((r: any) =>
      ["pendiente", "pendiente_rendicion"].includes(r.pagos_clientes?.estado),
    ).length
    let rendicionCancelada = false
    if (rendibles === 0) {
      await admin
        .from("rendiciones")
        .update({
          estado: "cancelada",
          confirmado_por: auth.user.id,
          confirmado_at: nowArgentina(),
          observaciones: [rend.observaciones, `Cancelada: todos sus pagos fueron rechazados (${motivoTxt})`].filter(Boolean).join(" · "),
        })
        .eq("id", rendicionId)
      rendicionCancelada = true
    }

    return NextResponse.json({
      success: true,
      pago_id,
      monto: Number(pago.monto),
      cheques_anulados: chequesAnulados,
      rendicion_cancelada: rendicionCancelada,
      pagos_rendibles_restantes: rendibles,
      mensaje: rendicionCancelada
        ? "Pago rechazado. La rendición quedó sin pagos y se canceló."
        : `Pago rechazado. Quedan ${rendibles} pago(s) por confirmar en la rendición.`,
    })
  } catch (error: any) {
    console.error("[rendiciones/rechazar-pago] error:", error)
    return NextResponse.json({ error: error.message || "Error rechazando el pago" }, { status: 500 })
  }
}
