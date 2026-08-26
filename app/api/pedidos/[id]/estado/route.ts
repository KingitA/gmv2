import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { nowArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'
import { puedeCambiarEstado, ESTADO_LABEL } from "@/lib/pedidos/estados"

// PATCH: cambio manual de estado. Solo acepta transiciones del flujo
// (lib/pedidos/estados.ts): nunca se vuelve atrás de facturado.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()
    const { estado } = body

    if (!estado || !(estado in ESTADO_LABEL)) {
      return NextResponse.json(
        { error: `Estado no válido. Debe ser: ${Object.keys(ESTADO_LABEL).join(", ")}` },
        { status: 400 }
      )
    }

    const { data: actual, error: fetchError } = await supabase
      .from("pedidos").select("id, estado").eq("id", id).single()
    if (fetchError || !actual) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    if (!puedeCambiarEstado(actual.estado, estado)) {
      return NextResponse.json(
        { error: `No se puede pasar un pedido de "${ESTADO_LABEL[actual.estado] || actual.estado}" a "${ESTADO_LABEL[estado]}".` },
        { status: 400 }
      )
    }

    // Actualizar estado del pedido
    const { data: pedido, error } = await supabase
      .from("pedidos")
      .update({ estado, updated_at: nowArgentina() })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("[v0] Error al actualizar estado:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      { message: "Estado actualizado correctamente", pedido },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[v0] Error en PATCH /api/pedidos/[id]/estado:", error)
    return NextResponse.json(
      { error: "Error al actualizar estado" },
      { status: 500 }
    )
  }
}
