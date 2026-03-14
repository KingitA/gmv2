import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    // Obtener todas las sesiones activas con info del operario
    const { data: sesiones, error } = await supabase
      .from("picking_sesiones")
      .select(`
        id, pedido_id, estado, usuario_email, usuario_id, fecha_inicio,
        pedidos(
          id, numero_pedido,
          pedidos_detalle(id, cantidad, cantidad_preparada, estado_item)
        )
      `)
      .in("estado", ["EN_PROGRESO", "en_progreso"])

    if (error) throw error

    // Buscar nombres de usuarios
    const userIds = (sesiones || []).map(s => s.usuario_id).filter(Boolean)
    let userNames: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: usuarios } = await supabase
        .from("usuarios")
        .select("id, nombre")
        .in("id", userIds)
      if (usuarios) {
        userNames = Object.fromEntries(usuarios.map(u => [u.id, u.nombre]))
      }
    }

    // Mapear por pedido_id
    const pickingStatus: Record<string, {
      operario: string
      estado: string
      inicio: string | null
      progreso: { total: number; preparados: number; faltantes: number; pendientes: number }
    }> = {}

    for (const s of (sesiones || [])) {
      const detalles = (s as any).pedidos?.pedidos_detalle || []
      const total = detalles.length
      const preparados = detalles.filter((d: any) => d.estado_item === "COMPLETO" || d.estado_item === "PARCIAL").length
      const faltantes = detalles.filter((d: any) => d.estado_item === "FALTANTE").length
      const pendientes = total - preparados - faltantes

      const operarioNombre = userNames[s.usuario_id] || s.usuario_email?.split("@")[0] || "Operario"

      pickingStatus[s.pedido_id] = {
        operario: operarioNombre,
        estado: s.estado,
        inicio: s.fecha_inicio,
        progreso: { total, preparados, faltantes, pendientes },
      }
    }

    return NextResponse.json(pickingStatus)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
