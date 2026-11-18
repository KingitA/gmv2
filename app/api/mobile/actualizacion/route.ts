import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { jsonError, requireMobile } from "@/lib/mobile/sesion"
import { tocarDispositivo } from "@/lib/mobile/auth-server"
import { codeDelHeader, elegirActualizacion, SIN_ACTUALIZACION, type FilaVersion } from "@/lib/mobile/actualizacion"
import type { AppMovil, RespuestaActualizacion } from "@/lib/mobile/contrato"

// GET /api/mobile/actualizacion?app=vendedor|chofer|deposito — ¿hay una APK más nueva
// que la del equipo? (actualización con un botón, 17/11/2026). La app lo consulta al
// abrir, al volver a primer plano y cada ~30 min. El APK se baja DIRECTO del bucket
// privado "apks" con una URL firmada: nunca pasa por Vercel (límite de 4,5 MB).
// Ver MOBILE.md → "Actualización desde la app".
export const dynamic = "force-dynamic"

const APPS: AppMovil[] = ["vendedor", "chofer", "deposito"]
const VENCE_URL_S = 15 * 60

export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app") as AppMovil | null
  if (!app || !APPS.includes(app)) return jsonError(400, "App inválida")
  const sesion = await requireMobile(request, app)
  if (sesion.error) return sesion.error

  const code = codeDelHeader(request.headers.get("x-app-version-code"))
  // Última versión vista por equipo (la tabla de /admin/equipos)
  const revocado = await tocarDispositivo({ deviceId: sesion.deviceId, userId: sesion.user.id, app, appVersion: sesion.appVersion, appVersionCode: code })
  if (revocado) return jsonError(401, "Este dispositivo fue dado de baja.")

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("mobile_versiones")
    .select("version_name, version_code, archivo, tamano_bytes, sha256, notas, obligatoria")
    .eq("app", app)
    .order("version_code", { ascending: false })
    .limit(50)
  // Sin la migración 20261117b: no hay nada publicado (la app sigue normal)
  if (error) return NextResponse.json(SIN_ACTUALIZACION, { headers: { "Cache-Control": "no-store" } })

  const elegida = elegirActualizacion((data ?? []) as FilaVersion[], code)
  if (!elegida) return NextResponse.json(SIN_ACTUALIZACION, { headers: { "Cache-Control": "no-store" } })

  const { data: firmada, error: eUrl } = await admin.storage.from("apks").createSignedUrl(elegida.ultima.archivo, VENCE_URL_S)
  if (eUrl || !firmada?.signedUrl) {
    console.error("[mobile/actualizacion] URL firmada:", eUrl?.message)
    return NextResponse.json(SIN_ACTUALIZACION, { headers: { "Cache-Control": "no-store" } })
  }

  const body: RespuestaActualizacion = {
    hay: true,
    version_name: elegida.ultima.version_name,
    version_code: elegida.ultima.version_code,
    notas: elegida.ultima.notas,
    obligatoria: elegida.obligatoria,
    tamano_bytes: Number(elegida.ultima.tamano_bytes),
    sha256: elegida.ultima.sha256,
    url: firmada.signedUrl,
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}
