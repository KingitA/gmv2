import type { SupabaseClient } from "@supabase/supabase-js"
import { textoCondicionPago } from "@/lib/clientes/condicion-pago"
import { condicionDeFicha, condicionDePedido } from "@/lib/pedidos/condicion-pago-pedido"

/**
 * Condiciones de pago, fase 4 (App Chofer, 19/11/2026): en el cobro el chofer ve la condición del
 * cliente y de cada pedido ("Contado · Efectivo", "Cuenta corriente 30 días · Cheques de 60 a 90
 * días") y el vencimiento de cada comprobante. Tres consultas por id; vacío si falta algo.
 */
export interface CondicionesCobro {
  /** Texto de la ficha del cliente ("" = sin condición cargada) */
  cliente: string
  /** Texto por pedido, solo los que tienen condición propia */
  pedidos: Record<string, string>
  /** Por comprobante: su condición (texto guardado al facturar) y su vencimiento (ISO) */
  comprobantes: Record<string, { condicion: string | null; vence: string | null }>
}

export async function condicionesDeCobro(
  supabase: SupabaseClient,
  clienteId: string,
  cobro: { comprobantes: Array<{ id: string }>; pedidos: Array<{ id: string }> },
): Promise<CondicionesCobro> {
  const compIds = cobro.comprobantes.map((c) => c.id)
  const pedIds = cobro.pedidos.map((p) => p.id)
  const [cli, peds, comps] = await Promise.all([
    supabase.from("clientes").select("condicion_pago_tipo, plazo_dias, forma_pago, cheque_dias_desde, cheque_dias_hasta").eq("id", clienteId).maybeSingle(),
    pedIds.length
      ? supabase.from("pedidos").select("id, condicion_pago_tipo_pedido, plazo_dias_pedido, forma_pago_pedido, cheque_dias_desde_pedido, cheque_dias_hasta_pedido").in("id", pedIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    compIds.length
      ? supabase.from("comprobantes_venta").select("id, condicion_pago_texto, fecha_vencimiento").in("id", compIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ])
  for (const r of [cli, peds, comps]) if (r.error) throw new Error(`condicionesDeCobro: ${r.error.message}`)
  const pedidos: Record<string, string> = {}
  for (const p of (peds.data || []) as any[]) {
    const t = textoCondicionPago(condicionDePedido(p))
    if (t) pedidos[p.id] = t
  }
  const comprobantes: CondicionesCobro["comprobantes"] = {}
  for (const c of (comps.data || []) as any[]) comprobantes[c.id] = { condicion: c.condicion_pago_texto || null, vence: c.fecha_vencimiento ? String(c.fecha_vencimiento).slice(0, 10) : null }
  return { cliente: textoCondicionPago(condicionDeFicha(cli.data)), pedidos, comprobantes }
}
