import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

// POST /api/chofer/billetera/gasto
// Registra un gasto del chofer (nafta, hotel, peón, otro)
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()

    const { monto, categoria, observaciones, viaje_id } = body

    if (!monto || monto <= 0) {
      return NextResponse.json({ error: "monto debe ser mayor a 0" }, { status: 400 })
    }

    const categoriasValidas = ["nafta", "hotel", "peon", "cubierta", "peaje", "comida", "otro"]
    const cat = categoriasValidas.includes(categoria) ? categoria : "otro"

    // Gasto de un VIAJE: baja la billetera del titular (aunque lo cargue el
    // acompañante) y queda en viajes_gastos para que oficina lo apruebe.
    if (viaje_id) {
      const { data, error: rpcErr } = await supabase.rpc("viaje_gasto_registrar", {
        p_viaje_id: viaje_id,
        p_usuario_id: auth.user.id,
        p_categoria: cat,
        p_monto: Number(monto),
        p_observaciones: observaciones || null,
        p_foto_url: body.foto_url || null,
        p_idempotency: body.idempotency_key || null,
      })
      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message.replace(/^viaje_gasto_registrar:\s*/, "") }, { status: 400 })
      }
      return NextResponse.json({ success: true, ...(data as any), monto: -Math.abs(Number(monto)) })
    }

    const concepto = `Gasto - ${cat.charAt(0).toUpperCase() + cat.slice(1)}${observaciones ? `: ${observaciones}` : ""}`

    const { data: movimiento, error } = await supabase
      .from("billetera_movimientos")
      .insert({
        viajante_id: auth.user.id,
        tipo: "debito",
        medio: "efectivo",
        monto: -Math.abs(Number(monto)), // siempre negativo
        concepto,
        referencia_id: viaje_id || null,
        referencia_tipo: viaje_id ? "viaje" : null,
        creado_por: auth.user.id,
        fecha: nowArgentina(),
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      movimiento_id: movimiento.id,
      concepto,
      monto: -Math.abs(Number(monto)),
    })
  } catch (error: any) {
    console.error("[chofer] Error en POST gasto:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
