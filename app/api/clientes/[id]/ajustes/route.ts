import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"

/**
 * Ajuste manual de cuenta corriente del cliente.
 *
 * Desde Fase A2 el ajuste postea al LIBRO MAYOR vía RPC `cc_ajuste_manual`
 * (cc_postear) y NO toca comprobantes_venta.saldo_pendiente — la versión
 * anterior modificaba saldo_pendiente sin posteo y rompía v_saldo_clientes.
 *
 * Body: { monto, motivo, comprobante_id?, aplicar_saldo? }
 *  - monto > 0 → débito (aumenta la deuda del cliente)
 *  - monto < 0 → crédito (reduce la deuda)
 *  - comprobante_id: opcional, referencia en el concepto
 *  - aplicar_saldo: con comprobante_id y monto negativo (crédito), además de
 *    postear al libro reduce el saldo_pendiente del comprobante (ajuste por
 *    redondeo: sin esto el comprobante quedaría con centavos pendientes
 *    eternos, porque el libro mayor y los saldos de imputación son capas
 *    separadas).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: cliente_id } = await params
    const body = await request.json()
    const { comprobante_id, monto, motivo, aplicar_saldo, pago_id } = body

    if (!monto || !motivo) {
      return NextResponse.json({ error: "Faltan datos requeridos (monto, motivo)" }, { status: 400 })
    }

    // ── Resolver el comprobante destino del aplicar_saldo ──
    // El front manda "el último de su lista", pero con el reparto proporcional
    // del pago NO puede saber cuál quedó con saldo: eso lo decide el servidor.
    // Si el ajuste viene de un pago, el destino real es el comprobante DE ESE
    // PAGO que quedó con saldo pendiente (el de mayor saldo si hay varios).
    let saldoTargetId: string | null =
      aplicar_saldo && comprobante_id && Number(monto) < 0 ? comprobante_id : null
    if (aplicar_saldo && Number(monto) < 0 && pago_id) {
      const { data: impsPago } = await supabase
        .from("imputaciones")
        .select("comprobante_id, comprobante:comprobantes_venta!imputaciones_comprobante_id_fkey(id, saldo_pendiente, tipo_comprobante)")
        .eq("pago_id", pago_id)
        .eq("estado", "confirmado")
        .not("comprobante_id", "is", null)
      const conSaldo = (impsPago || [])
        .map((i: any) => i.comprobante)
        .filter((c: any) => c && Number(c.saldo_pendiente) > 0.005)
        .sort((a: any, b: any) => Number(b.saldo_pendiente) - Number(a.saldo_pendiente))
      if (conSaldo.length) saldoTargetId = conSaldo[0].id
    }

    let concepto = String(motivo)
    const refId = saldoTargetId || comprobante_id
    if (refId) {
      const { data: comp } = await supabase
        .from("comprobantes_venta")
        .select("numero_comprobante, tipo_comprobante, cliente_id")
        .eq("id", refId)
        .single()
      if (comp && comp.cliente_id !== cliente_id) {
        return NextResponse.json(
          { error: "El comprobante no pertenece a este cliente" },
          { status: 400 }
        )
      }
      if (comp) concepto += ` (ref. ${comp.tipo_comprobante} ${comp.numero_comprobante})`
    }
    // Vínculo estructural para que la ANULACIÓN del pago revierta también este
    // ajuste (cobranza_anular busca las marcas): [pago:<id>] identifica el pago
    // que lo originó; [saldo:<id>] marca que además saldó ese comprobante.
    if (pago_id) concepto += ` [pago:${pago_id}]`
    if (saldoTargetId) concepto += ` [saldo:${saldoTargetId}]`

    const { data, error } = await supabase.rpc("cc_ajuste_manual", {
      p_cliente_id: cliente_id,
      p_tipo: Number(monto) > 0 ? "debito" : "credito",
      p_monto: Math.abs(Number(monto)),
      p_concepto: concepto,
      p_usuario_id: auth.user.id,
    })
    if (error) throw new Error(error.message)

    // Ajuste por redondeo: el crédito también baja el saldo del comprobante
    if (saldoTargetId) {
      const admin = createAdminClient()
      const { data: comp } = await admin
        .from("comprobantes_venta")
        .select("saldo_pendiente")
        .eq("id", saldoTargetId)
        .single()
      if (comp) {
        const nuevoSaldo = Math.max(
          0,
          Math.round((Number(comp.saldo_pendiente) - Math.abs(Number(monto))) * 100) / 100
        )
        await admin
          .from("comprobantes_venta")
          .update({
            saldo_pendiente: nuevoSaldo,
            estado_pago: nuevoSaldo <= 0.009 ? "pagado" : "parcial",
          })
          .eq("id", saldoTargetId)
      }

      // El ajuste llega DESPUÉS de que el pago se confirmó: si recién ahora el
      // comprobante quedó saldado, la post-confirmación (idempotente) completa
      // lo que faltó — típicamente la comisión 'cobrada' de ese comprobante.
      if (pago_id) {
        try {
          await procesarPostConfirmacion(supabase, admin, {
            pagoId: pago_id,
            usuarioId: auth.user.id,
          })
        } catch (postErr: any) {
          console.error("[clientes/ajustes] post-confirmación tras ajuste:", postErr?.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      movimiento_id: data,
      mensaje: "Ajuste registrado en la cuenta corriente",
    })
  } catch (error: any) {
    console.error("[clientes/ajustes] error:", error)
    return NextResponse.json({ error: error.message || "Error al ajustar saldo" }, { status: 500 })
  }
}

/**
 * DELETE — anular un ajuste manual del libro mayor.
 * El libro es de doble entrada: NO se borran filas (se perdería el rastro en
 * el extracto). En su lugar se postea el CONTRA-ASIENTO exacto vía
 * cc_ajuste_manual, con la marca [reversa:<id>] para que el mismo ajuste no
 * pueda revertirse dos veces. El efecto sobre v_saldo_clientes es idéntico
 * al borrado, pero auditable.
 * Body: { movimiento_id }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id: cliente_id } = await params
    const { movimiento_id } = await request.json()
    if (!movimiento_id) {
      return NextResponse.json({ error: "movimiento_id es requerido" }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: mov } = await admin
      .from("cuenta_corriente_clientes")
      .select("id, cliente_id, tipo_movimiento, referencia_tipo, debe, haber, observaciones")
      .eq("id", movimiento_id)
      .single()

    if (!mov || mov.cliente_id !== cliente_id) {
      return NextResponse.json({ error: "Movimiento no encontrado para este cliente" }, { status: 404 })
    }
    if (mov.tipo_movimiento !== "ajuste" || mov.referencia_tipo !== "ajuste_manual") {
      return NextResponse.json(
        { error: "Solo se pueden eliminar ajustes manuales (este movimiento es del circuito de comprobantes/pagos)" },
        { status: 400 }
      )
    }
    const marcaReversa = `[reversa:${movimiento_id}]`
    if ((mov.observaciones || "").includes("[reversa:")) {
      return NextResponse.json(
        { error: "Este movimiento ya es la reversa de otro ajuste — no se revierte una reversa" },
        { status: 400 }
      )
    }
    const { data: yaRevertido } = await admin
      .from("cuenta_corriente_clientes")
      .select("id")
      .eq("cliente_id", cliente_id)
      .ilike("observaciones", `%${marcaReversa}%`)
      .limit(1)
    if (yaRevertido?.length) {
      return NextResponse.json({ error: "Este ajuste ya fue eliminado (tiene su reversa)" }, { status: 400 })
    }

    // Contra-asiento: si el ajuste era débito, la reversa es crédito y viceversa
    const monto = Math.round((Number(mov.debe || 0) - Number(mov.haber || 0)) * 100) / 100
    const { error: revErr } = await admin.rpc("cc_ajuste_manual", {
      p_cliente_id: cliente_id,
      p_tipo: monto > 0 ? "credito" : "debito",
      p_monto: Math.abs(monto),
      p_concepto: `Eliminación de ajuste — ${(mov.observaciones || "sin detalle").slice(0, 120)} ${marcaReversa}`,
      p_usuario_id: auth.user.id,
    })
    if (revErr) throw new Error(revErr.message)

    // Si el ajuste había SALDADO un comprobante (aplicar_saldo, marca
    // [saldo:<id>]), restaurar ese saldo — igual que hace cobranza_anular v4.
    // Sin esto, eliminar el ajuste dejaba el comprobante saldado de más
    // (descuadre libro vs documentos del tamaño del ajuste).
    const saldoMatch = (mov.observaciones || "").match(/\[saldo:([0-9a-fA-F-]{36})\]/)
    if (saldoMatch && monto < 0) {
      const { data: comp } = await admin
        .from("comprobantes_venta")
        .select("id, saldo_pendiente, total_factura")
        .eq("id", saldoMatch[1])
        .single()
      if (comp) {
        const totalAbs = Math.abs(Number(comp.total_factura || 0))
        const nuevoSaldo = Math.min(
          totalAbs,
          Math.round((Number(comp.saldo_pendiente || 0) + Math.abs(monto)) * 100) / 100
        )
        await admin
          .from("comprobantes_venta")
          .update({
            saldo_pendiente: nuevoSaldo,
            estado_pago: nuevoSaldo <= 0 ? "pagado" : nuevoSaldo >= totalAbs ? "pendiente" : "parcial",
          })
          .eq("id", comp.id)
      }
    }

    return NextResponse.json({
      success: true,
      mensaje: `Ajuste revertido con contra-asiento ($ ${Math.abs(monto)})`,
    })
  } catch (error: any) {
    console.error("[clientes/ajustes] DELETE error:", error)
    return NextResponse.json({ error: error.message || "Error eliminando el ajuste" }, { status: 500 })
  }
}
