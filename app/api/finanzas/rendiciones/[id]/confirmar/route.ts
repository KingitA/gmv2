import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/finanzas/rendiciones/[id]/confirmar — oficina confirma una
 * rendición 'abierta' declarada por un viajante (segunda firma en lote,
 * RPC rendicion_confirmar): efectivo a caja, billetera al día, transferencias
 * a conciliación, diferencia documentada.
 *
 * Body: { caja_destino_tipo?: "CAJA", caja_destino_id, efectivo_declarado?,
 *         pagos_verificados?, forzar_diferencia? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: rendicionId } = await params
    const body = await request.json()
    const {
      caja_destino_tipo,
      caja_destino_id,
      efectivo_declarado,
      pagos_verificados,
      forzar_diferencia,
    } = body

    if (!caja_destino_id) {
      return NextResponse.json({ error: "caja_destino_id es requerido" }, { status: 400 })
    }

    const { data, error } = await supabase.rpc("rendicion_confirmar", {
      p_rendicion_id: rendicionId,
      p_caja_destino_tipo: caja_destino_tipo || "CAJA",
      p_caja_destino_id: caja_destino_id,
      p_usuario_id: auth.user.id,
      p_pagos_verificados: pagos_verificados || null,
      p_efectivo_declarado: efectivo_declarado != null ? Number(efectivo_declarado) : null,
      p_forzar_diferencia: Boolean(forzar_diferencia),
    })
    if (error) {
      const esDiferencia = error.message?.includes("diferencia de efectivo")
      return NextResponse.json(
        { error: error.message, requiere_forzar: esDiferencia },
        { status: esDiferencia ? 409 : 400 }
      )
    }

    return NextResponse.json({ success: true, ...data })
  } catch (error: any) {
    console.error("[finanzas/rendiciones/confirmar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
