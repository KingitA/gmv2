import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { revisionDiaria, ultimaRevision } from "@/lib/jarvis/resumen"
import { leerReglas } from "@/lib/jarvis/reglas"

// "Lo que Jarvis notó" (contrato §4.5): los avisos a la vista, de la bandeja de Jarvis.
export async function GET() {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const db = createAdminClient()
  const { reglas } = await leerReglas(db)
  let q = db.from("ai_agenda_events").select("id, tono, title, description, acciones, severidad, created_at, updated_at")
    .eq("event_type", "aviso").eq("status", "pendiente")
  if (reglas.regla_avisos === "urgentes") q = q.eq("tono", "alerta")
  const [{ data, error }, ultima] = await Promise.all([q.order("severidad", { ascending: false }).limit(12), ultimaRevision(db)])
  if (error) return NextResponse.json({ items: [] })
  return NextResponse.json({
    items: (data ?? []).map((a: any) => ({ id: a.id, tono: a.tono ?? "atencion", titulo: a.title, detalle: a.description ?? undefined, acciones: a.acciones ?? [], desde: a.created_at })),
    revisado_at: ultima,
  })
}

// "Revisar ahora": corre los vigías y el resumen a pedido. Máximo una vez cada 10 minutos.
export const maxDuration = 120

export async function POST(_req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const db = createAdminClient()
  const ultima = await ultimaRevision(db)
  if (ultima && Date.now() - Date.parse(ultima) < 10 * 60_000) {
    return NextResponse.json({ error: "Jarvis revisó hace menos de 10 minutos. Probá en un rato." }, { status: 429 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await revisionDiaria(db, auth.user.id)) })
  } catch (e) {
    console.error("[jarvis] revisar ahora", e)
    return NextResponse.json({ error: "No se pudo revisar ahora." }, { status: 500 })
  }
}
