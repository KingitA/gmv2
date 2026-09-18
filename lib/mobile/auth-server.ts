import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import type { AppMovil, SesionMovil } from "./contrato"
import { ROLES_APP } from "./contrato"

// Auth de dispositivo. El APK no lleva ninguna key de Supabase: el login y el
// refresh pasan por estas rutas, que usan la anon key del servidor. El refresh
// token vive en el almacenamiento seguro del dispositivo (Android Keystore).

/** Cliente efímero sin persistencia (una instancia por request). */
export function authClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export async function rolesDe(userId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin.from("usuarios_roles").select("roles(nombre)").eq("usuario_id", userId)
  return (data || []).map((r: any) => r.roles?.nombre).filter(Boolean)
}

export function habilitado(app: AppMovil, roles: string[]) {
  return ROLES_APP[app].some((r) => roles.includes(r))
}

/** Nombre legible del usuario (tabla usuarios), o null. */
export async function nombreDe(userId: string): Promise<string | null> {
  try {
    const { data } = await createAdminClient().from("usuarios").select("nombre").eq("id", userId).maybeSingle()
    return data?.nombre ?? null
  } catch {
    return null
  }
}

export function aSesionMovil(session: any, roles: string[], nombre: string | null = null): SesionMovil {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    user: { id: session.user.id, email: session.user.email ?? null, nombre },
    roles,
  }
}

/**
 * Registro de dispositivos (best effort: si la migración no está aplicada no
 * rompe el login). Devuelve true si el dispositivo está revocado.
 */
export async function tocarDispositivo(args: {
  deviceId: string | null
  userId: string
  app: string
  appVersion: string | null
}): Promise<boolean> {
  if (!args.deviceId) return false
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from("mobile_dispositivos")
      .select("revocado")
      .eq("device_id", args.deviceId)
      .eq("app", args.app)
      .maybeSingle()
    if (data?.revocado) return true
    await admin.from("mobile_dispositivos").upsert(
      {
        device_id: args.deviceId,
        app: args.app,
        usuario_id: args.userId,
        app_version: args.appVersion,
        ultimo_contacto_at: new Date().toISOString(),
      },
      { onConflict: "device_id,app" },
    )
  } catch {
    /* tabla ausente: ignorar */
  }
  return false
}
