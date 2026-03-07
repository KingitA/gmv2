import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

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

    if (!estado) {
      return NextResponse.json(
        { error: "Estado es requerido" },
        { status: 400 }
      )
    }

    // Validar estados permitidos
    const estadosPermitidos = ["pendiente", "en_viaje", "entregado", "cancelado"]
    if (!estadosPermitidos.includes(estado)) {
      return NextResponse.json(
        { error: `Estado no válido. Debe ser: ${estadosPermitidos.join(", ")}` },
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
