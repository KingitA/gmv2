import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { canAccess, getHomeForRoles } from "@/lib/role-utils"

// Vercel Hobby middleware timeout = 1.5s. Falla rápido si Supabase no responde.
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), 1200)
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(id))
}

export async function updateSession(request: NextRequest) {
  // Preparar headers custom para propagar roles a server components
  const requestHeaders = new Headers(request.headers)

  // Supabase client con manejo de cookies
  let cookiesToSet: { name: string; value: string; options: any }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookies) {
          cookiesToSet = cookies
        },
      },
      global: { fetch: fetchWithTimeout },
    },
  )

  const pathname = request.nextUrl.pathname

  // API routes manejan su propia auth con requireAuth()
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Rutas públicas que no requieren autenticación
  const publicRoutes = ["/auth/login", "/auth/sign-up", "/auth/error", "/auth/sign-up-success", "/auth/pendiente", "/auth/cambiar-password"]
  const isPublicRoute = publicRoutes.some(r => pathname === r || pathname.startsWith(r + "/"))

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (isPublicRoute) return applyResponse(NextResponse.next({ request: { headers: requestHeaders } }), cookiesToSet)
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return applyResponse(NextResponse.redirect(url), cookiesToSet)
  }

  // Rutas de auth con usuario ya logueado: dejar pasar (ej: cambiar contraseña)
  if (isPublicRoute) return applyResponse(NextResponse.next({ request: { headers: requestHeaders } }), cookiesToSet)

  // Obtener roles del usuario (query indexada)
  const { data: rolesData } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles: string[] = (rolesData || [])
    .map((r: any) => r.roles?.nombre)
    .filter(Boolean)

  // Inyectar roles en request headers para que layout/server components los lean sin segunda query
  requestHeaders.set("x-user-roles", roles.join(","))

  // Verificar acceso a la ruta
  if (!canAccess(pathname, roles)) {
    const home = getHomeForRoles(roles) ?? "/auth/login"
    const url = request.nextUrl.clone()
    url.pathname = home
    return applyResponse(NextResponse.redirect(url), cookiesToSet)
  }

  return applyResponse(NextResponse.next({ request: { headers: requestHeaders } }), cookiesToSet)
}

function applyResponse(response: NextResponse, cookiesToSet: { name: string; value: string; options: any }[]) {
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options)
  }
  return response
}
