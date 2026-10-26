import { chequeDuplicadoDe, ErrorReglaCobranza, errorDeRpcCobranza, mensajeChequeDuplicado } from "./errores"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createHash } from "crypto"

/**
 * Alta transaccional de una cobranza vía RPC `cobranza_crear`
 * (supabase/migrations/20260811_cobranza_crear_rpc.sql):
 * pago + pagos_detalle + cheques + ítems de depósito + imputaciones en UNA
 * transacción. Con `idempotency_key` los reintentos y el doble click devuelven
 * el MISMO pago (dedup) en vez de duplicarlo.
 *
 * La usan los 4 caminos de alta: /api/pagos-clientes, /api/cobranzas,
 * /api/chofer/viaje/[id]/cobro y /api/viajante/cobro. Lo accesorio (fotos,
 * retenciones, billetera, pedidos anticipados) queda en cada endpoint, después
 * del alta — si eso falla, el pago ya está entero y consistente.
 */

export interface ChequeInput {
  banco?: string | null
  numero?: string | null
  fecha_emision?: string | null
  fecha_vencimiento?: string | null
  monto?: number
  /** BLANCO | NEGRO | PENDIENTE (la oficina lo resuelve al confirmar) */
  color?: string | null
  es_echeq?: boolean
}

export interface DetalleInput {
  tipo_pago: string
  monto: number
  caja_id?: string | null
  cuenta_bancaria_id?: string | null
  fecha_transferencia?: string | null
  numero_comprobante_pago?: string | null
  referencia?: string | null
  banco?: string | null
  numero_cheque?: string | null
  fecha_cheque?: string | null
  localidad?: string | null
  cuit_emisor?: string | null
  color_cheque?: string | null
  fecha_deposito?: string | null
  /** Cheque YA existente (ej. compartido entre clientes): se linkea directo */
  cheque_id?: string | null
  /** Si viene (y no hay cheque_id), la RPC crea el registro en cartera y lo linkea */
  cheque?: ChequeInput | null
  deposito_items?: Array<{
    tipo_item: string
    monto: number
    numero_cheque?: string | null
    banco_emisor?: string | null
    fecha_pago_cheque?: string | null
    numero_comprobante_deposito?: string | null
    fecha_deposito_efectivo?: string | null
    nro_comprobante_deposito_ef?: string | null
    cheque?: ChequeInput | null
  }>
}

export interface CrearCobranzaParams {
  idempotency_key?: string | null
  cliente_id: string
  vendedor_id?: string | null
  viaje_id?: string | null
  cobranza_id?: string | null
  cobrador_tipo?: string | null
  monto: number
  fecha_pago?: string | null
  observaciones?: string | null
  estado: "pendiente" | "pendiente_rendicion"
  creado_por: string
  detalles: DetalleInput[]
  imputaciones?: Array<{ comprobante_id: string; monto_imputado: number }>
}

/** Transferencia, depósito o echeq: plata que viaja por el banco, nunca en la mano del cobrador */
export function esDetalleDigital(d: Pick<DetalleInput, "tipo_pago" | "color_cheque" | "cheque">): boolean {
  if (d.tipo_pago === "transferencia" || d.tipo_pago === "deposito") return true
  return d.tipo_pago === "cheque" && (d.color_cheque === "ECHEQ" || Boolean(d.cheque?.es_echeq))
}

/** Clave de idempotencia derivada (UUID estable) para la parte digital de un cobro partido */
function claveDerivada(clave: string, sufijo: string): string {
  const h = createHash("md5").update(`${clave}:${sufijo}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export interface ParteCobranza {
  pago_id: string
  monto: number
  estado: "pendiente" | "pendiente_rendicion"
  /** true = transferencias/echeqs: se confirman en /caja, no van a la rendición ni a la billetera */
  digital: boolean
  detalles: DetalleInput[]
  dedup: boolean
}

/**
 * Alta de un cobro. Regla del dueño (26/10, #35): las TRANSFERENCIAS (y depósitos
 * y echeqs) NO pasan por la rendición. Un cobro de la calle (pendiente_rendicion)
 * que las trae se parte:
 *  - parte física (efectivo, cheque papel) → pendiente_rendicion: billetera y rendición;
 *  - parte digital → 'pendiente': /caja → "Transf. por confirmar"; la oficina la
 *    confirma cuando ve la plata en el banco, y recién ahí entra a la cuenta.
 * Las imputaciones se reparten en orden (primero la parte digital, que se confirma
 * antes); el resto del pago queda a cuenta como siempre. Las marcas de la
 * confirmación ([CREDITOS], [AJUSTE], anticipo) viajan con la parte física; la de
 * contado [10% CONTADO] con las dos (la NC sale una sola vez por comprobante).
 * `pago_id` = la parte física si la hay (los llamadores le cuelgan billetera,
 * fotos, devoluciones y anticipos); `partes` = todas.
 */
export async function crearCobranza(
  supabase: SupabaseClient,
  params: CrearCobranzaParams,
): Promise<{ pago_id: string; dedup: boolean; partes: ParteCobranza[] }> {
  const digitales = params.detalles.filter(esDetalleDigital)
  const fisicos = params.detalles.filter((d) => !esDetalleDigital(d))
  const r2 = (n: number) => Math.round(n * 100) / 100

  if (params.estado !== "pendiente_rendicion" || !digitales.length) {
    const r = await crearCobranzaRpc(supabase, params)
    return { ...r, partes: [{ pago_id: r.pago_id, monto: params.monto, estado: params.estado, digital: false, detalles: params.detalles, dedup: r.dedup }] }
  }

  // Todo digital: un solo pago, pendiente de la oficina (no de rendición)
  if (!fisicos.length) {
    const r = await crearCobranzaRpc(supabase, { ...params, estado: "pendiente" })
    return { ...r, partes: [{ pago_id: r.pago_id, monto: params.monto, estado: "pendiente", digital: true, detalles: params.detalles, dedup: r.dedup }] }
  }

  // Mixto: dos pagos
  const montoDigital = r2(digitales.reduce((s, d) => s + Number(d.monto || 0), 0))
  const montoFisico = r2(params.monto - montoDigital)
  const imps = (params.imputaciones || []).map((i) => ({ ...i }))
  const impsDigital: typeof imps = []
  let resto = montoDigital
  for (const i of imps) {
    if (resto <= 0.005) break
    const toma = r2(Math.min(Number(i.monto_imputado), resto))
    if (toma > 0.005) {
      impsDigital.push({ comprobante_id: i.comprobante_id, monto_imputado: toma })
      i.monto_imputado = r2(Number(i.monto_imputado) - toma)
      resto = r2(resto - toma)
    }
  }
  const impsFisico = imps.filter((i) => Number(i.monto_imputado) > 0.005)
  const obs = params.observaciones || ""
  const obsDigital = [obs.includes("[10% CONTADO]") ? "[10% CONTADO]" : "", "Transferencia del cobro en la calle: se confirma en Caja (no va en la rendición)"]
    .filter(Boolean)
    .join(" · ")

  const fisico = await crearCobranzaRpc(supabase, { ...params, monto: montoFisico, detalles: fisicos, imputaciones: impsFisico })
  const digital = await crearCobranzaRpc(supabase, {
    ...params,
    idempotency_key: params.idempotency_key ? claveDerivada(params.idempotency_key, "digital") : null,
    estado: "pendiente",
    monto: montoDigital,
    detalles: digitales,
    imputaciones: impsDigital,
    observaciones: obsDigital,
  })
  return {
    pago_id: fisico.pago_id,
    dedup: fisico.dedup,
    partes: [
      { pago_id: fisico.pago_id, monto: montoFisico, estado: "pendiente_rendicion", digital: false, detalles: fisicos, dedup: fisico.dedup },
      { pago_id: digital.pago_id, monto: montoDigital, estado: "pendiente", digital: true, detalles: digitales, dedup: digital.dedup },
    ],
  }
}

async function crearCobranzaRpc(
  supabase: SupabaseClient,
  params: CrearCobranzaParams,
): Promise<{ pago_id: string; dedup: boolean }> {
  const { data, error } = await supabase.rpc("cobranza_crear", { p_payload: params })
  if (error) {
    // Cheque ya registrado (unicidad de `cheques`): definitivo, y con la referencia al
    // cobro/cliente donde está para que quien cobra sepa qué pasó.
    const dup = chequeDuplicadoDe(error)
    if (dup) throw new ErrorReglaCobranza(await describirChequeDuplicado(supabase, params, dup))
    // Regla de negocio (RAISE de la RPC) ⇒ ErrorReglaCobranza: definitivo, no reintentable
    throw errorDeRpcCobranza("cobranza_crear", error)
  }
  return { pago_id: data.pago_id as string, dedup: Boolean(data.dedup) }
}

/**
 * Busca el cheque que chocó (por la clave del índice o, si Postgres no la informó, por los
 * cheques del cobro) y el cobro/cliente donde está. Nunca lanza: si no se puede averiguar,
 * el mensaje va sin referencia.
 */
async function describirChequeDuplicado(supabase: SupabaseClient, params: CrearCobranzaParams, clave: Record<string, string>): Promise<string> {
  try {
    // La clave real es (banco, numero, monto, fecha_vencimiento): si Postgres la informó, se
    // busca exacta; si no, por los cheques que traía el cobro.
    type Cand = { numero: string; banco?: string; monto?: string; fecha?: string }
    const candidatos: Cand[] = clave.numero || clave.numero_cheque
      ? [{ numero: clave.numero || clave.numero_cheque!, banco: clave.banco, monto: clave.monto, fecha: clave.fecha_vencimiento }]
      : params.detalles.flatMap((d) => [...(d.cheque?.numero ? [{ numero: d.cheque.numero, banco: d.cheque.banco || undefined }] : []), ...(d.deposito_items || []).flatMap((i) => (i.cheque?.numero ? [{ numero: i.cheque.numero, banco: i.cheque.banco || undefined }] : []))])
    for (const c of candidatos) {
      let q = supabase.from("cheques").select("id, banco, numero, estado, created_at").eq("numero", c.numero).order("created_at", { ascending: false }).limit(5)
      if (c.banco) q = q.ilike("banco", c.banco)
      if (c.monto && Number.isFinite(Number(c.monto))) q = q.eq("monto", Number(c.monto))
      if (c.fecha) q = q.eq("fecha_vencimiento", c.fecha)
      const { data: cheques } = await q
      // El que sigue vivo manda; si todos están anulados, se informa eso
      const cheque = cheques?.find((k: any) => k.estado !== "ANULADO") || cheques?.[0]
      if (!cheque) continue
      const { data: det } = await supabase.from("pagos_detalle").select("pago_id").eq("cheque_id", cheque.id).limit(1).maybeSingle()
      let donde: { fecha?: string | null; cliente?: string | null; estado?: string | null; cheque_estado?: string | null } = { cheque_estado: cheque.estado }
      if (det?.pago_id) {
        const { data: pago } = await supabase.from("pagos_clientes").select("fecha_pago, estado, clientes(nombre, razon_social)").eq("id", det.pago_id).maybeSingle()
        const cli: any = (pago as any)?.clientes
        if (pago) donde = { ...donde, fecha: (pago as any).fecha_pago, estado: (pago as any).estado, cliente: cli?.razon_social || cli?.nombre || null }
      }
      return mensajeChequeDuplicado({ numero: cheque.numero, banco: cheque.banco || c.banco || "" }, donde)
    }
  } catch (e: any) {
    console.error("[cobranzas] describir cheque duplicado:", e?.message)
  }
  return mensajeChequeDuplicado(clave)
}

/**
 * Recorta las imputaciones para que su suma nunca supere el monto del pago.
 * La RPC rechaza Σ imputaciones > monto: el excedente NO se imputa — queda
 * como saldo pendiente hasta que lo cubra la NC (10%, devolución) o un pago
 * futuro. Devuelve solo las que quedaron con monto > 0.
 *
 * Dos modos:
 * - "secuencial" (default): de primera a última, regla histórica — para pagos
 *   parciales comunes (se salda lo más viejo primero).
 * - "proporcional": cada imputación recibe la misma fracción del pago.
 *   OJO (01/10): para cobros con 10% CONTADO ya NO alcanza — si en el cobro
 *   se mezclan comprobantes ya bonificados con otros sin bonificar, la misma
 *   fracción para todos reparte el descuento también sobre el ya bonificado
 *   (a uno le sobra nota y al otro le queda saldo). Para contado usar
 *   repartirImputacionesContado (abajo).
 */
export function recortarImputaciones<T extends { monto_imputado: number }>(
  imputaciones: T[],
  montoPago: number,
  modo: "secuencial" | "proporcional" = "secuencial",
): T[] {
  const total = imputaciones.reduce((s, i) => s + Number(i.monto_imputado), 0)
  if (total <= montoPago + 0.005) {
    return imputaciones.filter((i) => Number(i.monto_imputado) > 0.005)
  }

  if (modo === "proporcional") {
    const factor = montoPago / total
    const out = imputaciones
      .map((imp) => ({ ...imp, monto_imputado: Math.round(Number(imp.monto_imputado) * factor * 100) / 100 }))
      .filter((i) => i.monto_imputado > 0.005)
    // El último absorbe la diferencia de redondeo: Σ == monto al centavo
    const suma = out.reduce((s, i) => s + i.monto_imputado, 0)
    const diff = Math.round((montoPago - suma) * 100) / 100
    if (out.length && Math.abs(diff) > 0.001) {
      out[out.length - 1].monto_imputado = Math.round((out[out.length - 1].monto_imputado + diff) * 100) / 100
    }
    return out
  }

  let remaining = montoPago
  const out: T[] = []
  for (const imp of imputaciones) {
    const apply = Math.min(Number(imp.monto_imputado), remaining)
    if (apply > 0.005) {
      out.push({ ...imp, monto_imputado: Math.round(apply * 100) / 100 })
      remaining = Math.max(0, remaining - apply)
    }
  }
  return out
}

/**
 * Reparto del pago en un cobro con 10% CONTADO — regla 01/10:
 * cada comprobante recibe en plata SU saldo seleccionado menos SU PROPIO 10%
 * (la NC futura cubre ese 10%); los YA bonificados reciben su saldo completo.
 *
 * `bonifDe`: comprobante_id → monto de la NC del 10% que va a emitirse por él
 * (0 o ausente = ya bonificado o no bonificable → recibe plata completa).
 *
 * Caso del bug (detectado por la sesión chofer): A $100 sin bonificar y
 * B $50 ya bonificado, se cobran $140 → el proporcional viejo imputaba
 * 93,33 / 46,67; lo correcto es 90 / 50 (a A su NC de $10 lo salda justo).
 *
 * Si la plata entregada no llega al objetivo (pago parcial), se escala
 * proporcionalmente SOBRE LOS OBJETIVOS; si sobra, el resto queda a cuenta
 * (nunca se imputa de más). Sirve igual para cobros multi-cliente: se llama
 * por cliente con sus imputaciones y su monto.
 */
export function repartirImputacionesContado<T extends { comprobante_id?: string; monto_imputado: number }>(
  imputaciones: T[],
  montoPago: number,
  bonifDe: Record<string, number>,
): T[] {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const objetivos = imputaciones.map((imp) => {
    const bonif = Number(bonifDe[(imp as any).comprobante_id ?? ""] || 0)
    return Math.max(0, r2(Number(imp.monto_imputado) - bonif))
  })
  const totalObjetivo = r2(objetivos.reduce((s, o) => s + o, 0))
  if (totalObjetivo <= 0.005) return []

  // Plata suficiente: cada uno recibe exactamente su objetivo (lo que sobre
  // del pago queda a cuenta). Parcial: misma fracción de cada objetivo.
  const factor = Math.min(1, montoPago / totalObjetivo)
  const out = imputaciones
    .map((imp, i) => ({ ...imp, monto_imputado: r2(objetivos[i] * factor) }))
    .filter((i) => i.monto_imputado > 0.005)
  if (factor < 1) {
    // El último absorbe el redondeo: Σ == monto del pago al centavo
    const suma = out.reduce((s, i) => s + i.monto_imputado, 0)
    const diff = r2(montoPago - suma)
    if (out.length && Math.abs(diff) > 0.001) {
      out[out.length - 1].monto_imputado = r2(out[out.length - 1].monto_imputado + diff)
    }
  }
  return out
}
