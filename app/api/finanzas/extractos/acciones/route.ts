import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/finanzas/extractos/acciones — acciones sobre movimientos de extracto.
 *
 *   { action: "conciliar",       mov_id }
 *   { action: "conciliar_lote",  mov_ids: [...] }          → concilia todos los sugeridos
 *   { action: "egreso",          mov_id, categoria, concepto? }
 *   { action: "ignorar",         mov_id }
 *   { action: "rematchear",      extracto_id }
 *
 * Todo delega en las RPCs atómicas de la migración 20260723:
 * extracto_conciliar (segunda firma vía pago_verificar), extracto_registrar_egreso
 * (caja_egreso: kardex + saldo), extracto_ignorar, extracto_matchear.
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const supabase = createAdminClient()
    const uid = auth.user?.id ?? null

    if (body.action === "conciliar") {
      if (!body.mov_id) return NextResponse.json({ error: "mov_id es obligatorio" }, { status: 400 })
      const { data, error } = await supabase.rpc("extracto_conciliar", { p_mov_id: body.mov_id, p_usuario_id: uid })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json(data)
    }

    if (body.action === "conciliar_lote") {
      const ids: string[] = Array.isArray(body.mov_ids) ? body.mov_ids : []
      if (!ids.length) return NextResponse.json({ error: "mov_ids es obligatorio" }, { status: 400 })
      let ok = 0
      const errores: { mov_id: string; error: string }[] = []
      for (const id of ids) {
        const { error } = await supabase.rpc("extracto_conciliar", { p_mov_id: id, p_usuario_id: uid })
        if (error) errores.push({ mov_id: id, error: error.message })
        else ok++
      }
      return NextResponse.json({ success: true, conciliados: ok, errores })
    }

    if (body.action === "egreso") {
      if (!body.mov_id || !body.categoria) {
        return NextResponse.json({ error: "mov_id y categoria son obligatorios" }, { status: 400 })
      }
      const { data, error } = await supabase.rpc("extracto_registrar_egreso", {
        p_mov_id: body.mov_id,
        p_categoria: body.categoria,
        p_usuario_id: uid,
        p_concepto: body.concepto ?? null,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json(data)
    }

    if (body.action === "ingreso") {
      if (!body.mov_id) return NextResponse.json({ error: "mov_id es obligatorio" }, { status: 400 })
      const { data, error } = await supabase.rpc("extracto_registrar_ingreso", {
        p_mov_id: body.mov_id,
        p_usuario_id: uid,
        p_concepto: body.concepto ?? null,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json(data)
    }

    if (body.action === "ignorar") {
      if (!body.mov_id) return NextResponse.json({ error: "mov_id es obligatorio" }, { status: 400 })
      const { data, error } = await supabase.rpc("extracto_ignorar", { p_mov_id: body.mov_id, p_usuario_id: uid })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json(data)
    }

    if (body.action === "rematchear") {
      if (!body.extracto_id) return NextResponse.json({ error: "extracto_id es obligatorio" }, { status: 400 })
      const { data, error } = await supabase.rpc("extracto_matchear", { p_extracto_id: body.extracto_id })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 })
  } catch (error: any) {
    console.error("[finanzas/extractos/acciones] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
