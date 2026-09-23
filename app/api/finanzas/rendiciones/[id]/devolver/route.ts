import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/finanzas/rendiciones/[id]/devolver — devuelve una rendición
 * ABIERTA al cobrador para que la rinda de nuevo (se declaró mal). Los cobros
 * quedan como estaban (pendiente_rendicion, en su mano); se revierte el saldo
 * anotado al declarar; el viaje vuelve a en_curso. Body: { motivo? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params
    let body: any = {}
    try { body = await request.json() } catch { /* sin body */ }
    const { data, error } = await supabase.rpc("rendicion_devolver", {
      p_rendicion_id: id,
      p_usuario_id: auth.user.id,
      p_motivo: body.motivo || null,
    })
    if (error) return NextResponse.json({ error: error.message.replace(/^rendicion_devolver:\s*/, "") }, { status: 400 })
    return NextResponse.json({ success: true, ...(data as any) })
  } catch (error: any) {
    console.error("[rendiciones/devolver] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
