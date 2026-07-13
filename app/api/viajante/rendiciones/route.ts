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
      .select(
        `id, fecha, estado, efectivo_declarado, efectivo_registrado, diferencia, observaciones, confirmado_at, created_at,
         rendicion_items(pago_id, pagos_clientes(id, monto, fecha_pago, forma_pago, clientes(nombre), pagos_detalle(tipo_pago, monto)))`
      )
      .in("cobrador_id", session.vendedorIds)
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) throw error

    return NextResponse.json({
      rendiciones: (rendiciones || []).map((r: any) => {
        const pagos = (r.rendicion_items || [])
          .map((it: any) => it.pagos_clientes)
          .filter(Boolean)
          .map((p: any) => ({
            id: p.id,
            monto: Number(p.monto),
            fecha_pago: p.fecha_pago,
            cliente_nombre: p.clientes?.nombre || "—",
            metodo_resumen: (p.pagos_detalle || []).length
              ? [...new Set((p.pagos_detalle || []).map((d: any) => d.tipo_pago))].join(" + ")
              : p.forma_pago || "—",
          }))
        return {
          id: r.id,
          fecha: r.fecha,
          estado: r.estado,
          efectivo_declarado: Number(r.efectivo_declarado),
          efectivo_registrado: Number(r.efectivo_registrado),
          diferencia: Number(r.diferencia),
          observaciones: r.observaciones,
          cantidad_pagos: pagos.length,
          total: pagos.reduce((s: number, p: any) => s + p.monto, 0),
          confirmado_at: r.confirmado_at,
          pagos,
        }
      }),
    })
  } catch (error: any) {
    console.error("[viajante/rendiciones] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
