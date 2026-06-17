import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"

// POST /api/cheques/[id]/rechazar
// Marca el cheque como RECHAZADO y genera una ND automática al cliente
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id: chequeId } = await params
    const body = await request.json()
    const { motivo_rechazo, observaciones } = body

    // Cargar datos del cheque
    const { data: cheque, error: chequeErr } = await supabase
      .from("cheques")
      .select("*")
      .eq("id", chequeId)
      .single()

    if (chequeErr || !cheque) {
      return NextResponse.json({ error: "Cheque no encontrado" }, { status: 404 })
    }

    if (cheque.estado === "RECHAZADO") {
      return NextResponse.json({ error: "El cheque ya fue rechazado" }, { status: 400 })
    }

    if (!cheque.cliente_origen_id) {
      return NextResponse.json(
        { error: "El cheque no tiene cliente origen para generar el débito" },
        { status: 400 }
      )
    }

    // ── 1. Marcar cheque como RECHAZADO ──
    const { error: updateErr } = await supabase
      .from("cheques")
      .update({
        estado: "RECHAZADO",
        fecha_rechazo: todayArgentina(),
        motivo_rechazo: motivo_rechazo || "Cheque rechazado",
      })
      .eq("id", chequeId)

    if (updateErr) throw updateErr

    // ── 2. Generar Nota de Débito (ND) para el cliente ──
    // Obtener numeración ND (usamos NDC como genérico — ajustable según condición IVA)
    const { data: numRow } = await admin
      .from("numeracion_comprobantes")
      .select("ultimo_numero")
      .eq("tipo_comprobante", "NDC")
      .eq("punto_venta", "0001")
      .single()

    let numeroND = "0001-00000001"
    if (numRow) {
      const siguiente = Number(numRow.ultimo_numero) + 1
      numeroND = `0001-${String(siguiente).padStart(8, "0")}`
      await admin
        .from("numeracion_comprobantes")
        .update({ ultimo_numero: siguiente })
        .eq("tipo_comprobante", "NDC")
        .eq("punto_venta", "0001")
    }

    const { data: nd, error: ndErr } = await admin
      .from("comprobantes_venta")
      .insert({
        cliente_id: cheque.cliente_origen_id,
        tipo_comprobante: "NDC",
        numero_comprobante: numeroND,
        fecha: todayArgentina(),
        total_neto: Number(cheque.monto),
        total_iva: 0,
        total_factura: Number(cheque.monto),
        saldo_pendiente: Number(cheque.monto),
        estado_pago: "pendiente",
        observaciones: `Débito por cheque rechazado Nro. ${cheque.numero || chequeId.slice(0, 8)} — ${motivo_rechazo || "Cheque rechazado"}${observaciones ? ". " + observaciones : ""}`,
        creado_por: auth.user.id,
      })
      .select()
      .single()

    if (ndErr) {
      console.error("[cheques/rechazar] Error creando ND:", ndErr)
    }

    // ── 2b. Libro mayor: la ND por cheque rechazado incrementa la deuda (debe) ──
    if (nd) {
      const { error: ccErr } = await supabase.rpc("cc_postear", {
        p_cliente_id:      cheque.cliente_origen_id,
        p_tipo_movimiento: "nota_debito",
        p_debe:            Number(cheque.monto),
        p_haber:           0,
        p_referencia_tipo: "comprobante_venta",
        p_referencia_id:   nd.id,
        p_numero_comprobante: numeroND,
        p_observaciones:   `Débito por cheque rechazado Nro. ${cheque.numero || chequeId.slice(0, 8)}`,
        p_usuario_id:      auth.user.id,
      })
      if (ccErr) console.error("[cc_postear] ND cheque rechazado", nd.id, ccErr.message)
    }

    // ── 3. Registrar en kardex_contable ──
    await supabase.from("kardex_contable").insert({
      tipo_movimiento: "DEBITO_CHEQUE_RECHAZADO",
      concepto: `Cheque rechazado Nro. ${cheque.numero || chequeId.slice(0, 8)} — ND ${numeroND}`,
      monto: Number(cheque.monto),
      color: cheque.color || null,
      origen_tipo: "EN_CARTERA",
      origen_id: chequeId,
      destino_tipo: "CLIENTE",
      destino_id: cheque.cliente_origen_id,
      metodo: "CHEQUE_TERCERO",
      referencia_tipo: "cheque",
      referencia_id: chequeId,
      cheque_id: chequeId,
      cliente_id: cheque.cliente_origen_id,
      cobrador_id: auth.user.id,
    })

    return NextResponse.json({
      success: true,
      cheque_id: chequeId,
      nd: nd || null,
      numero_nd: nd?.numero_comprobante || null,
      mensaje: `Cheque rechazado. Se generó ND ${nd?.numero_comprobante || ""} por $${Number(cheque.monto).toLocaleString("es-AR")} al cliente.`,
    })
  } catch (error: any) {
    console.error("[cheques/rechazar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
