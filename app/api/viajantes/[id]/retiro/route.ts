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
    const { error: movError } = await supabase.from("billetera_movimientos").insert({
      viajante_id: id,
      tipo: "retiro_comision",
      monto: -Math.abs(totalRetiro),
      concepto: concepto ?? `Retiro de ${comisiones.length} comisiones`,
      referencia_tipo: "retiro",
      fecha: nowArgentina(),
      creado_por: auth.user.id,
    })
    if (movError) throw movError

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
