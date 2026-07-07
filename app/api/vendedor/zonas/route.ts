import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/zonas
// Zonas con la cantidad de clientes activos de cada una (vía localidad y
// asignación manual clientes_zonas). Para el armado del viaje de levantamiento.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const [{ data: zonas }, { data: locs }, { data: clientes }, { data: cz }] = await Promise.all([
      supabase.from("zonas").select("id, nombre, descripcion, dias_visita").order("nombre"),
      supabase.from("localidades").select("id, zona_id"),
      supabase.from("clientes").select("id, localidad_id, vendedor_id").eq("activo", true),
      supabase.from("clientes_zonas").select("cliente_id, zona_id"),
    ])

    const zonaDeLocalidad = new Map((locs || []).map((l: any) => [l.id, l.zona_id]))
    const vendedorDeCliente = new Map((clientes || []).map((c: any) => [c.id, c.vendedor_id]))
    const clientesPorZona = new Map<string, Set<string>>()
    const misPorZona = new Map<string, Set<string>>()
    const add = (zonaId: string | null, clienteId: string) => {
      if (!zonaId) return
      if (!clientesPorZona.has(zonaId)) clientesPorZona.set(zonaId, new Set())
      clientesPorZona.get(zonaId)!.add(clienteId)
      if (session.vendedorIds.includes(vendedorDeCliente.get(clienteId))) {
        if (!misPorZona.has(zonaId)) misPorZona.set(zonaId, new Set())
        misPorZona.get(zonaId)!.add(clienteId)
      }
    }
    for (const c of clientes || []) add(zonaDeLocalidad.get(c.localidad_id) || null, c.id)
    for (const par of cz || []) add(par.zona_id, par.cliente_id)

    return NextResponse.json({
      zonas: (zonas || []).map((z: any) => ({
        ...z,
        cantidad_clientes: clientesPorZona.get(z.id)?.size || 0,
        mis_clientes: misPorZona.get(z.id)?.size || 0,
      })),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/zonas:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
