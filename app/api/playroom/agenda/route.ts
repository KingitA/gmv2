import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis, puedeConfirmar } from "@/lib/jarvis/acceso"
import { agendaPendiente, crearRecordatorio, ErrorAgenda } from "@/lib/jarvis/agenda"

// Agenda de Jarvis: propuestas para decidir y recordatorios (lib/jarvis/agenda.ts).
export async function GET() {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  try {
    const items = await agendaPendiente(createAdminClient())
    return NextResponse.json({
      items: items.map((i) => ({ ...i, puedo_decidir: puedeConfirmar(auth.roles, i.mueve_dinero) })),
    })
  } catch (e) {
    console.error("[jarvis] agenda", e)
    return NextResponse.json({ items: [] })
  }
}

// Recordatorio cargado a mano desde la pantalla.
export async function POST(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  let b: { titulo?: unknown; fecha?: unknown; detalle?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  try {
    const id = await crearRecordatorio(createAdminClient(), {
      titulo: String(b.titulo ?? ""), fecha: String(b.fecha ?? ""), detalle: typeof b.detalle === "string" ? b.detalle : null, usuarioId: auth.user.id,
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    if (e instanceof ErrorAgenda) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error("[jarvis] agenda alta", e)
    return NextResponse.json({ error: "No se pudo agendar." }, { status: 500 })
  }
}
