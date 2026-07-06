import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

/**
 * GET /api/viajante/rendiciones — historial de rendiciones del viajante.
 * Contrato: docs/CONTRATO-API-VIAJANTES.md §9.
 */
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const { data: rendiciones, error } = await supabase
      .from("rendiciones")
      .select("id, fecha, estado, efectivo_declarado, efectivo_registrado, diferencia, confirmado_at, rendicion_items(id)")
      .in("cobrador_id", session.vendedorIds)
      .order("fecha", { ascending: false })
      .limit(50)
    if (error) throw error

    return NextResponse.json({
      rendiciones: (rendiciones || []).map((r: any) => ({
        id: r.id,
        fecha: r.fecha,
        estado: r.estado,
        efectivo_declarado: Number(r.efectivo_declarado),
        efectivo_registrado: Number(r.efectivo_registrado),
        diferencia: Number(r.diferencia),
        cantidad_pagos: (r.rendicion_items || []).length,
        confirmado_at: r.confirmado_at,
      })),
    })
  } catch (error: any) {
    console.error("[viajante/rendiciones] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
