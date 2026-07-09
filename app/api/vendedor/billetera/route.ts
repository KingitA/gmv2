import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/billetera?page=
// Billetera del vendedor autenticado. "Plata en la calle" = suma de los pagos
// que cobró y siguen pendiente_rendicion (no rendidos a oficina), con desglose
// por método real (pagos_detalle). Los movimientos quedan como historial.
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") ?? "1")
    const perPage = 50
    const offset = (page - 1) * perPage

    // Plata en la calle: cobros sin rendir (fuente de verdad: pagos_clientes)
    const { data: pagosSinRendir } = await supabase
      .from("pagos_clientes")
      .select("id, monto, forma_pago, pagos_detalle(tipo_pago, monto)")
      .in("vendedor_id", session.vendedorIds)
      .eq("estado", "pendiente_rendicion")

    let efectivo = 0
    let cheques = 0
    let transferencias = 0
    for (const p of pagosSinRendir ?? []) {
      const detalles: any[] = (p as any).pagos_detalle || []
      if (detalles.length) {
        for (const d of detalles) {
          const tipo = (d.tipo_pago || "").toLowerCase()
          if (tipo === "efectivo") efectivo += Number(d.monto)
          else if (tipo === "cheque") cheques += Number(d.monto)
          else transferencias += Number(d.monto)
        }
      } else {
        // pagos viejos sin detalle: clasificar por forma_pago
        const forma = ((p as any).forma_pago || "").toLowerCase()
        if (forma === "cheque") cheques += Number(p.monto)
        else if (forma === "transferencia") transferencias += Number(p.monto)
        else efectivo += Number(p.monto)
      }
    }

    const balance = (pagosSinRendir ?? []).reduce((s, p) => s + Number(p.monto), 0)
    const desglose = { efectivo, cheques, transferencias }
    const cantidadSinRendir = (pagosSinRendir ?? []).length

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
      pagos_sin_rendir: cantidadSinRendir,
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
