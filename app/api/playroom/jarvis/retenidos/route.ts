import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { buscarHerramienta, contextoNuevo } from "@/lib/jarvis/herramientas"
import { liberarCliente } from "@/lib/viajes/retencion"

// Clientes con entregas retenidas (Ajustes de Jarvis). GET: la lista. POST: liberar uno.
// Liberar lo hace una persona: queda a su nombre en el cliente y en la bitácora.

export async function GET() {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const db = createAdminClient()
  try {
    const r = await buscarHerramienta("clientes_retenidos")!.ejecutar(contextoNuevo(db, auth.user.id), {})
    return NextResponse.json({ filas: r.datos })
  } catch (e) {
    console.error("[jarvis] retenidos", e)
    return NextResponse.json({ filas: [] })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  let b: { cliente_id?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const clienteId = typeof b.cliente_id === "string" ? b.cliente_id : ""
  if (!clienteId) return NextResponse.json({ error: "Falta el cliente." }, { status: 400 })
  const db = createAdminClient()
  const { data: c } = await db.from("clientes").select("nombre, retener_entregas, retener_motivo, retener_desde").eq("id", clienteId).maybeSingle()
  if (!c?.retener_entregas) return NextResponse.json({ error: "Ese cliente no está retenido." }, { status: 409 })
  try {
    // La bitácora la escribe la base (trigger clientes_registrar_retencion) en el mismo paso que el cambio
    const r = await liberarCliente(db, clienteId, auth.user.id)
    return NextResponse.json({ ok: true, detalle: `Entregas liberadas a ${c.nombre}.${r.paradasLiberadas ? ` Se destrabaron ${r.paradasLiberadas} parada(s).` : ""} Quedó a tu nombre.` })
  } catch (e) {
    console.error("[jarvis] liberar", e)
    return NextResponse.json({ error: "No se pudo liberar." }, { status: 500 })
  }
}
