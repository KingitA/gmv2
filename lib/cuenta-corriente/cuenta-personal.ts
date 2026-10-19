import type { SupabaseClient } from "@supabase/supabase-js"
import { getSaldosCliente } from "./saldo"

/**
 * CUENTA PERSONAL de un empleado (regla del dueño 19/10/2026): es su cuenta de
 * cliente (clientes.es_empleado), con el mismo libro mayor y la misma fuente
 * única del saldo. Ahí entran comisiones (al saldarse el comprobante del
 * cliente), retiros, diferencias de rendición, mercadería, pagos y ajustes.
 *
 * Vínculo: clientes.empleado_usuario_id (el usuario que entra al sistema) o,
 * para las comisiones, vendedores.cuenta_cliente_id (cada código de vendedor).
 */
export async function cuentaPersonalDe(
  supabase: SupabaseClient,
  { usuarioId, vendedorIds = [] }: { usuarioId?: string | null; vendedorIds?: string[] },
): Promise<string | null> {
  if (usuarioId) {
    const { data } = await supabase.from("clientes").select("id").eq("empleado_usuario_id", usuarioId).maybeSingle()
    if (data?.id) return data.id
  }
  if (vendedorIds.length) {
    const { data } = await supabase
      .from("vendedores")
      .select("cuenta_cliente_id")
      .in("id", vendedorIds)
      .not("cuenta_cliente_id", "is", null)
      .limit(1)
    if (data?.[0]?.cuenta_cliente_id) return data[0].cuenta_cliente_id
  }
  return null
}

/** Billetera del vendedor con su cuenta personal resuelta (para las APIs del servidor). */
export async function billeteraConCuentaPersonal(supabase: SupabaseClient, vendedorIds: string[], usuarioId: string) {
  const { resumenBilletera } = await import("../vendedor/billetera-saldo")
  const cuentaId = await cuentaPersonalDe(supabase, { usuarioId, vendedorIds })
  const cuenta = cuentaId ? await resumenCuentaPersonal(supabase, cuentaId) : null
  return resumenBilletera(supabase, vendedorIds, cuenta)
}

export interface ResumenCuentaPersonal {
  cliente_id: string
  /** Saldo del libro: positivo = el empleado debe; negativo = a su favor */
  saldo_real: number
  saldo_proyectado: number
  /** Lo que tiene a favor (= −saldo_real); negativo si debe */
  a_favor: number
  /** Σ comisiones ganadas netas (comisiones − reversas) */
  comisiones_ganadas: number
  /** Σ retiros */
  retiros: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function resumenCuentaPersonal(supabase: SupabaseClient, clienteId: string): Promise<ResumenCuentaPersonal> {
  const [saldos, { data: movs }] = await Promise.all([
    getSaldosCliente(supabase, clienteId),
    supabase
      .from("cuenta_corriente_clientes")
      .select("tipo_movimiento, debe, haber")
      .eq("cliente_id", clienteId)
      .in("tipo_movimiento", ["comision", "retiro"]),
  ])
  let comisiones = 0
  let retiros = 0
  for (const m of movs || []) {
    if (m.tipo_movimiento === "comision") comisiones += Number(m.haber || 0) - Number(m.debe || 0)
    else retiros += Number(m.debe || 0) - Number(m.haber || 0)
  }
  return {
    cliente_id: clienteId,
    saldo_real: saldos.saldo_real,
    saldo_proyectado: saldos.saldo_proyectado,
    a_favor: r2(-saldos.saldo_real),
    comisiones_ganadas: r2(comisiones),
    retiros: r2(retiros),
  }
}
