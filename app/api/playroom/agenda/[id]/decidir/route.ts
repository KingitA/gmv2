import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { decidir, ErrorAgenda } from "@/lib/jarvis/agenda"

// Una persona decide una propuesta o marca un recordatorio: Sí / No / Posponer.
// Queda QUIÉN, CUÁNDO y POR QUÉ (bitácora inborrable). Lo que mueve plata: solo admin.
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const { id } = await params
  let b: { decision?: unknown; nota?: unknown; fecha?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const decision = b.decision === "si" || b.decision === "no" || b.decision === "posponer" ? b.decision : null
  if (!decision) return NextResponse.json({ error: "Falta la decisión." }, { status: 400 })
  try {
    const r = await decidir(createAdminClient(), {
      id, usuarioId: auth.user.id, roles: auth.roles, decision,
      nota: typeof b.nota === "string" ? b.nota : null, fecha: typeof b.fecha === "string" ? b.fecha : null,
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErrorAgenda) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error("[jarvis] decidir", e)
    return NextResponse.json({ error: "No se pudo anotar la decisión. No se hizo nada." }, { status: 500 })
  }
}
