import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id: pagoId } = await params
    const body = await request.json().catch(() => ({}))
    const motivo: string = body.motivo || ""

    // ── 1. Cargar pago ──
    const { data: pago, error: pagoErr } = await supabase
      .from("pagos_clientes")
      .select("*")
      .eq("id", pagoId)
      .single()

    if (pagoErr || !pago) {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
    }
    if (pago.estado === "anulado") {
      return NextResponse.json({ error: "El pago ya está anulado" }, { status: 400 })
    }

    // ── 2. Cargar imputaciones con datos del comprobante ──
    const { data: imputaciones } = await supabase
      .from("imputaciones")
      .select("id, monto_imputado, comprobante_id, comprobante:comprobantes_venta(id, tipo_comprobante, observaciones, saldo_pendiente, total_factura)")
      .eq("pago_id", pagoId)

    // ── 3. Revertir impacto en cada comprobante ──
    for (const imp of imputaciones || []) {
      const comp = imp.comprobante as any
      if (!comp) continue

      const tipo: string = comp.tipo_comprobante || ""
      const obs: string = comp.observaciones || ""

      // NC/REV auto-generados por bonificación contado: marcar como anulados
      const esAutogenerado =
        ["REV", "NCA", "NCB", "NCC"].includes(tipo) &&
        obs.toLowerCase().includes("bonificaci")

      if (esAutogenerado) {
        await supabase
          .from("comprobantes_venta")
          .update({ estado_pago: "anulado", saldo_pendiente: 0 })
          .eq("id", comp.id)
      } else {
        // Comprobante normal (FA/FB/FC/PRES): devolver saldo
        const totalFact = Math.abs(Number(comp.total_factura) || 0)
        const saldoActual = Number(comp.saldo_pendiente) || 0
        const montoADevolver = Math.abs(Number(imp.monto_imputado) || 0)
        const nuevoSaldo = Math.min(totalFact, saldoActual + montoADevolver)
        const nuevoEstado =
          nuevoSaldo <= 0 ? "pagado" :
          nuevoSaldo >= totalFact ? "pendiente" :
          "parcial"
        await supabase
          .from("comprobantes_venta")
          .update({ saldo_pendiente: nuevoSaldo, estado_pago: nuevoEstado })
          .eq("id", comp.id)
      }
    }

    // ── 4. Marcar imputaciones como anuladas ──
    if ((imputaciones || []).length > 0) {
      await supabase
        .from("imputaciones")
        .update({ estado: "anulado" })
        .eq("pago_id", pagoId)
    }

    // ── 5. Cheques EN_CARTERA → anular (intento, sin bloquear flujo) ──
    try {
      const { data: detalles } = await supabase
        .from("pagos_detalle")
        .select("id, cheque_id")
        .eq("pago_id", pagoId)

      const chequeIds = (detalles || []).map((d: any) => d.cheque_id).filter(Boolean)

      // Cheques de ítems de depósito
      const detalleIds = (detalles || []).map((d: any) => d.id)
      if (detalleIds.length) {
        const { data: ditems } = await supabase
          .from("pago_deposito_items")
          .select("cheque_id")
          .in("pago_detalle_id", detalleIds)
        chequeIds.push(...(ditems || []).map((it: any) => it.cheque_id).filter(Boolean))
      }

      if (chequeIds.length) {
        await admin.from("cheques").update({ estado: "ANULADO" }).in("id", [...new Set(chequeIds)]).eq("estado", "EN_CARTERA")
      }
    } catch { /* continuar aunque no se puedan anular cheques */ }

    // ── 6. Marcar pago como anulado (soft delete) ──
    const { error: updateErr } = await supabase
      .from("pagos_clientes")
      .update({
        estado: "anulado",
        anulado_por: auth.user.id,
        anulado_at: new Date().toISOString(),
        motivo_anulacion: motivo || null,
      })
      .eq("id", pagoId)

    if (updateErr) {
      // Si las columnas de auditoría no existen aún (migración no ejecutada), fallar solo en eso
      if (updateErr.message?.includes("anulado_por") || updateErr.message?.includes("anulado_at")) {
        // Intentar solo con estado
        await supabase.from("pagos_clientes").update({ estado: "anulado" }).eq("id", pagoId)
      } else {
        throw updateErr
      }
    }

    // ── 7. Registrar en kardex_contable (tabla puede no existir) ──
    try {
      await supabase.from("kardex_contable").insert({
        tipo_movimiento: "ANULACION_COBRO",
        concepto: `Anulación recibo — pago ${pagoId.slice(0, 8)}${motivo ? ` — ${motivo}` : ""}`,
        monto: -Math.abs(Number(pago.monto)),
        origen_tipo: "CLIENTE",
        origen_id: pago.cliente_id,
        referencia_tipo: "pago_cliente",
        referencia_id: pagoId,
        pago_id: pagoId,
        cliente_id: pago.cliente_id,
        cobrador_id: auth.user.id,
      })
    } catch { /* tabla puede no existir todavía */ }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[pagos-clientes/anular] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
