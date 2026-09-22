import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"
import { viajeEditable, puedeEditarInstrucciones } from "@/lib/viajes/estados"

// PATCH /api/viajes/[id]/paradas — oficina arma la hoja.
//  { orden: [paradaId, ...] }                    reordenar (solo programado)
//  { parada_id, exigir_cobro_anterior?, exigir_cobro_actual?, bloquear_entrega?,
//    motivo_bloqueo?, nota_oficina? }             instrucción (hasta que el chofer finaliza)
//  { agregar_cliente_id }                         parada sin pedido: pasar solo a cobrar
//  { quitar_parada_id }                           solo paradas sin pedidos, viaje programado
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

    const { data: viaje } = await supabase.from("viajes").select("id, estado, tipo").eq("id", id).single()
    if (!viaje) return errorJson("Viaje no encontrado", 404)
    if (viaje.tipo !== "reparto") return errorJson("Este viaje no es de reparto")

    if (Array.isArray(body.orden)) {
      if (!viajeEditable(viaje.estado)) return errorJson("El viaje ya fue despachado: el orden quedó fijo")
      const ids: string[] = body.orden.filter(Boolean)
      const res = await Promise.all(
        ids.map((paradaId, i) =>
          supabase.from("viajes_paradas").update({ orden: i + 1 }).eq("id", paradaId).eq("viaje_id", id),
        ),
      )
      const fallo = res.find((r) => r.error)
      if (fallo?.error) throw fallo.error
      return NextResponse.json({ success: true })
    }

    if (body.agregar_cliente_id) {
      if (!viajeEditable(viaje.estado)) return errorJson("El viaje ya fue despachado")
      const { data: ult } = await supabase
        .from("viajes_paradas")
        .select("orden")
        .eq("viaje_id", id)
        .order("orden", { ascending: false })
        .limit(1)
      const { error } = await supabase.from("viajes_paradas").insert({
        viaje_id: id,
        cliente_id: body.agregar_cliente_id,
        orden: (ult?.[0]?.orden || 0) + 1,
        exigir_cobro_anterior: true,
        nota_oficina: body.nota_oficina || "Pasar a cobrar",
      })
      if (error) {
        if (error.code === "23505") return errorJson("Ese cliente ya está en la hoja de ruta")
        throw error
      }
      return NextResponse.json({ success: true })
    }

    if (body.quitar_parada_id) {
      if (!viajeEditable(viaje.estado)) return errorJson("El viaje ya fue despachado")
      const { data: parada } = await supabase
        .from("viajes_paradas")
        .select("id, cliente_id")
        .eq("id", body.quitar_parada_id)
        .eq("viaje_id", id)
        .single()
      if (!parada) return errorJson("Parada no encontrada", 404)
      const { count } = await supabase
        .from("pedidos")
        .select("id", { count: "exact", head: true })
        .eq("viaje_id", id)
        .eq("cliente_id", parada.cliente_id)
        .neq("estado", "eliminado")
      if (count) return errorJson("La parada tiene pedidos: quitá primero los pedidos del viaje")
      const { error } = await supabase.from("viajes_paradas").delete().eq("id", parada.id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (body.parada_id) {
      if (!puedeEditarInstrucciones(viaje.estado)) return errorJson("El viaje ya está en rendición")
      const cambios: Record<string, any> = {}
      for (const campo of ["exigir_cobro_anterior", "exigir_cobro_actual", "bloquear_entrega"]) {
        if (body[campo] !== undefined) cambios[campo] = Boolean(body[campo])
      }
      for (const campo of ["motivo_bloqueo", "nota_oficina"]) {
        if (body[campo] !== undefined) cambios[campo] = String(body[campo] || "").trim() || null
      }
      if (cambios.bloquear_entrega === false) cambios.motivo_bloqueo = null
      if (!Object.keys(cambios).length) return errorJson("Nada para cambiar")
      const { error } = await supabase.from("viajes_paradas").update(cambios).eq("id", body.parada_id).eq("viaje_id", id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return errorJson("Acción no reconocida")
  } catch (error: any) {
    console.error("[viajes] Error en PATCH paradas:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
