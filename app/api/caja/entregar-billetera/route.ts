import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

/**
 * POST /api/caja/entregar-billetera — "a cuenta viaje": plata que sale de una
 * caja hacia la billetera de un chofer/viajante (viáticos, adelantos).
 *
 * Dual-write deliberado (Etapa 4 de la Caja del Día):
 *  1. RPC caja_transferir → línea kardex TRANSFERENCIA_INTERNA CAJA→BILLETERA
 *     (baja el saldo de la caja; kardex_registrar v3 NO toca saldos BILLETERA).
 *  2. billetera_movimientos tipo 'credito' → el trigger de billetera actualiza
 *     su saldo. Referencia cruzada al kardex para trazabilidad.
 *
 * Body: { viajante_id, origen_tipo?="CAJA", origen_id, monto, concepto? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { viajante_id, origen_tipo = "CAJA", origen_id, monto, concepto } = body

    if (!viajante_id || !origen_id || !monto || Number(monto) <= 0) {
      return NextResponse.json(
        { error: "viajante_id, origen_id y monto (>0) son requeridos" },
        { status: 400 }
      )
    }

    const { data: viajante } = await supabase
      .from("vendedores")
      .select("id, nombre")
      .eq("id", viajante_id)
      .single()
    if (!viajante) {
      return NextResponse.json({ error: "Chofer/viajante no encontrado" }, { status: 404 })
    }

    const conceptoFinal = concepto?.trim() || `Plata para viaje — ${viajante.nombre}`

    // 1. Kardex + saldo de la caja (atómico en el RPC)
    const { data: kardexId, error: transfErr } = await supabase.rpc("caja_transferir", {
      p_origen_tipo: origen_tipo,
      p_origen_id: origen_id,
      p_destino_tipo: "BILLETERA",
      p_destino_id: viajante_id,
      p_monto: Number(monto),
      p_gastos: 0,
      p_color: "BLANCO",
      p_concepto: conceptoFinal,
      p_usuario_id: auth.user.id,
    })
    if (transfErr) throw transfErr

    // 2. Crédito en la billetera (el trigger sincroniza el saldo BILLETERA)
    const { error: bmErr } = await supabase.from("billetera_movimientos").insert({
      viajante_id,
      tipo: "credito",
      monto: Math.abs(Number(monto)),
      concepto: conceptoFinal,
      referencia_tipo: "kardex_contable",
      referencia_id: typeof kardexId === "string" ? kardexId : (kardexId as any)?.kardex_id ?? null,
      fecha: nowArgentina(),
      creado_por: auth.user.id,
    })
    if (bmErr) {
      // La caja ya se movió: no se oculta el problema, se reporta para arreglar a mano.
      console.error("[caja/entregar-billetera] kardex OK pero billetera falló:", bmErr)
      return NextResponse.json(
        {
          error: `La plata salió de la caja pero la billetera no se acreditó (${bmErr.message}). Avisá al administrador para corregirlo.`,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, viajante: viajante.nombre })
  } catch (error: any) {
    console.error("[caja/entregar-billetera] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
