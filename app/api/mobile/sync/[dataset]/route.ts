import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMobile } from "@/lib/mobile/sesion"
import { DATASETS, puedeLeer } from "@/lib/mobile/sync/datasets"
import { responderSync } from "@/lib/mobile/sync/motor"

// GET /api/mobile/sync/<dataset>?cursor=<opaco>
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
    const cursor = new URL(request.url).searchParams.get("cursor")
    const res = await responderSync(
      { request, supabase: await createClient(), admin: createAdminClient(), sesion },
      def,
      cursor,
    )
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } })
  } catch (e: any) {
    console.error(`[mobile/sync] ${dataset}:`, e)
    return NextResponse.json({ error: e?.message || "Error de sincronización" }, { status: e?.status && e.status < 500 ? e.status : 500 })
  }
}
