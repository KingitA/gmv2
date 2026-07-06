import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/mostrador/para-retirar — pedidos listos para retirar en mostrador
 * con sus comprobantes y saldo pendiente (para cobrar al retirar).
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, estado, created_at, cliente_id, pago_contado_10, anticipo_pago_id, clientes(nombre)")
      .in("estado", ["listo_para_retirar", "facturado"])
      .eq("condicion_entrega", "retira_mostrador")
      .order("created_at", { ascending: true })
    if (error) throw error

    const pedidoIds = (pedidos || []).map((p) => p.id)
    const comprobantesPorPedido = new Map<string, any[]>()
    if (pedidoIds.length) {
      const { data: comps } = await supabase
        .from("comprobantes_venta")
        .select("id, pedido_id, tipo_comprobante, numero_comprobante, total_factura, saldo_pendiente, estado_pago")
        .in("pedido_id", pedidoIds)
        .neq("estado_pago", "anulado")
      for (const c of comps || []) {
        if (!c.pedido_id) continue
        comprobantesPorPedido.set(c.pedido_id, [...(comprobantesPorPedido.get(c.pedido_id) ?? []), c])
      }
    }

    return NextResponse.json({
      pedidos: (pedidos || []).map((p) => {
        const comps = comprobantesPorPedido.get(p.id) ?? []
        return {
          id: p.id,
          numero_pedido: p.numero_pedido,
          estado: p.estado,
          cliente_id: p.cliente_id,
          cliente: (p as any).clientes?.nombre ?? p.cliente_id,
          anticipado: Boolean(p.anticipo_pago_id),
          comprobantes: comps.map((c) => ({
            id: c.id,
            tipo: c.tipo_comprobante,
            numero: c.numero_comprobante,
            total: Number(c.total_factura),
            saldo: Number(c.saldo_pendiente),
          })),
          saldo_total: comps.reduce((s, c) => s + Math.max(0, Number(c.saldo_pendiente)), 0),
        }
      }),
    })
  } catch (error: any) {
    console.error("[mostrador/para-retirar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
