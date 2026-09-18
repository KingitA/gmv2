import { createServerClient as createSupabaseServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"

export { createServerClient } from "@supabase/ssr"

/**
 * Token de las apps móviles: `Authorization: Bearer <access_token>`.
 * La web nunca manda este header (usa cookie), así que para la web nada cambia.
 * Ver MOBILE.md → "Auth de dispositivo".
 */
async function bearerToken(): Promise<string | null> {
  try {
    const h = await headers()
    const auth = h.get("authorization") || ""
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
    return m ? m[1] : null
  } catch {
    // Fuera de un request (build, scripts): sin bearer
    return null
  }
}

export async function createClient() {
  const token = await bearerToken()

  if (token) {
    // Sesión de dispositivo: sin cookies; el JWT viaja como Authorization en cada
    // query (RLS se evalúa como ese usuario) y auth.getUser() lo valida contra
    // Supabase Auth. requireAuth()/requireVendedor() funcionan sin cambios.
    const client = createSupabaseServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const getUser = client.auth.getUser.bind(client.auth)
    client.auth.getUser = ((jwt?: string) => getUser(jwt ?? token)) as typeof client.auth.getUser
    return client
  }

  const cookieStore = await cookies()

  return createSupabaseServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The "setAll" method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}
