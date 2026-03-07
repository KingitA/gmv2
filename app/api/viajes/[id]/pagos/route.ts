import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

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

    const {
      pedido_id,
      cliente_id,
      monto,
      forma_pago,
      observaciones,
      datos_cheque,
      datos_transferencia,
    } = body

    // Validaciones básicas
    if (!pedido_id || !cliente_id || !monto || !forma_pago) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      )
    }

    // Verificar que el viaje esté en estado "en_viaje"
    const { data: viaje } = await supabase
      .from("viajes")
      .select("estado")
      .eq("id", viaje_id)
      .single()

    if (!viaje || viaje.estado !== "en_viaje") {
      return NextResponse.json(
        { error: "El viaje no está en estado 'en_viaje'" },
        { status: 400 }
      )
    }

    // Registrar el pago en viajes_pagos
    const { data: pago, error: pagoError } = await supabase
      .from("viajes_pagos")
      .insert({
        viaje_id,
        pedido_id,
        cliente_id,
        monto,
        forma_pago,
        observaciones,
        fecha: nowArgentina(),
      })
      .select()
      .single()

    if (pagoError) {
      console.error("[v0] Error al registrar pago:", pagoError)
      return NextResponse.json({ error: pagoError.message }, { status: 500 })
    }

    // Si es cheque o transferencia, guardar datos adicionales
    if (forma_pago === "cheque" && datos_cheque) {
      await supabase.from("viajes_pagos").update({
        numero_cheque: datos_cheque.numero,
        banco_cheque: datos_cheque.banco,
        fecha_emision_cheque: datos_cheque.fecha_emision,
        fecha_pago_cheque: datos_cheque.fecha_pago,
      }).eq("id", pago.id)
    }

    if (forma_pago === "transferencia" && datos_transferencia) {
      await supabase.from("viajes_pagos").update({
        banco_origen: datos_transferencia.banco_origen,
        banco_destino: datos_transferencia.banco_destino,
        referencia_transferencia: datos_transferencia.referencia,
      }).eq("id", pago.id)
    }

    return NextResponse.json(
      { message: "Pago registrado correctamente", pago },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[v0] Error en POST /api/viajes/[id]/pagos:", error)
    return NextResponse.json(
      { error: "Error al registrar pago" },
      { status: 500 }
    )
  }
}
