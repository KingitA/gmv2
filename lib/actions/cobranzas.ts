import type { SupabaseClient } from "@supabase/supabase-js"
import { nowArgentina, todayArgentina } from "@/lib/utils"

export interface ConfirmarCobranzaResult {
  numero_recibo: string | null
  recibo_id: string | null
  /** Comprobantes que quedaron totalmente pagados con esta confirmación. */
  paidComprobanteIds: string[]
  yaEstabaConfirmado: boolean
}

/**
 * Confirmación ÚNICA y reutilizable de una cobranza (pago de cliente).
 *
 * Es el único lugar donde un pago pendiente "se vuelve plata real":
 *  1. aplica las imputaciones pendientes al saldo_pendiente de los comprobantes,
 *  2. postea el haber al libro mayor (cuenta_corriente_clientes),
 *  3. genera el recibo numerado,
 *  4. registra el/los movimientos en kardex_contable (caja/banco/cartera),
 *  5. marca el pago como 'confirmado'.
 *
 * Idempotente: si el pago ya está confirmado o ya tiene libro mayor/recibo/kardex,
 * no los duplica. Lo usan el alta ERP (confirmación en el acto), la revisión de
 * pagos y la rendición de viaje/vendedor.
 *
 * @param supabase cliente con permisos de escritura (server/admin)
 * @param admin    cliente service-role para numeración de recibos
 */
export async function confirmarCobranza(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  { pagoId, usuarioId }: { pagoId: string; usuarioId: string },
): Promise<ConfirmarCobranzaResult> {
  const { data: pago, error: pagoErr } = await supabase
    .from("pagos_clientes")
    .select("*")
    .eq("id", pagoId)
    .single()

  if (pagoErr || !pago) throw new Error("Pago no encontrado")
  if (pago.estado === "anulado" || pago.estado === "rechazado") {
    throw new Error(`No se puede confirmar un pago en estado '${pago.estado}'`)
  }

  const yaEstabaConfirmado = pago.estado === "confirmado"
  const paidComprobanteIds: string[] = []

  // ── 1. Aplicar imputaciones pendientes al saldo de los comprobantes ──
  const { data: imps } = await supabase
    .from("imputaciones")
    .select("id, comprobante_id, monto_imputado, estado")
    .eq("pago_id", pagoId)

  for (const imp of imps || []) {
    if (imp.estado === "confirmado") continue // ya aplicada
    if (!imp.comprobante_id) continue
    const { data: comp } = await supabase
      .from("comprobantes_venta")
      .select("saldo_pendiente, total_factura")
      .eq("id", imp.comprobante_id)
      .single()
    if (!comp) continue
    const nuevoSaldo = Math.max(0, Number(comp.saldo_pendiente) - Number(imp.monto_imputado))
    const estadoPago = nuevoSaldo <= 0 ? "pagado" : "parcial"
    await supabase
      .from("comprobantes_venta")
      .update({ saldo_pendiente: nuevoSaldo, estado_pago: estadoPago })
      .eq("id", imp.comprobante_id)
    await supabase.from("imputaciones").update({ estado: "confirmado" }).eq("id", imp.id)
    if (estadoPago === "pagado") paidComprobanteIds.push(imp.comprobante_id)
  }

  // ── 2. Libro mayor: haber del pago (guard de idempotencia) ──
  const { data: existingLedger } = await supabase
    .from("cuenta_corriente_clientes")
    .select("id")
    .eq("referencia_tipo", "pago_cliente")
    .eq("referencia_id", pagoId)
    .limit(1)
  if (!existingLedger?.length) {
    const { error: ccErr } = await supabase.rpc("cc_postear", {
      p_cliente_id: pago.cliente_id,
      p_tipo_movimiento: "pago",
      p_debe: 0,
      p_haber: Math.abs(Number(pago.monto)),
      p_referencia_tipo: "pago_cliente",
      p_referencia_id: pagoId,
      p_numero_comprobante: null,
      p_observaciones: pago.observaciones || "Pago",
      p_usuario_id: usuarioId,
    })
    if (ccErr) console.error("[confirmarCobranza] cc_postear", pagoId, ccErr.message)
  }

  // ── 3. Recibo numerado (guard) ──
  let { data: recibo } = await supabase
    .from("recibos")
    .select("id, numero_recibo")
    .eq("pago_id", pagoId)
    .maybeSingle()

  if (!recibo) {
    const { data: numRow } = await admin
      .from("numeracion_comprobantes")
      .select("ultimo_numero")
      .eq("tipo_comprobante", "RECIBO")
      .eq("punto_venta", "0001")
      .single()
    let numeroRecibo = "REC-0001-00000001"
    if (numRow) {
      const siguiente = Number(numRow.ultimo_numero) + 1
      numeroRecibo = `REC-0001-${String(siguiente).padStart(8, "0")}`
      await admin
        .from("numeracion_comprobantes")
        .update({ ultimo_numero: siguiente })
        .eq("tipo_comprobante", "RECIBO")
        .eq("punto_venta", "0001")
    }
    const { data: r } = await supabase
      .from("recibos")
      .insert({
        numero_recibo: numeroRecibo,
        pago_id: pagoId,
        cliente_id: pago.cliente_id,
        fecha: pago.fecha_pago || todayArgentina(),
        monto_total: pago.monto,
        generado_por: usuarioId,
      })
      .select("id, numero_recibo")
      .single()
    recibo = r
  }

  // ── 4. Kardex contable: una línea por método (guard) ──
  const { data: existingKardex } = await supabase
    .from("kardex_contable")
    .select("id")
    .eq("referencia_tipo", "pago_cliente")
    .eq("referencia_id", pagoId)
    .limit(1)
  if (!existingKardex?.length) {
    const { data: detalles } = await supabase
      .from("pagos_detalle")
      .select("tipo_pago, monto, caja_id, cuenta_bancaria_id, color_cheque")
      .eq("pago_id", pagoId)

    const kardexItems = (detalles || []).map((d: any) => ({
      tipo_movimiento: "COBRO_CLIENTE",
      concepto: `Cobro ${recibo?.numero_recibo ?? ""} — ${String(d.tipo_pago).toUpperCase()}`,
      monto: Number(d.monto),
      color: d.color_cheque || null,
      origen_tipo: "CLIENTE",
      origen_id: pago.cliente_id,
      destino_tipo:
        d.tipo_pago === "cheque" || d.tipo_pago === "deposito" ? "EN_CARTERA"
          : d.tipo_pago === "efectivo" ? "CAJA"
            : "BANCO",
      destino_id:
        d.tipo_pago === "efectivo" ? d.caja_id || null
          : d.tipo_pago === "transferencia" || d.tipo_pago === "deposito" ? d.cuenta_bancaria_id || null
            : null,
      metodo:
        d.tipo_pago === "cheque" ? "CHEQUE_TERCERO"
          : d.tipo_pago === "transferencia" ? "TRANSFERENCIA"
            : d.tipo_pago === "deposito" ? "DEPOSITO"
              : "EFECTIVO",
      referencia_tipo: "pago_cliente",
      referencia_id: pagoId,
      pago_id: pagoId,
      recibo_id: recibo?.id || null,
      cliente_id: pago.cliente_id,
      cobrador_id: usuarioId,
    }))

    // Retenciones (si las hubiera): una línea contable adicional
    const { data: rets } = await supabase
      .from("retenciones")
      .select("monto")
      .eq("pago_id", pagoId)
    const totalRet = (rets || []).reduce((s: number, r: any) => s + Number(r.monto), 0)
    if (totalRet > 0) {
      kardexItems.push({
        tipo_movimiento: "COBRO_CLIENTE",
        concepto: `Retenciones ${recibo?.numero_recibo ?? ""}`,
        monto: totalRet,
        color: null,
        origen_tipo: "CLIENTE",
        origen_id: pago.cliente_id,
        destino_tipo: null,
        destino_id: null,
        metodo: "RETENCION",
        referencia_tipo: "pago_cliente",
        referencia_id: pagoId,
        pago_id: pagoId,
        recibo_id: recibo?.id || null,
        cliente_id: pago.cliente_id,
        cobrador_id: usuarioId,
      } as any)
    }

    if (kardexItems.length) {
      const { error: kErr } = await supabase.from("kardex_contable").insert(kardexItems)
      if (kErr) console.error("[confirmarCobranza] kardex", pagoId, kErr.message)
    }
  }

  // ── 5. Marcar pago confirmado ──
  if (!yaEstabaConfirmado) {
    await supabase
      .from("pagos_clientes")
      .update({ estado: "confirmado", confirmado_por: usuarioId, fecha_confirmacion: nowArgentina() })
      .eq("id", pagoId)
  }

  return {
    numero_recibo: recibo?.numero_recibo ?? null,
    recibo_id: recibo?.id ?? null,
    paidComprobanteIds,
    yaEstabaConfirmado,
  }
}
