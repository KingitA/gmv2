import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { colorOverride, resolverColorPendientes } from "@/lib/actions/color-cheque"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"

/**
 * POST /api/finanzas/rendiciones/[id]/confirmar — oficina confirma una
 * rendición 'abierta' declarada por un viajante (segunda firma en lote,
 * RPC rendicion_confirmar): efectivo a caja, billetera al día, transferencias
 * a conciliación, diferencia documentada.
 *
 * Body: { caja_destino_tipo?: "CAJA", caja_destino_id, efectivo_declarado?,
 *         pagos_verificados?, forzar_diferencia?,
 *         colores_cheque?: { [pago_id]: "BLANCO" | "NEGRO" } }
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
      colores_cheque,
    } = body

    if (!caja_destino_id) {
      return NextResponse.json({ error: "caja_destino_id es requerido" }, { status: 400 })
    }

    // El RPC confirma los pagos dentro de SQL (sin pasar por confirmarCobranza),
    // así que los cheques en color PENDIENTE se resuelven acá antes: color
    // explícito de la oficina > derivado de las imputaciones actuales del pago.
    // Si alguno queda sin resolver se corta con mensaje claro (el kardex solo
    // admite BLANCO/NEGRO y la transacción del RPC fallaría igual, pero fea).
    const { data: items } = await supabase
      .from("rendicion_items")
      .select("pago_id")
      .eq("rendicion_id", rendicionId)
    const admin = createAdminClient()
    const pagosSinColor: string[] = []
    for (const it of items || []) {
      const { pendiente } = await resolverColorPendientes(
        supabase,
        admin,
        it.pago_id,
        colorOverride(colores_cheque?.[it.pago_id]),
      )
      if (pendiente) pagosSinColor.push(it.pago_id)
    }
    if (pagosSinColor.length) {
      return NextResponse.json(
        {
          error:
            "Hay cheques con color PENDIENTE (pagos a cuenta sin imputaciones). Asigná BLANCO o NEGRO a cada pago antes de confirmar la rendición.",
          pagos_sin_color: pagosSinColor,
        },
        { status: 400 },
      )
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

    // Post-confirmación por pago confirmado: comisiones 'cobrada', billetera
    // y bonificación 10% diferida (MARCA_CONTADO) — mismo módulo que Revisión
    // de Pagos, para que la rendición no saltee el descuento.
    const bonifErrores: string[] = []
    let bonifTotal = 0
    const pagoIds = (items || []).map((it) => it.pago_id)
    if (pagoIds.length) {
      const { data: pagosConfirmados } = await supabase
        .from("pagos_clientes")
        .select("id")
        .in("id", pagoIds)
        .eq("estado", "confirmado")
      for (const p of pagosConfirmados || []) {
        const post = await procesarPostConfirmacion(supabase, admin, {
          pagoId: p.id,
          usuarioId: auth.user.id,
        })
        if (post.bonificacion) bonifTotal += post.bonificacion.total
        if (post.bonificacion_error) bonifErrores.push(post.bonificacion_error)
      }
    }

    return NextResponse.json({
      success: true,
      ...data,
      bonificacion_total: bonifTotal || undefined,
      bonificacion_errores: bonifErrores.length ? bonifErrores : undefined,
    })
  } catch (error: any) {
    console.error("[finanzas/rendiciones/confirmar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
