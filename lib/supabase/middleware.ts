import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  try {
    await supabase.auth.getUser()
  } catch (error) {
    // If there's an error getting the user, just continue
    console.error("[v0] Middleware auth error:", error)
  }

  // Rutas publicas que no requieren autenticacion
  const publicRoutes = ["/auth/login", "/auth/sign-up", "/auth/error", "/auth/sign-up-success", "/auth/pendiente", "/"]
  const isPublicRoute = publicRoutes.some((route) => request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route + "/"))

  // Las rutas de API manejan su propia autenticación con requireAuth()
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/")

  // Solo redirigir a login para paginas web (no API)
  if (!isPublicRoute && !isApiRoute) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = "/auth/login"
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
