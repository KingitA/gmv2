import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMobile } from "@/lib/mobile/sesion"
import { motivoNoSuena } from "@/lib/mobile/sonar"
import { sumarDiasISO, hoyISO } from "@/lib/formato"

// GET /api/mobile/dispositivos — equipos de depósito para "Buscar el equipo de un compañero"
// (app depósito, 20/11/2026): quién lo usa, última conexión y si se lo puede hacer sonar.
// Solo equipos de depósito, no dados de baja, conectados en los últimos 90 días.
export const dynamic = "force-dynamic"

export interface EquipoCompanero {
  device_id: string
  app: "deposito"
  usuario: string | null
  ultimo_contacto_at: string | null
  /** null = se puede hacer sonar; si no, por qué no */
  motivo: string | null
  es_este: boolean
}

export async function GET(request: Request) {
  const sesion = await requireMobile(request, "deposito")
  if (sesion.error) return sesion.error
  const admin = createAdminClient()
  const desde = `${sumarDiasISO(hoyISO(), -90)}T00:00:00-03:00`
  const { data, error } = await admin
    .from("mobile_dispositivos")
    .select("*")
    .eq("app", "deposito")
    .eq("revocado", false)
    .gte("ultimo_contacto_at", desde)
    .order("ultimo_contacto_at", { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ equipos: [] }, { headers: { "Cache-Control": "no-store" } })

  const ids = [...new Set((data ?? []).map((e: any) => e.usuario_id).filter(Boolean))]
  const { data: usuarios } = ids.length ? await admin.from("usuarios").select("id, nombre, email").in("id", ids) : { data: [] as any[] }
  const nombre = new Map((usuarios ?? []).map((u: any) => [u.id, u.nombre || u.email]))
  const equipos: EquipoCompanero[] = (data ?? []).map((e: any) => ({
    device_id: e.device_id,
    app: "deposito",
    usuario: e.usuario_id ? nombre.get(e.usuario_id) ?? null : null,
    ultimo_contacto_at: e.ultimo_contacto_at,
    motivo: motivoNoSuena(e),
    es_este: e.device_id === sesion.deviceId,
  }))
  return NextResponse.json({ equipos }, { headers: { "Cache-Control": "no-store" } })
}
