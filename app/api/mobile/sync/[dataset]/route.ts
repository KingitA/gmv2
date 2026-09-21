import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMobile } from "@/lib/mobile/sesion"
import { DATASETS, puedeLeer } from "@/lib/mobile/sync/datasets"
import { responderParcial, responderSync } from "@/lib/mobile/sync/motor"

// GET /api/mobile/sync/<dataset>?cursor=<opaco>   (o ?ids=a,b: refresco parcial)
// Respuesta: RespuestaSync (lib/mobile/contrato.ts). Ver MOBILE.md.
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const sesion = await requireMobile(request)
  if (sesion.error) return sesion.error

  const { dataset } = await params
  const def = DATASETS.get(dataset)
  if (!def) return NextResponse.json({ error: `Dataset desconocido: ${dataset}` }, { status: 404 })
  if (!puedeLeer(def, sesion.roles)) return NextResponse.json({ error: "Sin acceso a este dataset." }, { status: 403 })

  try {
    const sp = new URL(request.url).searchParams
    const ctx = { request, supabase: await createClient(), admin: createAdminClient(), sesion }
    // ?ids=a,b ⇒ refresco parcial de esas filas (datasets que lo soportan)
    const ids = (sp.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean)
    if (ids.length) {
      if (!def.porIds) return NextResponse.json({ error: "Este dataset no admite refresco parcial." }, { status: 400 })
      return NextResponse.json(await responderParcial(ctx, def, ids), { headers: { "Cache-Control": "no-store" } })
    }
    const res = await responderSync(ctx, def, sp.get("cursor"))
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } })
  } catch (e: any) {
    console.error(`[mobile/sync] ${dataset}:`, e)
    return NextResponse.json({ error: e?.message || "Error de sincronización" }, { status: e?.status && e.status < 500 ? e.status : 500 })
  }
}
