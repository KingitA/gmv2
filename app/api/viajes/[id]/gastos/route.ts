import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"

// PATCH /api/viajes/[id]/gastos — oficina aprueba o rechaza un gasto del viaje.
// Aprobar: egreso en el libro imputado al viaje. Rechazar (con motivo): la
// plata vuelve a figurar en la billetera del chofer (la debe).
// Body: { gasto_id, aprobar: boolean, motivo? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()
    if (!body.gasto_id || typeof body.aprobar !== "boolean") return errorJson("gasto_id y aprobar son requeridos")

    const { data: gasto } = await supabase
      .from("viajes_gastos")
      .select("id")
      .eq("id", body.gasto_id)
      .eq("viaje_id", id)
      .single()
    if (!gasto) return errorJson("Gasto no encontrado", 404)

    const { data, error } = await supabase.rpc("viaje_gasto_resolver", {
      p_gasto_id: body.gasto_id,
      p_aprobar: body.aprobar,
      p_usuario_id: auth.user.id,
      p_motivo: body.motivo || null,
    })
    if (error) return errorJson(error.message.replace(/^viaje_gasto_resolver:\s*/, ""))

    return NextResponse.json({ success: true, ...(data as any) })
  } catch (error: any) {
    console.error("[viajes] Error en PATCH gastos:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
