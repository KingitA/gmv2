import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// POST /api/mobile/auth/logout  (Authorization: Bearer <access_token>)
// Revoca la sesión del dispositivo (su refresh token deja de servir).
export async function POST(request: Request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")
  if (m) {
    try {
      await createAdminClient().auth.admin.signOut(m[1], "local")
    } catch {
      /* ya inválida */
    }
  }
  return NextResponse.json({ ok: true })
}
