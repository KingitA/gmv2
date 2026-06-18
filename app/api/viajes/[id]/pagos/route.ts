import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

// POST /api/viajes/[id]/pagos
// Registra una cobranza del viaje en pagos_clientes con estado 'pendiente_rendicion'
// (viajes_pagos retirado: una sola tabla de pagos). Se confirma en la rendición.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const { id: viaje_id } = await params
    const body = await request.json()

    const { pedido_id, cliente_id, monto, forma_pago, observaciones, datos_cheque, datos_transferencia } = body

    if (!cliente_id || !monto || !forma_pago) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 })
    }

    const { data: viaje } = await supabase
      .from("viajes")
      .select("estado, chofer_id")
      .eq("id", viaje_id)
      .single()

    if (!viaje || ["completado", "cancelado"].includes(viaje.estado)) {
      return NextResponse.json({ error: "El viaje no está activo" }, { status: 400 })
    }

    // Cabecera del pago (pendiente de rendición)
    const { data: pago, error: pagoError } = await supabase
      .from("pagos_clientes")
      .insert({
        cliente_id,
        vendedor_id: null, // chofer = usuario (profiles), no vendedor
        viaje_id,
        pedido_id: pedido_id || null,
        monto,
        fecha_pago: todayArgentina(),
        estado: "pendiente_rendicion",
        observaciones: observaciones || null,
        creado_por: auth.user.id,
      })
      .select()
      .single()

    if (pagoError) {
      console.error("[viajes/pagos] Error registrando pago:", pagoError)
      return NextResponse.json({ error: pagoError.message }, { status: 500 })
    }

    // Cheque (si corresponde)
    let cheque_id: string | null = null
    if (forma_pago === "cheque" && datos_cheque) {
      const { data: chq } = await supabase
        .from("cheques")
        .insert({
          tipo: "TERCERO",
          estado: "EN_CARTERA",
          banco: datos_cheque.banco || "",
          numero: datos_cheque.numero || "",
          fecha_emision: datos_cheque.fecha_emision || null,
          fecha_vencimiento: datos_cheque.fecha_pago || todayArgentina(),
          monto,
          color: datos_cheque.color || "NEGRO",
          cliente_origen_id: cliente_id,
        })
        .select("id")
        .single()
      cheque_id = chq?.id || null
    }

    // Detalle del método de pago
    await supabase.from("pagos_detalle").insert({
      pago_id: pago.id,
      tipo_pago: forma_pago,
      monto,
      numero_cheque: datos_cheque?.numero || null,
      banco: datos_cheque?.banco || null,
      fecha_cheque: datos_cheque?.fecha_pago || null,
      cheque_id,
      numero_comprobante_pago: datos_transferencia?.referencia || null,
    })

    return NextResponse.json(
      { message: "Cobranza registrada (pendiente de rendición)", pago },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[viajes/pagos] Error:", error)
    return NextResponse.json({ error: "Error al registrar pago" }, { status: 500 })
  }
}
