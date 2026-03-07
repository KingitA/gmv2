import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: pedido_id } = await params

    // Obtener facturas del pedido
    const { data: facturas, error } = await supabase
      .from("comprobantes_venta")
      .select(
        `
        id,
        numero_comprobante,
        fecha,
        total_factura,
        estado_pago,
        saldo_pendiente,
        tipo_comprobante
      `,
      )
      .eq("pedido_id", pedido_id)
      .order("fecha", { ascending: false })

    if (error) {
      console.error("[v0] Error obteniendo facturas:", error)
      return NextResponse.json({ error: "Error al obtener facturas" }, { status: 500 })
    }

    // Para cada factura, obtener los pagos asociados
    const facturasConPagos = await Promise.all(
      (facturas || []).map(async (factura) => {
        // Obtener imputaciones (relación entre pagos y facturas)
        const { data: imputaciones } = await supabase
          .from("imputaciones")
          .select(
            `
          monto_imputado,
          pagos_clientes!inner(
            id,
            fecha_pago,
            monto,
            forma_pago
          )
        `,
          )
          .eq("comprobante_id", factura.id)

        const pagos =
          imputaciones?.map((imp: any) => ({
            id: imp.pagos_clientes.id,
            fecha: imp.pagos_clientes.fecha_pago,
            monto: imp.monto_imputado,
            metodo: imp.pagos_clientes.forma_pago,
          })) || []

        return {
          id: factura.id,
          numero: factura.numero_comprobante,
          fecha: factura.fecha,
          monto_total: factura.total_factura,
          estado_pago: factura.estado_pago,
          saldo_pendiente: factura.saldo_pendiente,
          tipo_comprobante: factura.tipo_comprobante,
          pagos,
        }
      }),
    )

    return NextResponse.json({
      pedido_id,
      facturas: facturasConPagos,
    })
  } catch (error) {
    console.error("[v0] Error en GET /api/pedidos/[id]/facturas:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
