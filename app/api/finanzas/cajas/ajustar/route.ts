import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/finanzas/cajas/ajustar — edición manual del saldo de una cuenta.
 * Llama a la RPC caja_ajustar (migración 20260713): deja el saldo en el
 * valor indicado y registra la diferencia como AJUSTE_CAJA en el kardex.
 *
 * Body: { cuenta_tipo, cuenta_id, color, nuevo_saldo, motivo? }
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { cuenta_tipo, cuenta_id, color, nuevo_saldo, motivo } = await request.json()

    if (!cuenta_tipo || !cuenta_id || !color || nuevo_saldo === undefined || nuevo_saldo === null) {
      return NextResponse.json(
        { error: "cuenta_tipo, cuenta_id, color y nuevo_saldo son obligatorios" },
        { status: 400 }
      )
    }
    if (isNaN(Number(nuevo_saldo))) {
      return NextResponse.json({ error: "nuevo_saldo inválido" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc("caja_ajustar", {
      p_cuenta_tipo: cuenta_tipo,
      p_cuenta_id: cuenta_id,
      p_color: color,
      p_nuevo_saldo: Number(nuevo_saldo),
      p_motivo: motivo || null,
      p_usuario_id: auth.user?.id ?? null,
    })

    if (error) throw error
    return NextResponse.json({ success: true, kardex_id: data })
  } catch (error: any) {
    console.error("[finanzas/cajas/ajustar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
