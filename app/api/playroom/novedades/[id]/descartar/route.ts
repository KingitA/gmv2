import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"

// Descartar un aviso de "Lo que Jarvis notó". Queda anotado quién y cuándo
// (trigger → ai_registro). El aviso no vuelve salvo que empeore.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const { id } = await params
  let nota: string | null = null
  try { const b = await req.json(); nota = typeof b?.nota === "string" && b.nota.trim() ? b.nota.trim().slice(0, 500) : null } catch { /* sin nota */ }
  const ahora = new Date().toISOString()
  const { data, error } = await createAdminClient().from("ai_agenda_events")
    .update({ status: "cancelada", cerrado_por: auth.user.id, cerrado_at: ahora, cierre_nota: nota ?? "Descartado", updated_at: ahora })
    .eq("id", id).eq("event_type", "aviso").eq("status", "pendiente").select("id").maybeSingle()
  if (error) return NextResponse.json({ error: "No se pudo descartar." }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Ese aviso ya no está." }, { status: 404 })
  return NextResponse.json({ ok: true })
}
