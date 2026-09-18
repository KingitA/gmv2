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
    const cors = corsHeaders(request)
    // Preflight de las apps móviles (Authorization + Content-Type ⇒ siempre hay preflight)
    if (request.method === "OPTIONS" && cors) return new NextResponse(null, { status: 204, headers: cors })
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
    return res
  }

  // Rutas públicas que no requieren autenticación
  const publicRoutes = ["/auth/login", "/auth/sign-up", "/auth/error", "/auth/sign-up-success", "/auth/pendiente", "/auth/cambiar-password"]
  const isPublicRoute = publicRoutes.some(r => pathname === r || pathname.startsWith(r + "/"))

  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

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

// Orígenes de las apps Capacitor (Android sirve el bundle local en https://localhost)
// + el dev server de Vite. Solo estos reciben CORS; la web es same-origin y no lo
// necesita. Las apps autentican con Bearer (sin cookies) ⇒ sin Allow-Credentials.
// Ver MOBILE.md → "Auth de dispositivo".
const MOBILE_ORIGINS = new Set([
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
])

function corsHeaders(request: NextRequest): Record<string, string> | null {
  const origin = request.headers.get("origin")
  if (!origin || !MOBILE_ORIGINS.has(origin)) return null
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Device-Id, X-App-Version",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

function applyResponse(response: NextResponse, cookiesToSet: { name: string; value: string; options: any }[]) {
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options)
  }
  return response
}
