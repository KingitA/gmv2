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

    const errores: string[] = []

    // ── 1. Verificar que el pago existe ──
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

    // ── 2. Cargar imputaciones SIN join (evita dependencia de FK) ──
    const { data: imputaciones, error: impErr } = await supabase
      .from("imputaciones")
      .select("id, monto_imputado, comprobante_id")
      .eq("pago_id", pagoId)

    if (impErr) errores.push(`imputaciones load: ${impErr.message}`)

    // ── 3. Para cada imputación: restaurar saldo del comprobante ──
    for (const imp of imputaciones || []) {
      if (!imp.comprobante_id) continue

      // Cargar comprobante directamente por ID
      const { data: comp, error: compErr } = await supabase
        .from("comprobantes_venta")
        .select("id, tipo_comprobante, observaciones, saldo_pendiente, total_factura")
        .eq("id", imp.comprobante_id)
        .single()

      if (compErr || !comp) {
        errores.push(`comprobante ${imp.comprobante_id}: ${compErr?.message || "no encontrado"}`)
        continue
      }

      const tipo: string = comp.tipo_comprobante || ""
      const obs: string = (comp.observaciones || "").toLowerCase()

      // NC/REV auto-generados por bonificación → marcar anulados (ya no representan crédito)
      const esAutogenerado =
        ["REV", "NCA", "NCB", "NCC"].includes(tipo) && obs.includes("bonificaci")

      if (esAutogenerado) {
        const { error: e } = await supabase
          .from("comprobantes_venta")
          .update({ estado_pago: "anulado", saldo_pendiente: 0 })
          .eq("id", comp.id)
        if (e) errores.push(`anular NC/REV ${comp.id}: ${e.message}`)
      } else {
        // Comprobante real: devolver el saldo imputado
        const totalFact = Math.abs(Number(comp.total_factura) || 0)
        const saldoActual = Number(comp.saldo_pendiente) || 0
        const montoADevolver = Math.abs(Number(imp.monto_imputado) || 0)
        const nuevoSaldo = Math.min(totalFact, saldoActual + montoADevolver)
        const nuevoEstado =
          nuevoSaldo <= 0        ? "pagado" :
          nuevoSaldo >= totalFact ? "pendiente" :
                                    "parcial"

        const { error: e } = await supabase
          .from("comprobantes_venta")
          .update({ saldo_pendiente: nuevoSaldo, estado_pago: nuevoEstado })
          .eq("id", comp.id)
        if (e) errores.push(`restaurar saldo ${comp.id}: ${e.message}`)
      }
    }

    // ── 4. Marcar imputaciones como anuladas ──
    if ((imputaciones || []).length > 0) {
      const { error: e } = await supabase
        .from("imputaciones")
        .update({ estado: "anulado" })
        .eq("pago_id", pagoId)
      // Si falla por CHECK constraint, intentar con "rechazado" como fallback
      if (e) {
        const { error: e2 } = await supabase
          .from("imputaciones")
          .update({ estado: "rechazado" })
          .eq("pago_id", pagoId)
        if (e2) errores.push(`imputaciones estado: ${e2.message}`)
      }
    }

    // ── 5. Marcar recibo como anulado ──
    try {
      const { error: recErr } = await supabase
        .from("recibos")
        .update({
          estado: "anulado",
          anulado_at: new Date().toISOString(),
          anulado_por: auth.user.id,
        })
        .eq("pago_id", pagoId)
      if (recErr) errores.push(`recibos: ${recErr.message}`)
    } catch { /* tabla no existe o columnas no existen aún */ }

    // ── 6. Cheques EN_CARTERA → ANULADO ──
    try {
      const { data: detalles } = await supabase
        .from("pagos_detalle")
        .select("id, cheque_id")
        .eq("pago_id", pagoId)

      const chequeIds: string[] = (detalles || []).map((d: any) => d.cheque_id).filter(Boolean)
      const detalleIds = (detalles || []).map((d: any) => d.id)

      if (detalleIds.length) {
        const { data: ditems } = await supabase
          .from("pago_deposito_items")
          .select("cheque_id")
          .in("pago_detalle_id", detalleIds)
        chequeIds.push(...(ditems || []).map((it: any) => it.cheque_id).filter(Boolean))
      }

      const uniqCheques = [...new Set(chequeIds)]
      if (uniqCheques.length) {
        const { error: chqErr } = await admin
          .from("cheques")
          .update({ estado: "ANULADO" })
          .in("id", uniqCheques)
          .eq("estado", "EN_CARTERA")
        if (chqErr) errores.push(`cheques: ${chqErr.message}`)
      }
    } catch (e: any) { errores.push(`cheques (excepcion): ${e.message}`) }

    // ── 7. Marcar pago como anulado (con o sin columnas de auditoría) ──
    const updatePayload: Record<string, any> = { estado: "anulado" }
    try {
      updatePayload.anulado_por = auth.user.id
      updatePayload.anulado_at = new Date().toISOString()
      updatePayload.motivo_anulacion = motivo || null
      const { error: e } = await supabase.from("pagos_clientes").update(updatePayload).eq("id", pagoId)
      if (e) {
        // Columnas de auditoría no existen aún — intentar solo con estado
        const { error: e2 } = await supabase.from("pagos_clientes").update({ estado: "anulado" }).eq("id", pagoId)
        if (e2) throw e2
        errores.push(`auditoría no guardada (migración pendiente): ${e.message}`)
      }
    } catch (e: any) { throw e }

    // ── 8. Registro en kardex_contable ──
    try {
      await supabase.from("kardex_contable").insert({
        tipo_movimiento: "ANULACION_COBRO",
        concepto: `Anulación pago ${pagoId.slice(0, 8)}${motivo ? ` — ${motivo}` : ""}`,
        monto: -Math.abs(Number(pago.monto)),
        color: null,
        origen_tipo: "CLIENTE",
        origen_id: pago.cliente_id,
        referencia_tipo: "pago_cliente",
        referencia_id: pagoId,
        pago_id: pagoId,
        cliente_id: pago.cliente_id,
        cobrador_id: auth.user.id,
      })
    } catch { /* kardex_contable puede no existir aún */ }

    if (errores.length > 0) {
      console.warn("[anular] completado con advertencias:", errores)
    }

    return NextResponse.json({
      success: true,
      advertencias: errores.length > 0 ? errores : undefined,
    })
  } catch (error: any) {
    console.error("[pagos-clientes/anular] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
