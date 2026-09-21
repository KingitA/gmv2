import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"

// POST /api/viajes/[id]/fondo — "a cuenta viaje": entrega de plata al chofer.
// Sale de CUALQUIER caja o banco hacia la billetera del chofer titular, en una
// sola transacción (RPC viaje_entregar_fondo): baja el saldo del origen,
// asienta la línea del libro que /caja muestra como
// "A cuenta viaje <NOMBRE> — retiró <QUIEN>", acredita la billetera y deja el
// registro en viajes_fondos (de dónde salió, quién retiró, quién entregó).
// El monto lo decide oficina: el sistema no calcula ni exige nada.
// Body: { origen_tipo: "CAJA"|"BANCO", origen_id, monto, retirado_por? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()
    const monto = Number(body.monto)

    if (!body.origen_id || !["CAJA", "BANCO"].includes(body.origen_tipo)) return errorJson("Elegí de qué caja o banco sale la plata")
    if (!monto || monto <= 0) return errorJson("El monto debe ser mayor a 0")

    const { data: viaje } = await supabase.from("viajes").select("id, chofer_id").eq("id", id).single()
    if (!viaje) return errorJson("Viaje no encontrado", 404)
    if (!viaje.chofer_id) return errorJson("Asigná el chofer titular antes de entregar plata")

    const { data, error } = await supabase.rpc("viaje_entregar_fondo", {
      p_viaje_id: id,
      p_origen_tipo: body.origen_tipo,
      p_origen_id: body.origen_id,
      p_monto: monto,
      p_retirado_por: body.retirado_por || viaje.chofer_id,
      p_usuario_id: auth.user.id,
    })
    if (error) {
      // Los RAISE de la función son mensajes de negocio (saldo insuficiente, etc.)
      return errorJson(error.message.replace(/^viaje_entregar_fondo:\s*/, ""))
    }

    return NextResponse.json({ success: true, ...(data as any) })
  } catch (error: any) {
    console.error("[viajes] Error en POST fondo:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
