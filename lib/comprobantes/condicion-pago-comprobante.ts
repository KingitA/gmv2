import { condicionParaComprobante, COLS_CONDICION_CLIENTE, COLS_CONDICION_PEDIDO, datosPagoComprobante } from "@/lib/pedidos/condicion-pago-pedido"

/**
 * Condición de pago y vencimiento de un comprobante que se va a emitir (fase 2,
 * 19/11/2026): la del pedido; si el comprobante no es de un pedido o el pedido no
 * tiene, la de la ficha del cliente. Vencimiento = fecha + plazo (sin condición, el
 * mismo día). Nunca frena la emisión: si algo falla, el comprobante sale igual sin
 * estos datos.
 */
export async function pagoDelComprobante(
  supabase: any,
  { pedidoId, clienteId, fecha }: { pedidoId?: string | null; clienteId?: string | null; fecha: string },
): Promise<{ condicion_pago_texto?: string | null; fecha_vencimiento?: string }> {
  try {
    const [ped, cli] = await Promise.all([
      pedidoId ? supabase.from("pedidos").select(COLS_CONDICION_PEDIDO.join(", ")).eq("id", pedidoId).maybeSingle() : Promise.resolve({ data: null }),
      clienteId ? supabase.from("clientes").select(COLS_CONDICION_CLIENTE.join(", ")).eq("id", clienteId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    if (ped.error || cli.error) throw ped.error || cli.error
    return datosPagoComprobante(fecha, condicionParaComprobante(ped.data, cli.data))
  } catch (e: any) {
    console.error("[condición de pago del comprobante]", e?.message || e)
    return {}
  }
}
