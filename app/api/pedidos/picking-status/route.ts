import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// Estado de preparación por pedido para el listado del ERP. Un pedido lo pueden
// preparar varias personas: `operario` lista a todas (sesiones activas + quienes
// registraron renglones en picking_items).
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

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

    // Nombres de usuarios de las sesiones
    const userIds = [...new Set((sesiones || []).map(s => s.usuario_id).filter(Boolean))]
    let userNames: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: usuarios } = await supabase.from("usuarios").select("id, nombre").in("id", userIds)
      if (usuarios) userNames = Object.fromEntries(usuarios.map(u => [u.id, u.nombre]))
    }

    // Quiénes ya prepararon renglones en esos pedidos (picking_items)
    const pedidoIds = [...new Set((sesiones || []).map(s => s.pedido_id))]
    const nombresPorPedido = new Map<string, Set<string>>()
    if (pedidoIds.length > 0) {
      const { data: regs } = await supabase
        .from("picking_items")
        .select("usuario_nombre, pedidos_detalle!inner(pedido_id)")
        .in("pedidos_detalle.pedido_id", pedidoIds)
      for (const r of (regs || []) as any[]) {
        const pid = r.pedidos_detalle?.pedido_id
        if (!pid || !r.usuario_nombre) continue
        if (!nombresPorPedido.has(pid)) nombresPorPedido.set(pid, new Set())
        nombresPorPedido.get(pid)!.add(r.usuario_nombre)
      }
    }

    const pickingStatus: Record<string, {
      operario: string
      operarios: string[]
      estado: string
      inicio: string | null
      progreso: { total: number; preparados: number; faltantes: number; pendientes: number }
    }> = {}

    for (const s of (sesiones || [])) {
      const nombre = userNames[s.usuario_id] || s.usuario_email?.split("@")[0] || "Operario"
      const prev = pickingStatus[s.pedido_id]
      const nombres = new Set<string>(prev?.operarios || [])
      nombres.add(nombre)
      for (const n of nombresPorPedido.get(s.pedido_id) || []) nombres.add(n)

      const detalles = (s as any).pedidos?.pedidos_detalle || []
      const total = detalles.length
      const preparados = detalles.filter((d: any) => d.estado_item === "COMPLETO" || d.estado_item === "PARCIAL").length
      const faltantes = detalles.filter((d: any) => d.estado_item === "FALTANTE").length
      const pendientes = total - preparados - faltantes

      const inicio = prev?.inicio && s.fecha_inicio ? (prev.inicio < s.fecha_inicio ? prev.inicio : s.fecha_inicio) : (prev?.inicio || s.fecha_inicio)
      const operarios = [...nombres]
      pickingStatus[s.pedido_id] = {
        operario: operarios.join(", "),
        operarios,
        estado: s.estado,
        inicio,
        progreso: { total, preparados, faltantes, pendientes },
      }
    }

    return NextResponse.json(pickingStatus)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
