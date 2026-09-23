import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { esTripulante } from "@/lib/viajes/chofer"
import { cargarClienteViaje } from "@/lib/viajes/cliente-viaje"

// GET /api/chofer/viaje/[id]/cliente/[clienteId]
// Datos del cliente para la entrega: pedido, comprobantes pendientes, devoluciones del viaje.
// La lógica vive en lib/viajes/cliente-viaje.ts (la comparte la réplica de la app Chofer).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; clienteId: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId, clienteId } = await params

    // Verificar que el viaje es del chofer
    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || !(await esTripulante(supabase, viajeId, auth.user.id, viaje.chofer_id))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    return NextResponse.json(await cargarClienteViaje(supabase, viajeId, clienteId, viaje.estado))
  } catch (error: any) {
    console.error("[chofer] Error en GET cliente:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
