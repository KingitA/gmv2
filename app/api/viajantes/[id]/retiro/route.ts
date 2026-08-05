import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const { comisiones_ids, concepto } = await request.json()

    if (!comisiones_ids?.length) {
      return NextResponse.json({ error: "Se requiere al menos una comisión" }, { status: 400 })
    }

    // Obtener comisiones — validar que pertenezcan al viajante y estén pendientes
    const { data: comisiones, error: fetchError } = await supabase
      .from("comisiones")
      .select("id, monto, viajante_id, pagado")
      .in("id", comisiones_ids)
      .eq("viajante_id", id)
      .eq("pagado", false)

    if (fetchError) throw fetchError
    if (!comisiones?.length) {
      return NextResponse.json({ error: "No se encontraron comisiones válidas para el viajante" }, { status: 400 })
    }

    const totalRetiro = comisiones.reduce((s, c) => s + Number(c.monto), 0)

    // Registrar movimiento de retiro en billetera (monto negativo = egreso)
    const { data: movimiento, error: movError } = await supabase
      .from("billetera_movimientos")
      .insert({
        viajante_id: id,
        tipo: "retiro_comision",
        monto: -Math.abs(totalRetiro),
        concepto: concepto ?? `Retiro de ${comisiones.length} comisiones`,
        referencia_tipo: "retiro",
        fecha: nowArgentina(),
        creado_por: auth.user.id,
      })
      .select("id")
      .single()
    if (movError) throw movError

    // Dual-write al libro de caja (Caja del Día E4): el retiro es plata que
    // sale del circuito y hasta ahora no dejaba rastro en kardex_contable.
    // RETIRO_BILLETERA estaba declarado en el dominio B1 sin uso — este es su
    // uso previsto. Sin doble saldo: kardex_registrar v3 no toca saldos
    // BILLETERA (los maneja el trigger de billetera_movimientos, arriba).
    // Best-effort: si falla no revierte el retiro, solo se loguea.
    const { error: kardexError } = await supabase.rpc("kardex_registrar", {
      p_tipo_movimiento: "RETIRO_BILLETERA",
      p_concepto: concepto ?? `Retiro comisión (${comisiones.length} comisiones)`,
      p_monto: Math.abs(totalRetiro),
      p_color: "BLANCO",
      p_origen_tipo: "BILLETERA",
      p_origen_id: id,
      p_destino_tipo: "EXTERNO",
      p_metodo: "EFECTIVO",
      p_referencia_tipo: "billetera_movimiento",
      p_referencia_id: movimiento?.id ?? null,
      p_usuario_id: auth.user.id,
    })
    if (kardexError) console.error("[viajantes/retiro] kardex_registrar falló:", kardexError)

    // Marcar comisiones como pagadas
    const { error: updateError } = await supabase
      .from("comisiones")
      .update({ pagado: true, fecha_pago: nowArgentina() })
      .in("id", comisiones.map(c => c.id))

    if (updateError) throw updateError

    return NextResponse.json({
      success: true,
      total_retirado: totalRetiro,
      comisiones_pagadas: comisiones.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
