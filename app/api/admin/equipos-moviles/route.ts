import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/admin/equipos-moviles — equipos de las apps (vendedor / chofer / depósito):
// usuario, versión instalada y última conexión, más la última versión publicada de cada
// app (actualización con un botón, 17/11/2026). Solo admin. Pantalla: /admin/equipos.
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requirePermiso("equipos_moviles")
  if (auth.error) return auth.error
  const admin = createAdminClient()

  const { data: equipos, error } = await admin
    .from("mobile_dispositivos")
    .select("*")
    .order("ultimo_contacto_at", { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = [...new Set((equipos ?? []).map((e: any) => e.usuario_id).filter(Boolean))]
  const { data: usuarios } = ids.length ? await admin.from("usuarios").select("id, nombre, email").in("id", ids) : { data: [] }
  const nombre = new Map((usuarios ?? []).map((u: any) => [u.id, u.nombre || u.email]))

  // Última publicada por app (sin la migración 20261117b: ninguna)
  const { data: versiones } = await admin
    .from("mobile_versiones")
    .select("app, version_name, version_code, obligatoria, publicada_at")
    .order("version_code", { ascending: false })
    .limit(200)
  const ultimas: Record<string, unknown> = {}
  for (const v of versiones ?? []) if (!ultimas[v.app]) ultimas[v.app] = v

  return NextResponse.json(
    {
      equipos: (equipos ?? []).map((e: any) => ({
        device_id: e.device_id,
        app: e.app,
        usuario: e.usuario_id ? nombre.get(e.usuario_id) ?? null : null,
        app_version: e.app_version,
        app_version_code: e.app_version_code ?? null,
        ultimo_contacto_at: e.ultimo_contacto_at,
        revocado: !!e.revocado,
      })),
      ultimas,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
