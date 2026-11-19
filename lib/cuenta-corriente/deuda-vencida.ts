import type { SupabaseClient } from "@supabase/supabase-js"
import type { DeudaVencimiento } from "./vencimientos"

/**
 * Deuda vencida / a vencer de los clientes (condiciones de pago, fase 3): lee la
 * base (v_deuda_vencimiento / cc_deuda_vencimiento, 20261119q_deuda_vencida.sql).
 * La regla está documentada ahí y en vencimientos.ts (repartirVencimientos).
 *
 * Sin la migración aplicada devuelve un mapa vacío (las pantallas no muestran
 * nada en lugar de romperse).
 */
export async function deudaVencidaClientes(supabase: SupabaseClient, clienteIds: string[]): Promise<Map<string, DeudaVencimiento>> {
  const out = new Map<string, DeudaVencimiento>()
  const ids = [...new Set(clienteIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("v_deuda_vencimiento")
      .select("cliente_id, saldo, vencida, a_vencer, vencimiento_mas_viejo, proximo_vencimiento")
      .in("cliente_id", ids.slice(i, i + 200))
    if (error) {
      console.error("[deuda-vencida]", error.message)
      return out
    }
    for (const r of data || []) out.set(r.cliente_id, normalizar(r))
  }
  return out
}

/** Un cliente (ficha, cuenta corriente): calcula solo el suyo. */
export async function deudaVencidaCliente(supabase: SupabaseClient, clienteId: string): Promise<DeudaVencimiento | null> {
  const { data, error } = await supabase.rpc("cc_deuda_vencimiento", { p_cliente_id: clienteId })
  if (error) {
    console.error("[deuda-vencida]", error.message)
    return null
  }
  const r = (data || [])[0]
  return r ? normalizar(r) : { saldo: 0, vencida: 0, a_vencer: 0, vencimiento_mas_viejo: null, proximo_vencimiento: null }
}

function normalizar(r: any): DeudaVencimiento {
  return {
    saldo: Number(r.saldo) || 0,
    vencida: Number(r.vencida) || 0,
    a_vencer: Number(r.a_vencer) || 0,
    vencimiento_mas_viejo: r.vencimiento_mas_viejo ?? null,
    proximo_vencimiento: r.proximo_vencimiento ?? null,
  }
}
