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
    supabase
      .from("pagos_clientes")
      .select("id, monto, observaciones")
      .eq("cliente_id", clienteId)
      .in("estado", ESTADOS_PENDIENTES as unknown as string[]),
  ])

  const saldo_real = Number((saldoRow as any)?.saldo_actual ?? 0)
  const pendiente_verificacion = (pend || []).reduce((s: number, p: any) => s + Number(p.monto), 0)

  // ── Proyección EXACTA (una sola fórmula para todas las pantallas) ──
  // Un cobro pendiente es una promesa completa: al confirmarse baja el libro
  // por (a) la plata, (b) la NC del 10% contado real (10% del total de cada
  // débito bonificable imputado, incluidos los cubiertos por créditos),
  // (c) el ajuste por redondeo prometido; y sube por (d) el débito del 10%
  // sobre créditos de mercadería sin dto. Aplicar créditos NC/a cuenta no
  // mueve el libro (ya estaban), así que no entra acá.
  let bajaProyectada = pendiente_verificacion
  const pagosPend = (pend || []) as any[]
  if (pagosPend.length) {
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
      const { data: comps } = await supabase
        .from("comprobantes_venta")
        .select("id, total_factura, tipo_comprobante, anulado_en")
        .in("id", todosDebitos)
        .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
        .is("anulado_en", null)
      for (const c of comps || []) totalDe.set(c.id, Math.abs(Number(c.total_factura)))
    }

    for (const p of pagosPend) {
      const contado = (p.observaciones || "").includes(MARCA_CONTADO)
      if (contado) {
        for (const d of debitosPorPago.get(p.id) || []) bajaProyectada += (totalDe.get(d) ?? 0) * 0.1
        for (const par of paresPorPago.get(p.id) || []) if (par.aplicar_10) bajaProyectada -= par.monto * 0.1
      }
      bajaProyectada += parsearMarcaAjuste(p.observaciones)
    }
  }

  return {
    saldo_real,
    pendiente_verificacion,
    saldo_proyectado: Math.round((saldo_real - bajaProyectada) * 100) / 100,
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
