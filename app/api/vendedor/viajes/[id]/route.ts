import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
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

// GET /api/vendedor/viajes/[id]
// Detalle del viaje de levantamiento: clientes de las zonas del viaje con su
// estado (pedido_levantado / pendiente / no_va), saldo y último pedido del viaje.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const viaje = await getViajePropio(supabase, id, session.vendedorIds)
    if (!viaje) {
      return NextResponse.json({ error: "Viaje inexistente o no asignado a vos." }, { status: 404 })
    }
    const zonaIds = (viaje.viaje_zonas || []).map((vz: any) => vz.zona_id)

    // Clientes de las zonas: por localidad y por asignación manual (clientes_zonas).
    // SOLO los clientes del vendedor de la sesión.
    const { data: locs } = await supabase.from("localidades").select("id, zona_id").in("zona_id", zonaIds)
    const locIds = (locs || []).map((l: any) => l.id)

    const clientesMap = new Map<string, any>()
    if (locIds.length) {
      const { data: porLocalidad } = await supabase
        .from("clientes")
        .select("id, nombre, localidad, telefono, localidad_id")
        .eq("activo", true)
        .in("vendedor_id", session.vendedorIds)
        .in("localidad_id", locIds)
      for (const c of porLocalidad || []) clientesMap.set(c.id, c)
    }
    const { data: cz } = await supabase.from("clientes_zonas").select("cliente_id").in("zona_id", zonaIds)
    const czIds = (cz || []).map((x: any) => x.cliente_id).filter((cid: string) => !clientesMap.has(cid))
    if (czIds.length) {
      const { data: manuales } = await supabase
        .from("clientes")
        .select("id, nombre, localidad, telefono, localidad_id")
        .eq("activo", true)
        .in("vendedor_id", session.vendedorIds)
        .in("id", czIds)
      for (const c of manuales || []) clientesMap.set(c.id, c)
    }
    const clienteIds = [...clientesMap.keys()]

    // Saldos, marcas no_va y pedidos del viaje (desde fecha_inicio) en batch
    const chunk = <T,>(arr: T[], n: number) => {
      const out: T[][] = []
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
      return out
    }

    const saldos = new Map<string, number>()
    const noVa = new Set<string>()
    const pedidoDe = new Map<string, any>()
    for (const ids of chunk(clienteIds, 150)) {
      const [{ data: s }, { data: vc }, { data: peds }] = await Promise.all([
        supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", ids),
        supabase.from("viajes_clientes").select("cliente_id, estado").eq("viaje_id", id).in("cliente_id", ids),
        supabase
          .from("pedidos")
          .select("id, cliente_id, numero_pedido, total, estado, fecha, created_at")
          .in("cliente_id", ids)
          .gte("fecha", viaje.fecha_inicio)
          .neq("estado", "eliminado")
          .is("eliminado_at", null)
          .order("created_at", { ascending: false }),
      ])
      for (const row of s || []) saldos.set(row.cliente_id, Number(row.saldo_actual) || 0)
      for (const row of vc || []) if (row.estado === "no_va") noVa.add(row.cliente_id)
      for (const p of peds || []) if (!pedidoDe.has(p.cliente_id)) pedidoDe.set(p.cliente_id, p)
    }

    const clientes = clienteIds
      .map((cid) => {
        const c = clientesMap.get(cid)
        const pedido = pedidoDe.get(cid) || null
        return {
          id: c.id,
          nombre: c.nombre,
          localidad: c.localidad,
          telefono: c.telefono,
          saldo_actual: saldos.get(cid) || 0,
          estado_viaje: noVa.has(cid) ? "no_va" : pedido ? "pedido_levantado" : "pendiente",
          pedido,
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))

    return NextResponse.json({
      viaje: {
        id: viaje.id,
        nombre: viaje.nombre,
        estado: viaje.estado,
        fecha_inicio: viaje.fecha_inicio,
        fecha_fin_estimada: viaje.fecha_fin_estimada,
        zonas: (viaje.viaje_zonas || []).map((vz: any) => vz.zonas).filter(Boolean),
      },
      clientes,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/viajes/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

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
