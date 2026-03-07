import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const chofer_id = searchParams.get("chofer_id")

    if (!chofer_id) {
      return NextResponse.json(
        { error: "chofer_id es requerido" },
        { status: 400 }
      )
    }

    const { data: viajes, error } = await supabase
      .from("viajes")
      .select(`
        id,
        nombre,
        fecha,
        estado,
        vehiculo,
        dinero_nafta,
        gastos_peon,
        gastos_hotel,
        gastos_adicionales,
        observaciones,
        created_at
      `)
      .eq("chofer_id", chofer_id)
      .order("fecha", { ascending: false })

    if (error) {
      console.error("[v0] Error al obtener viajes:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const viajesConDatos = await Promise.all(
      viajes.map(async (viaje) => {
        const { count: pedidos_count } = await supabase
          .from("pedidos")
          .select("*", { count: "exact", head: true })
          .eq("viaje_id", viaje.id)

        const { data: pedidos } = await supabase
          .from("pedidos")
          .select("total")
          .eq("viaje_id", viaje.id)

        const total_facturado = pedidos?.reduce(
          (sum, p) => sum + (Number(p.total) || 0),
          0
        ) || 0

        const { data: pedidosConZona } = await supabase
          .from("pedidos")
          .select(`
            clientes!inner(
              localidad_id,
              localidades!inner(
                nombre,
                zona_id,
                zonas!inner(nombre)
              )
            )
          `)
          .eq("viaje_id", viaje.id)

        const zonas = [
          ...new Set(
            pedidosConZona
              ?.map((p: any) => p.clientes?.localidades?.zonas?.nombre)
              .filter(Boolean)
          ),
        ]

        return {
          ...viaje,
          pedidos_count: pedidos_count || 0,
          total_facturado,
          zonas: zonas.join(", "),
        }
      })
    )

    return NextResponse.json({ viajes: viajesConDatos }, { status: 200 })
  } catch (error: any) {
    console.error("[v0] Error en GET /api/viajes:", error)
    return NextResponse.json(
      { error: "Error al obtener viajes" },
      { status: 500 }
    )
  }
}
