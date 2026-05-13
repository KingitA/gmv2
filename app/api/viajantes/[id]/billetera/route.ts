import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") ?? "1")
    const perPage = 50
    const offset = (page - 1) * perPage

    // Balance total
    const { data: balanceData } = await supabase
      .from("billetera_movimientos")
      .select("tipo, monto")
      .eq("viajante_id", id)

    const movimientos = balanceData ?? []
    const balance = movimientos.reduce((sum, m) => sum + Number(m.monto), 0)
    const desglose = {
      cobros: movimientos.filter(m => m.tipo === "cobro_cliente").reduce((s, m) => s + Number(m.monto), 0),
      retiros: movimientos.filter(m => m.tipo === "retiro_comision").reduce((s, m) => s + Number(m.monto), 0),
      debitos: movimientos.filter(m => m.tipo === "debito").reduce((s, m) => s + Number(m.monto), 0),
      creditos: movimientos.filter(m => m.tipo === "credito").reduce((s, m) => s + Number(m.monto), 0),
    }

    // Comisiones pendientes de cobrar (tipo='cobrada', pagado=false)
    const { data: comisionesPendientes } = await supabase
      .from("comisiones")
      .select("id, monto, segmento, cantidad, precio_neto_unitario, porcentaje, created_at, pedido_id, comprobante_venta_id, articulo_id, articulos(descripcion)")
      .eq("viajante_id", id)
      .eq("tipo", "cobrada")
      .eq("pagado", false)
      .order("created_at", { ascending: false })

    const totalPendiente = (comisionesPendientes ?? []).reduce((s, c) => s + Number(c.monto), 0)

    // Movimientos paginados
    const { data: historial, count } = await supabase
      .from("billetera_movimientos")
      .select("*", { count: "exact" })
      .eq("viajante_id", id)
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
