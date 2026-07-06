import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/pagos-pendientes
// Pagos en estado pendiente_rendicion de los clientes del vendedor, con
// desglose por método para preparar la rendición.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const { data: pagos, error } = await supabase
      .from("pagos_clientes")
      .select("id, monto, fecha_pago, forma_pago, clientes(id, nombre), pagos_detalle(tipo_pago, monto)")
      .in("vendedor_id", session.vendedorIds)
      .eq("estado", "pendiente_rendicion")
      .order("fecha_pago", { ascending: true })

    if (error) throw error

    let totalEfectivo = 0
    let totalOtros = 0
    const resultado = (pagos || []).map((p: any) => {
      const detalles: any[] = p.pagos_detalle || []
      const efectivo = detalles
        .filter((d) => (d.tipo_pago || "").toLowerCase() === "efectivo")
        .reduce((s, d) => s + Number(d.monto), 0)
      const sinDetalle = !detalles.length && (p.forma_pago || "").toLowerCase() === "efectivo"
      const ef = sinDetalle ? Number(p.monto) : efectivo
      totalEfectivo += ef
      totalOtros += Number(p.monto) - ef
      return {
        id: p.id,
        monto: Number(p.monto),
        fecha_pago: p.fecha_pago,
        cliente_nombre: p.clientes?.nombre || "—",
        metodo_resumen: detalles.length
          ? detalles.map((d) => d.tipo_pago).join(" + ")
          : p.forma_pago || "—",
      }
    })

    return NextResponse.json({
      pagos: resultado,
      total: resultado.reduce((s, p) => s + p.monto, 0),
      total_efectivo: totalEfectivo,
      total_otros: totalOtros,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/pagos-pendientes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
