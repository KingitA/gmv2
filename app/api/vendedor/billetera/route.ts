import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/billetera?page=
// Billetera del vendedor autenticado (movimientos de sus registros de
// vendedor) + comisiones pendientes de retiro. Mismo cálculo que la vista
// admin /api/viajantes/[id]/billetera, resuelto desde la sesión.
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") ?? "1")
    const perPage = 50
    const offset = (page - 1) * perPage

    const { data: balanceData } = await supabase
      .from("billetera_movimientos")
      .select("tipo, monto")
      .in("viajante_id", session.vendedorIds)

    const movimientos = balanceData ?? []
    const balance = movimientos.reduce((sum, m) => sum + Number(m.monto), 0)
    const desglose = {
      cobros: movimientos.filter((m) => m.tipo === "cobro_cliente").reduce((s, m) => s + Number(m.monto), 0),
      retiros: movimientos.filter((m) => m.tipo === "retiro_comision").reduce((s, m) => s + Number(m.monto), 0),
      debitos: movimientos.filter((m) => m.tipo === "debito").reduce((s, m) => s + Number(m.monto), 0),
      creditos: movimientos.filter((m) => m.tipo === "credito").reduce((s, m) => s + Number(m.monto), 0),
    }

    const { data: comisionesPendientes } = await supabase
      .from("comisiones")
      .select("id, monto, segmento, porcentaje, created_at, pedido_id, articulos(descripcion)")
      .in("viajante_id", session.vendedorIds)
      .eq("tipo", "cobrada")
      .eq("pagado", false)
      .order("created_at", { ascending: false })

    const totalPendiente = (comisionesPendientes ?? []).reduce((s, c) => s + Number(c.monto), 0)

    const { data: historial, count } = await supabase
      .from("billetera_movimientos")
      .select("id, tipo, medio, monto, concepto, fecha", { count: "exact" })
      .in("viajante_id", session.vendedorIds)
      .order("fecha", { ascending: false })
      .range(offset, offset + perPage - 1)

    return NextResponse.json({
      balance,
      desglose,
      comisiones_pendientes: comisionesPendientes ?? [],
      total_pendiente_comisiones: totalPendiente,
      historial: historial ?? [],
      total: count ?? 0,
      page,
      per_page: perPage,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/billetera:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
