import type { SupabaseClient } from "@supabase/supabase-js"

// Estados de pago que están a la espera de verificación (no impactan el saldo real).
export const ESTADOS_PENDIENTES = ["pendiente", "pendiente_rendicion"] as const

export interface SaldosCliente {
  /** Saldo del libro mayor: solo movimientos confirmados. Verdad contable. */
  saldo_real: number
  /** Σ cobros cargados pero NO verificados aún (no tocan el saldo real). */
  pendiente_verificacion: number
  /** saldo_real − proyección exacta: "lo que quedaría si se confirma todo". */
  saldo_proyectado: number
}

type PagoPendiente = { id: string; cliente_id?: string; monto: number; observaciones: string | null }

/**
 * Proyección EXACTA por pago pendiente (una sola fórmula para TODAS las
 * pantallas — singular y batch deben dar idéntico).
 *
 * Un cobro pendiente es una promesa completa: al confirmarse baja el libro
 * por (a) la plata, (b) la NC del 10% contado real (10% del total de cada
 * débito bonificable imputado, incluidos los cubiertos por créditos),
 * (c) el ajuste por redondeo prometido; y sube por (d) el débito del 10%
 * sobre créditos de mercadería sin dto. Aplicar créditos NC/a cuenta no
 * mueve el libro (ya estaban), así que no entra acá.
 *
 * Devuelve un Map pago_id → baja extra (sin incluir el monto del pago).
 */
async function calcularBajasExtra(
  supabase: SupabaseClient,
  pagosPend: PagoPendiente[],
): Promise<Map<string, number>> {
  const extras = new Map<string, number>()
  if (!pagosPend.length) return extras

  const { parsearMarcaCreditos } = await import("@/lib/cobranzas/creditos")
  const { parsearMarcaAjuste } = await import("@/lib/cobranzas/ajuste")
  const { MARCA_CONTADO } = await import("@/lib/constants")

  const ids = pagosPend.map((p) => p.id)
  const { data: imps } = await supabase
    .from("imputaciones")
    .select("pago_id, comprobante_id")
    .in("pago_id", ids)
    .neq("estado", "anulado")
    .not("comprobante_id", "is", null)

  // Débitos bonificables por pago: imputados por el pago ∪ cubiertos por créditos
  const debitosPorPago = new Map<string, Set<string>>()
  for (const i of imps || []) {
    if (!debitosPorPago.has(i.pago_id)) debitosPorPago.set(i.pago_id, new Set())
    debitosPorPago.get(i.pago_id)!.add(i.comprobante_id)
  }
  const paresPorPago = new Map<string, ReturnType<typeof parsearMarcaCreditos>>()
  for (const p of pagosPend) {
    const pares = parsearMarcaCreditos(p.observaciones)
    paresPorPago.set(p.id, pares)
    for (const par of pares) {
      if (!debitosPorPago.has(p.id)) debitosPorPago.set(p.id, new Set())
      debitosPorPago.get(p.id)!.add(par.debito_id)
    }
  }
  const todosDebitos = [...new Set([...debitosPorPago.values()].flatMap((s) => [...s]))]
  const totalDe = new Map<string, number>()
  if (todosDebitos.length) {
    // Solo FA/FB/FC/PRES bonifican el 10% contado (las ND no).
    const { data: comps } = await supabase
      .from("comprobantes_venta")
      .select("id, total_factura, tipo_comprobante, anulado_en")
      .in("id", todosDebitos)
      .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
      .is("anulado_en", null)
    for (const c of comps || []) totalDe.set(c.id, Math.abs(Number(c.total_factura)))
  }

  for (const p of pagosPend) {
    let extra = 0
    const contado = (p.observaciones || "").includes(MARCA_CONTADO)
    if (contado) {
      for (const d of debitosPorPago.get(p.id) || []) extra += (totalDe.get(d) ?? 0) * 0.1
      for (const par of paresPorPago.get(p.id) || []) if (par.aplicar_10) extra -= par.monto * 0.1
    }
    extra += parsearMarcaAjuste(p.observaciones)
    extras.set(p.id, extra)
  }
  return extras
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
    supabase
      .from("pagos_clientes")
      .select("id, monto, observaciones")
      .eq("cliente_id", clienteId)
      .in("estado", ESTADOS_PENDIENTES as unknown as string[]),
  ])

  const saldo_real = Number((saldoRow as any)?.saldo_actual ?? 0)
  const pagosPend = (pend || []) as PagoPendiente[]
  const pendiente_verificacion = pagosPend.reduce((s, p) => s + Number(p.monto), 0)

  const extras = await calcularBajasExtra(supabase, pagosPend)
  const bajaProyectada =
    pendiente_verificacion + pagosPend.reduce((s, p) => s + (extras.get(p.id) ?? 0), 0)

  return {
    saldo_real,
    pendiente_verificacion,
    saldo_proyectado: Math.round((saldo_real - bajaProyectada) * 100) / 100,
  }
}

/**
 * Versión batch para listados: devuelve un Map cliente_id → SaldosCliente.
 * MISMA proyección exacta que la singular (comparten calcularBajasExtra).
 */
export async function getSaldosClientes(
  supabase: SupabaseClient,
  clienteIds: string[],
): Promise<Map<string, SaldosCliente>> {
  const ids = [...new Set(clienteIds)].filter(Boolean)
  if (ids.length === 0) return new Map()

  const [{ data: saldos }, { data: pend }] = await Promise.all([
    supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", ids),
    supabase
      .from("pagos_clientes")
      .select("id, cliente_id, monto, observaciones")
      .in("cliente_id", ids)
      .in("estado", ESTADOS_PENDIENTES as unknown as string[]),
  ])

  const realMap = new Map((saldos || []).map((r: any) => [r.cliente_id, Number(r.saldo_actual)]))
  const pagosPend = (pend || []) as PagoPendiente[]
  const extras = await calcularBajasExtra(supabase, pagosPend)

  const pendMap = new Map<string, number>()
  const bajaMap = new Map<string, number>()
  for (const p of pagosPend) {
    const cid = p.cliente_id!
    pendMap.set(cid, (pendMap.get(cid) ?? 0) + Number(p.monto))
    bajaMap.set(cid, (bajaMap.get(cid) ?? 0) + Number(p.monto) + (extras.get(p.id) ?? 0))
  }

  const result = new Map<string, SaldosCliente>()
  for (const id of ids) {
    const saldo_real = realMap.get(id) ?? 0
    result.set(id, {
      saldo_real,
      pendiente_verificacion: pendMap.get(id) ?? 0,
      saldo_proyectado: Math.round((saldo_real - (bajaMap.get(id) ?? 0)) * 100) / 100,
    })
  }
  return result
}
