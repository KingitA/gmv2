import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"

// GET /api/pendientes/alertas — cuántas cosas de la bandeja están ATRASADAS
// (más de una semana esperando). Lo lee la barra del ERP para pintar un aviso
// rojo en "Pendientes de revisar": la bandeja ya marcaba la rendición del
// viaje CARHUE en rojo, pero nadie la abría (auditoría 21/10: 28 días con
// $7,4 M "camino a oficina"). Regla del dueño: una rendición tarda como
// máximo 1 semana.
const DIAS_TOPE = 7

export async function GET() {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const limite = new Date(Date.now() - DIAS_TOPE * 24 * 60 * 60 * 1000).toISOString()
    const [rend, cobros] = await Promise.all([
      supabase.from("rendiciones").select("id", { count: "exact", head: true }).eq("estado", "abierta").lt("created_at", limite),
      supabase
        .from("pagos_clientes")
        .select("id", { count: "exact", head: true })
        .in("estado", ["pendiente", "pendiente_rendicion"])
        .lt("created_at", limite),
    ])
    for (const r of [rend, cobros]) if (r.error) throw r.error
    const rendiciones = rend.count ?? 0
    const cobrosAtrasados = cobros.count ?? 0
    return NextResponse.json({ atrasados: rendiciones + cobrosAtrasados, rendiciones, cobros: cobrosAtrasados, dias_tope: DIAS_TOPE })
  } catch (error: any) {
    console.error("[pendientes/alertas] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
