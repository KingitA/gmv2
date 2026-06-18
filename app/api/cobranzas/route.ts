import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"
import { confirmarCobranza } from "@/lib/actions/cobranzas"

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
          color: cheque_compartido.color || "BLANCO",
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

    // ── 3. Un pagos_clientes por cliente ──
    for (const asig of asignaciones as any[]) {
      if (!asig.cliente_id || !asig.metodos?.length) continue
      const montoCliente = montoMetodos(asig.metodos)

      const { data: pago, error: pagoErr } = await supabase
        .from("pagos_clientes")
        .insert({
          cliente_id: asig.cliente_id,
          vendedor_id: vendedor_id || null,
          viaje_id: viaje_id || null,
          cobranza_id: cobranza.id,
          monto: montoCliente,
          fecha_pago: todayArgentina(),
          observaciones: observaciones || null,
          estado: "pendiente",
          creado_por: auth.user.id,
        })
        .select()
        .single()
      if (pagoErr) throw pagoErr

      // Métodos / detalle del cliente
      for (const m of asig.metodos as any[]) {
        let cheque_id: string | null = null
        if (m.tipo === "cheque") {
          if (m.usa_cheque_compartido && sharedChequeId) {
            cheque_id = sharedChequeId
          } else {
            const { data: chq } = await admin
              .from("cheques")
              .insert({
                tipo: "TERCERO",
                estado: "EN_CARTERA",
                banco: m.banco_emisor || "",
                numero: m.numero_cheque || "",
                fecha_emision: m.fecha_emision || null,
                fecha_vencimiento: m.fecha_cheque || todayArgentina(),
                monto: m.monto,
                color: m.color_cheque || "BLANCO",
                cliente_origen_id: asig.cliente_id,
              })
              .select("id")
              .single()
            cheque_id = chq?.id || null
          }
        }

        await supabase.from("pagos_detalle").insert({
          pago_id: pago.id,
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
          color_cheque: m.color_cheque || null,
          cheque_id,
          fecha_deposito: m.fecha_deposito || null,
        })
      }

      // Imputaciones (pendientes; confirmarCobranza las aplica)
      if (asig.imputaciones?.length) {
        const imputData = (asig.imputaciones as any[]).map((imp) => ({
          pago_id: pago.id,
          comprobante_id: imp.comprobante_id,
          tipo_comprobante: "venta",
          monto_imputado: imp.monto_imputado,
          estado: "pendiente",
        }))
        await supabase.from("imputaciones").insert(imputData)
      }

      // Confirmación en el acto (por defecto)
      let numero_recibo: string | null = null
      if (confirmar !== false) {
        const r = await confirmarCobranza(supabase, admin, { pagoId: pago.id, usuarioId: auth.user.id })
        numero_recibo = r.numero_recibo
      }
      resultados.push({ cliente_id: asig.cliente_id, pago_id: pago.id, monto: montoCliente, numero_recibo })
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
