// Refacturar un pedido (#19/#20) — lo pagado sigue al pedido.
//
// Regla del dueño (27/10/2026): lo que el cliente ya pagó respeta lo que eligió
// quien cobró. Si el pago estaba IMPUTADO a un comprobante de este pedido, al
// anularlo ese importe queda como crédito en la NC/REV espejo de la anulación
// (lleva el pedido_id del pedido y motivo "Anulación"). Al volver a generar,
// ese crédito se imputa a los comprobantes NUEVOS de este mismo pedido: el pago
// queda aplicado al pedido refacturado y el chofer o el vendedor cobran solo lo
// que resta. Lo que el cliente dejó A CUENTA nunca pasó por el comprobante
// anulado, así que sigue a cuenta: acá no se toca.
//
// Solo créditos de ANULACIONES del mismo pedido; las NC/REV de devoluciones y
// del 10 % contado tienen su propio circuito.
//
// P2-43 (Juan 31/10): la anulación es por total − REV/NC de devolución ya
// imputadas (esas quedan como están): este crédito trae solo lo pagado, y lo
// devuelto no se vuelve a facturar.

const CREDITOS = ["NCA", "NCB", "NCC", "REV"]
const r2 = (n: number) => Math.round(n * 100) / 100

export interface CreditoAplicado {
  credito: string
  comprobante: string
  monto: number
}

/** Imputa a `nuevosIds` (comprobantes recién emitidos del pedido) los créditos de sus anulaciones previas. */
export async function aplicarPagosDelPedidoRefacturado(
  supabase: any,
  pedidoId: string,
  nuevosIds: string[],
  usuarioId: string | null,
): Promise<{ aplicados: CreditoAplicado[]; advertencias: string[] }> {
  const aplicados: CreditoAplicado[] = []
  const advertencias: string[] = []
  if (!nuevosIds.length) return { aplicados, advertencias }

  const { data: creditos } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, saldo_pendiente, fecha, created_at")
    .eq("pedido_id", pedidoId)
    .eq("motivo_ajuste", "Anulación")
    .in("tipo_comprobante", CREDITOS)
    .is("anulado_en", null)
    .lt("saldo_pendiente", -0.005)
    .order("created_at", { ascending: true })
  if (!creditos?.length) return { aplicados, advertencias }

  const { data: nuevos } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, saldo_pendiente")
    .in("id", nuevosIds)
    .gt("saldo_pendiente", 0.005)
  // Fiscales antes que PRES (mismo orden que la emisión)
  const debitos = [...(nuevos || [])].sort((a: any, b: any) => Number(a.tipo_comprobante === "PRES") - Number(b.tipo_comprobante === "PRES"))

  for (const cr of creditos) {
    let disponible = -Number(cr.saldo_pendiente)
    for (const d of debitos) {
      if (disponible <= 0.005) break
      if (Number(d.saldo_pendiente) <= 0.005) continue
      const { data: imp, error } = await supabase.rpc("cc_imputar_credito", {
        p_credito_id: cr.id,
        p_debito_id: d.id,
        p_monto: null,
        p_usuario_id: usuarioId,
      })
      if (error) {
        advertencias.push(`No se pudo aplicar ${cr.tipo_comprobante} ${cr.numero_comprobante} (pago del pedido anterior) a ${d.tipo_comprobante} ${d.numero_comprobante}: ${error.message}. Imputalo a mano desde la cuenta corriente.`)
        continue
      }
      const restanteCredito = Math.abs(Number(imp?.credito_saldo_restante ?? 0))
      const restanteDebito = Number(imp?.debito_saldo_restante ?? 0)
      aplicados.push({
        credito: `${cr.tipo_comprobante} ${cr.numero_comprobante}`,
        comprobante: `${d.tipo_comprobante} ${d.numero_comprobante}`,
        monto: r2(Number(d.saldo_pendiente) - restanteDebito),
      })
      d.saldo_pendiente = restanteDebito
      disponible = restanteCredito
    }
  }
  // La plata pagada antes de refacturar cuenta para la comisión del comprobante
  // nuevo (lib/comisiones/liquidar.ts, R3 de cuentas corrientes)
  if (aplicados.length) {
    try {
      const { liquidarComisiones } = await import("@/lib/comisiones/liquidar")
      await liquidarComisiones(supabase, nuevosIds, usuarioId)
    } catch (e: any) {
      advertencias.push(`Comisión del pedido refacturado sin recalcular (${e?.message || e}).`)
    }
  }
  return { aplicados, advertencias }
}
