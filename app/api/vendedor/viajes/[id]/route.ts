import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { detalleViajeVendedor } from "@/lib/vendedor/viajes-reparto"
import { requireVendedor } from "@/lib/vendedor/session"

async function getViajePropio(supabase: any, id: string, vendedorIds: string[]) {
  const { data: viaje } = await supabase
    .from("viajes")
    .select("id, nombre, estado, tipo, vendedor_id, fecha_inicio, fecha_fin_estimada, viaje_zonas(zona_id, zonas(id, nombre))")
    .eq("id", id)
    .eq("tipo", "levantamiento")
    .maybeSingle()
  if (!viaje || !vendedorIds.includes(viaje.vendedor_id)) return null
  return viaje
}

// GET /api/vendedor/viajes/[id] — detalle de un viaje del calendario de reparto (03/11/2026):
// sus clientes de la zona, sus pedidos en el viaje y, cuando ya salió, cómo fue cada parada
// (entrega, cobro, comprobantes). lib/vendedor/viajes-reparto.ts
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const detalle = await detalleViajeVendedor(supabase as any, createAdminClient() as any, session.vendedorIds, id)
    if (!detalle) return NextResponse.json({ error: "Ese viaje no está en tu calendario." }, { status: 404 })
    return NextResponse.json(detalle)
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/viajes/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH (viajes de levantamiento viejos, APKs anteriores a 03/11/2026)
// PATCH /api/vendedor/viajes/[id]
// { accion: "cliente_no_va", cliente_id, no_va } — marcar/desmarcar cliente
// { accion: "estado", estado: "completado" | "en_curso" } — cerrar/reabrir viaje
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()

    const viaje = await getViajePropio(supabase, id, session.vendedorIds)
    if (!viaje) {
      return NextResponse.json({ error: "Viaje inexistente o no asignado a vos." }, { status: 404 })
    }

    if (body.accion === "cliente_no_va") {
      if (!body.cliente_id) return NextResponse.json({ error: "Se requiere cliente_id." }, { status: 400 })
      const { error } = await supabase
        .from("viajes_clientes")
        .upsert(
          { viaje_id: id, cliente_id: body.cliente_id, estado: body.no_va ? "no_va" : "pendiente" },
          { onConflict: "viaje_id,cliente_id" }
        )
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (body.accion === "estado") {
      if (!["completado", "en_curso"].includes(body.estado)) {
        return NextResponse.json({ error: "Estado inválido." }, { status: 400 })
      }
      const { error } = await supabase.from("viajes").update({ estado: body.estado }).eq("id", id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 })
  } catch (error: any) {
    console.error("[vendedor] Error en PATCH /api/vendedor/viajes/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
