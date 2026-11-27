import { NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { ahoraISO } from "@/lib/formato"
import { panelChequesBanco, revisarChequesContraBanco } from "@/lib/bancos/cheques/servidor"

/**
 * Cheques contra el banco (bancos tanda 4) — solo admin (mueve saldos del banco, como /caja).
 *
 * GET  → panel: en clearing por cuenta (saldo proyectado), demorados (96 h), rechazos y propuestas.
 * POST { accion }:
 *   revisar                          → vuelve a mirar los renglones PENDIENTES de los últimos 30 días
 *   aplicar { aviso_id }             → aplica una propuesta (acreditar / debitar) — modo propuesta
 *   descartar { aviso_id }           → la deja de lado
 *   confirmar_rechazo { aviso_id, cheque_id } → cheque_rechazar de siempre (ND al cliente). Solo así.
 *   modo { modo_propuesta }          → prende / apaga el modo propuesta
 */
export async function GET() {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    return NextResponse.json(await panelChequesBanco(createAdminClient()))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  const db = createAdminClient()
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const avisoId = typeof body.aviso_id === "string" ? body.aviso_id : null
  try {
    switch (body.accion) {
      case "revisar": {
        const r = await revisarChequesContraBanco(db, { dias: 30, usuarioId: auth.user.id })
        return NextResponse.json({ success: true, ...r })
      }
      case "aplicar": {
        if (!avisoId) return NextResponse.json({ error: "Falta la propuesta" }, { status: 400 })
        const { data: av } = await db.from("cheques_banco_avisos").select("*").eq("id", avisoId).maybeSingle()
        if (!av || av.estado !== "pendiente" || !["acreditar", "debitar"].includes(av.tipo)) {
          return NextResponse.json({ error: "La propuesta ya no está pendiente" }, { status: 400 })
        }
        const { data, error } = await db.rpc("cheque_banco_aplicar", {
          p_movimiento_id: av.movimiento_id, p_accion: av.tipo, p_cheque_ids: av.cheque_ids,
          p_comision_movimiento_id: av.comision_movimiento_id, p_usuario_id: auth.user.id, p_automatico: false,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        if (!data?.success) return NextResponse.json({ error: data?.motivo ?? "No se pudo aplicar" }, { status: 400 })
        return NextResponse.json({ success: true, ...data })
      }
      case "descartar": {
        if (!avisoId) return NextResponse.json({ error: "Falta el aviso" }, { status: 400 })
        const { error } = await db.from("cheques_banco_avisos")
          .update({ estado: "descartado", resuelto_por: auth.user.id, resuelto_at: ahoraISO() })
          .eq("id", avisoId).eq("estado", "pendiente")
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }
      case "confirmar_rechazo": {
        const chequeId = typeof body.cheque_id === "string" ? body.cheque_id : null
        if (!avisoId || !chequeId) return NextResponse.json({ error: "Falta el cheque" }, { status: 400 })
        const { data, error } = await db.rpc("cheque_banco_confirmar_rechazo", {
          p_aviso_id: avisoId, p_cheque_id: chequeId, p_usuario_id: auth.user.id,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        if (data?.success === false) return NextResponse.json({ error: data?.motivo ?? "No se pudo" }, { status: 400 })
        return NextResponse.json({ success: true, ...data })
      }
      case "modo": {
        const { error } = await db.from("cheques_banco_ajustes")
          .upsert({ id: true, modo_propuesta: body.modo_propuesta !== false, actualizado_por: auth.user.id, actualizado_at: ahoraISO() })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }
      default:
        return NextResponse.json({ error: "Acción desconocida" }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
