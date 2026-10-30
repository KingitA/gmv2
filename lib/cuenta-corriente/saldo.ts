import type { SupabaseClient } from "@supabase/supabase-js"

// Estados de pago que están a la espera de verificación (no impactan el saldo real).
export const ESTADOS_PENDIENTES = ["pendiente", "pendiente_rendicion"] as const

// Devoluciones EN PROCESO: cargadas (pendiente) o aceptadas por depósito
// (confirmado) pero todavía sin NC/reversa. Con la NC pasan a "facturado" y ya
// están en el libro; las rechazadas no descuentan nada.
export const ESTADOS_DEVOLUCION_EN_PROCESO = ["pendiente", "confirmado"] as const

/**
 * FUENTE ÚNICA del saldo de un cliente (regla del dueño, 16/10/2026): toda
 * pantalla del ERP y de las apps que muestre cuánto debe un cliente sale de
 * acá. Dos números, siempre con su nombre:
 *  - REAL: el libro mayor (cuenta_corriente_clientes), solo lo confirmado.
 *  - PROYECTADO: cómo queda si se confirma todo lo pendiente (cobros sin
 *    verificar + devoluciones en proceso). Es el que leen vendedor y chofer.
 */
export interface SaldosCliente {
  /** Saldo del libro mayor: solo movimientos confirmados. Verdad contable. */
  saldo_real: number
  /** Σ cobros cargados pero NO verificados aún (no tocan el saldo real). */
  pendiente_verificacion: number
  /** Σ valor de las devoluciones en proceso (sin NC todavía): ya descuentan del proyectado. */
  devoluciones_en_proceso: number
  /** saldo_real − cobros pendientes (con su NC 10% y ajuste) − devoluciones en proceso. */
  saldo_proyectado: number
}

export interface OpcionesSaldo {
  /**
   * Deja AFUERA de la proyección los cobros y devoluciones de este viaje: la
   * hoja de ruta los muestra aparte (cobrado / devuelto), así el saldo
   * anterior no cambia mientras el chofer cobra.
   */
  excluirViajeId?: string | null
}

const TANDA = 150

type PagoPendiente ={ id: string; cliente_id?: string; monto: number; observaciones: string | null }

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
    .select("pago_id, comprobante_id, monto_imputado")
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
    // #33: la base del 10% es lo que el cliente se quedó (total − devoluciones con NC/REV)
    const { devueltoPorComprobante } = await import("@/lib/cobranzas/devuelto")
    const devuelto = await devueltoPorComprobante(supabase, (comps || []).map((c: any) => c.id))
    for (const c of comps || []) totalDe.set(c.id, Math.max(0, Math.abs(Number(c.total_factura)) - (devuelto.get(c.id) ?? 0)))
  }

  // REGLA 07/10 (dueño, reemplaza la del 01/10): la NC del 10% contado es por el
  // TOTAL de cada comprobante y una sola vez. Los que ya tienen su NC/REV viva no
  // la vuelven a recibir (misma regla que la emisión: ya-bonificados).
  const yaBonificados = new Set<string>()
  {
    const { cargarMarcasBonificacion, separarYaBonificados } = await import("@/lib/comprobantes/ya-bonificados")
    const porCliente = new Map<string, Set<string>>()
    for (const p of pagosPend) {
      if (!p.cliente_id || !(p.observaciones || "").includes(MARCA_CONTADO)) continue
      if (!porCliente.has(p.cliente_id)) porCliente.set(p.cliente_id, new Set())
      for (const d of debitosPorPago.get(p.id) || []) if (totalDe.has(d)) porCliente.get(p.cliente_id)!.add(d)
    }
    if (porCliente.size) {
      const { data: nums } = await supabase
        .from("comprobantes_venta")
        .select("id, numero_comprobante")
        .in("id", [...new Set([...porCliente.values()].flatMap((s) => [...s]))])
      const numDe = new Map((nums || []).map((n: any) => [n.id, String(n.numero_comprobante || "")]))
      for (const [clienteId, debs] of porCliente) {
        const lista = [...debs].map((id) => ({ id, numero_comprobante: numDe.get(id) || "" }))
        const marcas = await cargarMarcasBonificacion(supabase, clienteId, lista.map((c) => c.id))
        for (const c of separarYaBonificados(lista, marcas).yaBonificados) yaBonificados.add(c.id)
      }
    }
  }

  for (const p of pagosPend) {
    let extra = 0
    const contado = (p.observaciones || "").includes(MARCA_CONTADO)
    if (contado) {
      // NC = 10% del total de cada débito bonificable del pago que todavía no la tenga
      let ncProyectada = 0
      for (const d of debitosPorPago.get(p.id) || []) if (!yaBonificados.has(d)) ncProyectada += (totalDe.get(d) ?? 0) * 0.1
      extra += ncProyectada
      for (const par of paresPorPago.get(p.id) || []) if (par.aplicar_10) extra -= par.monto * 0.1
    }
    extra += parsearMarcaAjuste(p.observaciones)
    // Las devoluciones descontadas en el cobro NO entran acá: cada devolución
    // en proceso baja el proyectado UNA vez por sí misma (ver valorDevolucionesVivas),
    // se haya descontado en un cobro o no.
    extras.set(p.id, extra)
  }
  return extras
}

/**
 * Valor de las devoluciones en proceso, por cliente. Cada devolución baja el
 * proyectado UNA vez, por su valor con la regla única (valorarDevoluciones:
 * precio de factura, neto del 10% si la factura fue contado) — el mismo número
 * que descuenta la pantalla de cobro y que va a acreditar la NC.
 * Regla del dueño (16/10): apenas el vendedor o el chofer cargan la
 * devolución, ya descuenta del proyectado; si después se rechaza, vuelve.
 */
async function valorDevolucionesVivas(
  supabase: SupabaseClient,
  clienteIds: string[],
  opts: OpcionesSaldo,
): Promise<Map<string, number>> {
  if (!clienteIds.length) return new Map()
  const { data: devs } = await supabase
    .from("devoluciones")
    .select("id, cliente_id, monto_total, viaje_id")
    .in("cliente_id", clienteIds)
    .in("estado", ESTADOS_DEVOLUCION_EN_PROCESO as unknown as string[])
  return valorarPorCliente(
    supabase,
    (devs || []).filter((d: any) => !opts.excluirViajeId || d.viaje_id !== opts.excluirViajeId),
  )
}

/**
 * Valor de las devoluciones en proceso cargadas en un viaje, por cliente: lo
 * que la hoja de ruta muestra como "devuelto" y resta del total a cobrar (son
 * justo las que getSaldosClientes deja afuera con excluirViajeId).
 */
export async function valorDevolucionesDeViaje(
  supabase: SupabaseClient,
  viajeId: string,
): Promise<Map<string, number>> {
  const { data: devs } = await supabase
    .from("devoluciones")
    .select("id, cliente_id, monto_total")
    .eq("viaje_id", viajeId)
    .in("estado", ESTADOS_DEVOLUCION_EN_PROCESO as unknown as string[])
  return valorarPorCliente(supabase, devs || [])
}

async function valorarPorCliente(
  supabase: SupabaseClient,
  vivas: Array<{ id: string; cliente_id: string; monto_total: number | string | null }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!vivas.length) return out

  const { valorarDevoluciones } = await import("@/lib/cobranzas/valorar-devoluciones")
  const porCliente = new Map<string, any[]>()
  for (const d of vivas) {
    if (!porCliente.has(d.cliente_id)) porCliente.set(d.cliente_id, [])
    porCliente.get(d.cliente_id)!.push(d)
  }
  await Promise.all(
    [...porCliente.entries()].map(async ([clienteId, lista]) => {
      let valores = new Map<string, { total: number }>()
      try {
        valores = await valorarDevoluciones(supabase, { clienteId, devolucionIds: lista.map((d) => d.id) })
      } catch (e: any) {
        console.error("[saldo] valorarDevoluciones:", e?.message)
      }
      const total = lista.reduce((s, d) => s + (valores.get(d.id)?.total ?? (Number(d.monto_total) || 0)), 0)
      out.set(clienteId, Math.round(total * 100) / 100)
    }),
  )
  return out
}

/**
 * Saldos de varios clientes (Map cliente_id → SaldosCliente). Es LA fórmula:
 * la versión de un solo cliente la usa por dentro, así no pueden dar distinto.
 */
export async function getSaldosClientes(
  supabase: SupabaseClient,
  clienteIds: string[],
  opts: OpcionesSaldo = {},
): Promise<Map<string, SaldosCliente>> {
  const ids = [...new Set(clienteIds)].filter(Boolean)
  if (ids.length === 0) return new Map()
  // Listados grandes (padrón entero): de a tandas, para no pasar el largo de URL
  if (ids.length > TANDA) {
    const result = new Map<string, SaldosCliente>()
    for (let i = 0; i < ids.length; i += TANDA) {
      const parte = await getSaldosClientes(supabase, ids.slice(i, i + TANDA), opts)
      for (const [k, v] of parte) result.set(k, v)
    }
    return result
  }

  const [{ data: saldos }, { data: pend }, devoluciones] = await Promise.all([
    supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", ids),
    supabase
      .from("pagos_clientes")
      .select("id, cliente_id, monto, observaciones, viaje_id")
      .in("cliente_id", ids)
      .in("estado", ESTADOS_PENDIENTES as unknown as string[]),
    valorDevolucionesVivas(supabase, ids, opts),
  ])

  const realMap = new Map((saldos || []).map((r: any) => [r.cliente_id, Number(r.saldo_actual)]))
  const pagosPend = ((pend || []) as Array<PagoPendiente & { viaje_id?: string | null }>).filter(
    (p) => !opts.excluirViajeId || p.viaje_id !== opts.excluirViajeId,
  )
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
    const dev = devoluciones.get(id) ?? 0
    result.set(id, {
      saldo_real,
      pendiente_verificacion: Math.round((pendMap.get(id) ?? 0) * 100) / 100,
      devoluciones_en_proceso: dev,
      saldo_proyectado: Math.round((saldo_real - (bajaMap.get(id) ?? 0) - dev) * 100) / 100,
    })
  }
  return result
}

/** Saldos de un cliente: misma fórmula que getSaldosClientes. */
export async function getSaldosCliente(
  supabase: SupabaseClient,
  clienteId: string,
  opts: OpcionesSaldo = {},
): Promise<SaldosCliente> {
  const m = await getSaldosClientes(supabase, [clienteId], opts)
  return m.get(clienteId) ?? { saldo_real: 0, pendiente_verificacion: 0, devoluciones_en_proceso: 0, saldo_proyectado: 0 }
}

/**
 * Créditos (NC/REV vivas) ya APLICADOS a cada comprobante: el 10 % contado, las
 * devoluciones con su NC emitida, etc. (imputaciones crédito → débito).
 * P2-28: lo de un viaje es total − esto. Con el total bruto, la REV del 10 % ya
 * emitida se volvía a cobrar (CHEN: $399.991,26 en vez de $395.934,21): el libro
 * ya la descuenta y saldoDeParada la restaba de "anterior" sin restarla de "este viaje".
 */
export async function creditosAplicadosA(supabase: SupabaseClient, comprobanteIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(comprobanteIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("imputaciones")
      .select("comprobante_id, monto_imputado, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(anulado_en)")
      .in("comprobante_id", ids.slice(i, i + 200))
      .not("credito_comprobante_id", "is", null)
      .neq("estado", "anulado")
    if (error) throw new Error(`créditos aplicados: ${error.message}`)
    for (const r of data || []) {
      if ((r as any).credito?.anulado_en) continue
      out.set(r.comprobante_id, Math.round(((out.get(r.comprobante_id) ?? 0) + Number(r.monto_imputado || 0)) * 100) / 100)
    }
  }
  return out
}

/**
 * Saldo de un cliente en una parada de viaje — UNA fórmula para la hoja de
 * ruta, la vista del chofer y la ficha del cliente en el viaje (antes había
 * tres y la ficha contaba dos veces el pedido ya facturado).
 *  - saldo_anterior = proyectado SIN lo de este viaje (cobros y devoluciones
 *    del viaje se muestran aparte) − lo que ya pesa en el libro de los
 *    comprobantes de este viaje.
 *  - total_a_cobrar = saldo_anterior + lo de este viaje − lo devuelto en este viaje.
 */
export function saldoDeParada(args: {
  saldos: SaldosCliente | undefined
  /** Σ saldo_pendiente de los comprobantes de los pedidos de este viaje */
  propioEnLibro: number
  /** Lo de este viaje: comprobantes si está facturado (total − créditos ya
   *  aplicados: 10 % contado, NC de devolución — creditosAplicadosA), si no total del pedido */
  totalViaje: number
  /** Valor de las devoluciones cargadas en este viaje */
  devueltoViaje: number
}) {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const saldo_anterior = r2((args.saldos?.saldo_proyectado ?? 0) - args.propioEnLibro)
  return {
    saldo_anterior,
    total_a_cobrar: r2(saldo_anterior + args.totalViaje - args.devueltoViaje),
  }
}
