import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"
import { confirmarCobranza } from "@/lib/actions/cobranzas"
import { crearCobranza, recortarImputaciones, type DetalleInput } from "@/lib/cobranzas/crear"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"
import { colorOverride, derivarColorCheque, COLOR_PENDIENTE } from "@/lib/actions/color-cheque"

// POST /api/cobranzas
// Cobranza de UN cobro físico que abarca varios clientes/CUITs (caso "Tandil").
// Crea la cabecera 'cobranzas' + un pagos_clientes por cliente (cobranza_id), con
// sus métodos e imputaciones. Soporta un cheque compartido (una sola fila en
// 'cheques' referenciada por las porciones de cada cliente). Por defecto confirma
// en el acto (confirmarCobranza por cliente: imputa, postea haber, recibo, kardex);
// con confirmar:false queda PENDIENTE de verificación.
//
// Body:
// {
//   origen?, viaje_id?, vendedor_id?, observaciones?, confirmar?=true,
//   cheque_compartido?: { banco, numero, fecha_emision?, fecha_cheque, monto, color?, cuit_emisor?, localidad? },
//   asignaciones: [{
//     cliente_id,
//     imputaciones?: [{ comprobante_id, monto_imputado }],
//     metodos: [{ tipo, monto, usa_cheque_compartido?, caja_id?, cuenta_bancaria_id?,
//                 fecha_transferencia?, numero_comprobante?, banco_emisor?, numero_cheque?,
//                 fecha_emision?, fecha_cheque?, localidad?, cuit_emisor?, color_cheque?, fecha_deposito? }]
//   }]
// }
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const body = await request.json()

    const {
      origen = "ERP",
      viaje_id,
      vendedor_id,
      observaciones,
      confirmar,
      cheque_compartido,
      asignaciones,
      idempotency_key, // uuid del front: reintentos no duplican el lote
    } = body

    if (!Array.isArray(asignaciones) || asignaciones.length === 0) {
      return NextResponse.json({ error: "Se requiere al menos una asignación de cliente" }, { status: 400 })
    }

    const montoMetodos = (ms: any[]) =>
      (ms || []).reduce((s: number, m: any) => s + (m.tipo === "deposito"
        ? (m.items || []).reduce((a: number, it: any) => a + Number(it.monto), 0)
        : Number(m.monto)), 0)

    const total = asignaciones.reduce((s: number, a: any) => s + montoMetodos(a.metodos), 0)
    if (total <= 0) {
      return NextResponse.json({ error: "El total de la cobranza debe ser mayor a 0" }, { status: 400 })
    }

    // ── 1. Cheque compartido (una sola fila en cheques) ──
    // Su color se deriva del agregado de imputaciones de TODOS los clientes
    // (>50% a PRES ⇒ NEGRO); override manual posible; sin imputaciones ⇒ PENDIENTE.
    const todasImputaciones = (asignaciones as any[]).flatMap((a: any) => a.imputaciones || [])
    const colorCompartido =
      colorOverride(cheque_compartido?.color) ||
      (await derivarColorCheque(supabase, todasImputaciones)) ||
      COLOR_PENDIENTE

    let sharedChequeId: string | null = null
    if (cheque_compartido) {
      const { data: chq, error: chErr } = await admin
        .from("cheques")
        .insert({
          tipo: "TERCERO",
          estado: "EN_CARTERA",
          banco: cheque_compartido.banco || "",
          numero: cheque_compartido.numero || "",
          fecha_emision: cheque_compartido.fecha_emision || null,
          fecha_vencimiento: cheque_compartido.fecha_cheque || todayArgentina(),
          monto: cheque_compartido.monto,
          color: colorCompartido,
          es_echeq: cheque_compartido.color === "ECHEQ" || Boolean(cheque_compartido.es_echeq),
        })
        .select("id")
        .single()
      if (chErr) throw new Error("Error creando cheque compartido: " + chErr.message)
      sharedChequeId = chq?.id || null
    }

    // ── 2. Cabecera de cobranza ──
    const { data: cobranza, error: cobErr } = await supabase
      .from("cobranzas")
      .insert({
        fecha: todayArgentina(),
        estado: "pendiente",
        origen,
        viaje_id: viaje_id || null,
        vendedor_id: vendedor_id || null,
        cobrador_id: auth.user.id,
        total,
        observaciones: observaciones || null,
        creado_por: auth.user.id,
      })
      .select()
      .single()
    if (cobErr) throw cobErr

    const resultados: any[] = []

    // ── 3. Un pagos_clientes por cliente (alta transaccional vía RPC) ──
    for (let asigIdx = 0; asigIdx < (asignaciones as any[]).length; asigIdx++) {
      const asig = (asignaciones as any[])[asigIdx]
      if (!asig.cliente_id || !asig.metodos?.length) continue
      const montoCliente = montoMetodos(asig.metodos)
      const colorAsignacion =
        (await derivarColorCheque(supabase, asig.imputaciones)) || COLOR_PENDIENTE

      const detalles: DetalleInput[] = (asig.metodos as any[]).map((m: any) => {
        // Compartido: hereda el color del cheque físico único; propio: override
        // manual > derivado de las imputaciones de este cliente > PENDIENTE.
        const colorMetodo = m.usa_cheque_compartido && sharedChequeId
          ? colorCompartido
          : colorOverride(m.color_cheque) || colorAsignacion
        return {
          tipo_pago: m.tipo,
          monto: m.tipo === "deposito"
            ? (m.items || []).reduce((a: number, it: any) => a + Number(it.monto), 0)
            : Number(m.monto),
          caja_id: m.caja_id || null,
          cuenta_bancaria_id: m.cuenta_bancaria_id || null,
          fecha_transferencia: m.fecha_transferencia || null,
          numero_comprobante_pago: m.numero_comprobante || null,
          banco: m.banco_emisor || null,
          numero_cheque: m.numero_cheque || null,
          fecha_cheque: m.fecha_cheque || null,
          localidad: m.localidad || null,
          cuit_emisor: m.cuit_emisor || null,
          color_cheque: m.tipo === "cheque" || m.tipo === "deposito" ? colorMetodo : null,
          fecha_deposito: m.fecha_deposito || null,
          cheque_id: m.tipo === "cheque" && m.usa_cheque_compartido && sharedChequeId ? sharedChequeId : null,
          cheque: m.tipo === "cheque" && !(m.usa_cheque_compartido && sharedChequeId)
            ? {
                banco: m.banco_emisor || "",
                numero: m.numero_cheque || "",
                fecha_emision: m.fecha_emision || null,
                fecha_vencimiento: m.fecha_cheque || todayArgentina(),
                monto: Number(m.monto),
                color: colorMetodo,
                es_echeq: m.color_cheque === "ECHEQ" || Boolean(m.es_echeq),
              }
            : null,
          deposito_items: m.tipo === "deposito"
            ? (m.items || []).map((item: any) => ({
                tipo_item: item.tipo_item,
                monto: Number(item.monto),
                numero_cheque: item.numero_cheque || null,
                banco_emisor: item.banco_emisor || null,
                fecha_pago_cheque: item.fecha_pago_cheque || null,
                numero_comprobante_deposito: item.numero_comprobante_deposito || null,
                fecha_deposito_efectivo: item.fecha_deposito_efectivo || null,
                nro_comprobante_deposito_ef: item.nro_comprobante_deposito_ef || null,
                cheque: item.tipo_item === "cheque"
                  ? {
                      banco: item.banco_emisor || null,
                      numero: item.numero_cheque || null,
                      fecha_vencimiento: item.fecha_pago_cheque || null,
                      monto: Number(item.monto),
                      color: colorMetodo,
                    }
                  : null,
              }))
            : undefined,
        }
      })

      const { pago_id, dedup } = await crearCobranza(supabase, {
        // Clave derivada del submit por asignación (nibble de versión → 'e' +
        // índice al final): reintentos no duplican ningún cliente del lote.
        idempotency_key: idempotency_key
          ? idempotency_key.slice(0, 14) + "e" + idempotency_key.slice(15, 34) + String(10 + asigIdx)
          : null,
        cliente_id: asig.cliente_id,
        vendedor_id: vendedor_id || null,
        viaje_id: viaje_id || null,
        cobranza_id: cobranza.id,
        monto: montoCliente,
        fecha_pago: todayArgentina(),
        observaciones: observaciones || null,
        estado: "pendiente",
        creado_por: auth.user.id,
        detalles,
        imputaciones: recortarImputaciones(
          ((asig.imputaciones as any[]) || [])
            .filter((i: any) => i?.comprobante_id)
            .map((i: any) => ({ comprobante_id: i.comprobante_id, monto_imputado: Number(i.monto_imputado) })),
          montoCliente,
        ),
      })

      // Confirmación en el acto (por defecto) + post-confirmación (comisiones,
      // billetera, bonificación 10% diferida)
      let numero_recibo: string | null = null
      if (confirmar !== false) {
        const r = await confirmarCobranza(supabase, admin, { pagoId: pago_id, usuarioId: auth.user.id })
        numero_recibo = r.numero_recibo
        await procesarPostConfirmacion(supabase, admin, {
          pagoId: pago_id,
          usuarioId: auth.user.id,
          paidComprobanteIds: r.paidComprobanteIds,
        })
      }
      resultados.push({ cliente_id: asig.cliente_id, pago_id, monto: montoCliente, numero_recibo, ...(dedup ? { dedup } : {}) })
    }

    // ── 4. Estado de la cobranza ──
    const estadoFinal = confirmar === false ? "pendiente" : "confirmada"
    await supabase
      .from("cobranzas")
      .update({
        estado: estadoFinal,
        ...(confirmar !== false ? { confirmado_por: auth.user.id, confirmado_at: new Date().toISOString() } : {}),
      })
      .eq("id", cobranza.id)

    return NextResponse.json({
      success: true,
      cobranza_id: cobranza.id,
      estado: estadoFinal,
      total,
      clientes: resultados,
    })
  } catch (error: any) {
    console.error("[cobranzas] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
