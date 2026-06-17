import type { SupabaseClient } from "@supabase/supabase-js"

// Estados de pago que están a la espera de verificación (no impactan el saldo real).
export const ESTADOS_PENDIENTES = ["pendiente", "pendiente_rendicion"] as const

export interface SaldosCliente {
  /** Saldo del libro mayor: solo movimientos confirmados. Verdad contable. */
  saldo_real: number
  /** Σ cobros cargados pero NO verificados aún (no tocan el saldo real). */
  pendiente_verificacion: number
  /** saldo_real − pendiente_verificacion: "lo que quedaría si se confirma todo". */
  saldo_proyectado: number
}

/**
 * Saldos de un cliente desde la fuente única (libro mayor v_saldo_clientes) más
 * los cobros pendientes de verificación, para mostrar el doble saldo
 * (real vs proyectado) en las vistas de chofer/vendedor y cuenta corriente.
 */
export async function getSaldosCliente(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<SaldosCliente> {
  const [{ data: saldoRow }, { data: pend }] = await Promise.all([
    supabase.from("v_saldo_clientes").select("saldo_actual").eq("cliente_id", clienteId).maybeSingle(),
    supabase.from("pagos_clientes").select("monto").eq("cliente_id", clienteId).in("estado", ESTADOS_PENDIENTES as unknown as string[]),
  ])

  const saldo_real = Number((saldoRow as any)?.saldo_actual ?? 0)
  const pendiente_verificacion = (pend || []).reduce((s: number, p: any) => s + Number(p.monto), 0)

  return {
    saldo_real,
    pendiente_verificacion,
    saldo_proyectado: Math.round((saldo_real - pendiente_verificacion) * 100) / 100,
  }
}

/** Versión batch para listados: devuelve un Map cliente_id → SaldosCliente. */
export async function getSaldosClientes(
  supabase: SupabaseClient,
  clienteIds: string[],
): Promise<Map<string, SaldosCliente>> {
  const ids = [...new Set(clienteIds)].filter(Boolean)
  if (ids.length === 0) return new Map()

  const [{ data: saldos }, { data: pend }] = await Promise.all([
    supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", ids),
    supabase.from("pagos_clientes").select("cliente_id, monto").in("cliente_id", ids).in("estado", ESTADOS_PENDIENTES as unknown as string[]),
  ])

  const realMap = new Map((saldos || []).map((r: any) => [r.cliente_id, Number(r.saldo_actual)]))
  const pendMap = new Map<string, number>()
  for (const p of pend || []) {
    pendMap.set((p as any).cliente_id, (pendMap.get((p as any).cliente_id) ?? 0) + Number((p as any).monto))
  }

  const result = new Map<string, SaldosCliente>()
  for (const id of ids) {
    const saldo_real = realMap.get(id) ?? 0
    const pendiente_verificacion = pendMap.get(id) ?? 0
    result.set(id, {
      saldo_real,
      pendiente_verificacion,
      saldo_proyectado: Math.round((saldo_real - pendiente_verificacion) * 100) / 100,
    })
  }
  return result
}
