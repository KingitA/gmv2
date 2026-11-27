/**
 * Transferencias de clientes ↔ créditos del banco (Tanda 3 del plan de bancos, 27/11/2026).
 * PURO: sin base, sin red. Lo usan el servidor (lib/bancos/transferencias/servidor.ts) y las pruebas
 * (mobile/packages/core/test/bancos-transferencias.test.ts).
 *
 * Decisiones de Juan (docs/bancos/PLAN-BANCOS.md):
 *  - El monto tiene que coincidir EXACTO (solo centavos de redondeo, < $1).
 *  - Fecha: desde el día informado hasta 3 días hábiles después.
 *  - La cuenta del banco tiene que ser la misma a la que se informó la transferencia.
 *  - Se confirma sola SOLO si queda UNA candidata. Si hay varias, se achica por quien pagó
 *    (CUIT/nombre del que transfirió ∈ pagadores del cliente, o = CUIT del cliente). 0 o más de 1 → nada.
 *  - Una persona puede pagar por varios clientes y hay clientes con nombre repetido: nunca se decide
 *    por el nombre del cliente. El nombre que se compara es el del PAGADOR aprendido.
 *  - Un movimiento del banco o una transferencia informada se usan UNA sola vez.
 */
import { cuitDigitos, esSinCuit, mismoCuit, redondear, sumarDiasISO } from "../../formato"

/** Crédito del banco todavía sin explicar (banco_extractos_movimientos, estado PENDIENTE). */
export interface CreditoBanco {
  id: string
  cuenta_bancaria_id: string
  fecha: string // AAAA-MM-DD
  monto: number
  descripcion?: string | null
  concepto_banco?: string | null
  contraparte_nombre?: string | null
  contraparte_cuit?: string | null
  contraparte_cbu?: string | null
  /** Ya tiene un vínculo con un cobro (no se vuelve a usar) */
  vinculado?: boolean
}

/** Transferencia / depósito informado en un cobro pendiente (pagos_detalle de un pagos_clientes pendiente). */
export interface TransferenciaInformada {
  pago_id: string
  detalle_id: string
  cliente_id: string
  cliente_cuit?: string | null
  cuenta_bancaria_id: string | null
  monto: number
  /** fecha_transferencia del detalle o, si no hay, la fecha del cobro */
  fecha: string
  /** El cobro tiene SOLO este medio: se puede confirmar entero con el banco */
  solo_este_medio: boolean
  /** Ya tiene un vínculo con un movimiento del banco */
  vinculada?: boolean
}

/** Quién paga por quién (clientes_pagadores). Muchos a muchos. */
export interface Pagador {
  cliente_id: string
  pagador_cuit?: string | null
  pagador_nombre_normalizado?: string | null
  veces?: number
  ultimo_uso?: string | null
}

export interface Opciones {
  /** Días que no abre el banco (feriados), AAAA-MM-DD */
  feriados?: Set<string>
  /** CUIT de la empresa: las transferencias entre cuentas propias no son de clientes */
  cuitPropio?: string | null
}

export const TOLERANCIA_CENTAVOS = 1 // < $1
export const DIAS_HABILES_VENTANA = 3
export const DIAS_HABILES_AVISO = 2

// ─── Montos y fechas ────────────────────────────────────────────────────────────────────

/** Mismo monto: exacto, salvo centavos de redondeo (diferencia < $1). */
export function mismoMonto(a: number, b: number): boolean {
  return Math.abs(redondear(Number(a)) - redondear(Number(b))) < TOLERANCIA_CENTAVOS
}

function diaSemana(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay() // formato-ok: día de la semana (cálculo)
}

/** ¿Abre el banco ese día? Lunes a viernes que no son feriado. */
export function esDiaHabilBancario(iso: string, feriados?: Set<string>): boolean {
  const d = diaSemana(iso)
  return d !== 0 && d !== 6 && !feriados?.has(iso)
}

/** n días hábiles después de `iso` (si `iso` no es hábil, se cuenta desde el próximo hábil). */
export function sumarDiasHabiles(iso: string, n: number, feriados?: Set<string>): string {
  let d = iso
  while (!esDiaHabilBancario(d, feriados)) d = sumarDiasISO(d, 1)
  let faltan = n
  while (faltan > 0) {
    d = sumarDiasISO(d, 1)
    if (esDiaHabilBancario(d, feriados)) faltan--
  }
  return d
}

/** El crédito cae en la ventana de la transferencia: desde su fecha hasta 3 días hábiles después. */
export function enVentana(fechaBanco: string, fechaInformada: string, feriados?: Set<string>): boolean {
  return fechaBanco >= fechaInformada && fechaBanco <= sumarDiasHabiles(fechaInformada, DIAS_HABILES_VENTANA, feriados)
}

// ─── Qué créditos son de clientes ───────────────────────────────────────────────────────

const NO_ES_CLIENTE = /cheque|\bch[:.]|c[aá]mara|valores|echeq|e-cheq|\brev\b|rev\.|revers|contrasiento|anulaci|devoluci|rendimiento|inter[eé]s|plazo fijo|\bfci\b|rescate|reintegro|bonificaci|ajuste/i
const ES_TRANSFERENCIA = /transf|debin|\bcvu\b|\bcbu\b|cr[eé]dito inmediato|linklar|interb|dep[oó]sito|recibida|acred/i

/**
 * ¿Es un crédito que puede ser el pago de un cliente? Transferencias, DEBIN y depósitos; no cheques,
 * reversas, intereses ni transferencias entre cuentas propias.
 */
export function esCreditoDeCliente(m: CreditoBanco, opts: Opciones = {}): boolean {
  if (!(Number(m.monto) > 0)) return false
  const texto = `${m.concepto_banco ?? ""} ${m.descripcion ?? ""}`
  if (NO_ES_CLIENTE.test(texto)) return false
  if (opts.cuitPropio && m.contraparte_cuit && mismoCuit(m.contraparte_cuit, opts.cuitPropio)) return false
  return ES_TRANSFERENCIA.test(texto) || Boolean(m.contraparte_cuit || m.contraparte_nombre || m.contraparte_cbu)
}

// ─── Pagadores ──────────────────────────────────────────────────────────────────────────

const SUFIJOS = new Set(["SA", "SRL", "SAS", "SH", "SC", "SACI", "SAIC", "SCA", "DE", "DEL", "LA", "EL", "Y", "LOS", "LAS"])

/** Nombre del que transfirió, comparable: mayúsculas, sin acentos ni signos, palabras ordenadas ("Pérez, Juan" = "JUAN PEREZ"). */
export function normalizarNombrePagador(s: string | null | undefined): string | null {
  const limpio = String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((p) => p && !SUFIJOS.has(p))
  if (!limpio.length) return null
  return [...new Set(limpio)].sort().join(" ")
}

const cuitUtil = (c: string | null | undefined) => (c && cuitDigitos(c).length === 11 && !esSinCuit(c) ? c : null)

/**
 * ¿El que transfirió es pagador de ese cliente?
 *  - CUIT del que transfirió = CUIT del cliente → sí.
 *  - CUIT del que transfirió = CUIT de un pagador aprendido del cliente → sí.
 *  - Sin CUIT de un lado: nombre normalizado del que transfirió = nombre de un pagador aprendido del cliente.
 *    (Nunca el nombre del CLIENTE: hay clientes con el mismo nombre.)
 */
export function pagaPorElCliente(m: CreditoBanco, clienteId: string, clienteCuit: string | null | undefined, pagadores: Pagador[]): boolean {
  const cuitMov = cuitUtil(m.contraparte_cuit)
  if (cuitMov && cuitUtil(clienteCuit) && mismoCuit(cuitMov, clienteCuit)) return true
  const nombreMov = normalizarNombrePagador(m.contraparte_nombre)
  for (const p of pagadores) {
    if (p.cliente_id !== clienteId) continue
    const cuitP = cuitUtil(p.pagador_cuit)
    if (cuitMov && cuitP) { if (mismoCuit(cuitMov, cuitP)) return true; continue }
    if (nombreMov && p.pagador_nombre_normalizado && p.pagador_nombre_normalizado === nombreMov) return true
  }
  return false
}

// ─── La decisión ────────────────────────────────────────────────────────────────────────

export type Motivo =
  | "sin_candidato"      // ninguna transferencia informada con ese monto, cuenta y fecha
  | "varias"             // más de una y el pagador no alcanza para elegir
  | "otros_medios"       // una sola, pero el cobro tiene otros medios: se confirma a mano
  | "compartida"         // la misma transferencia sería la única de dos créditos distintos
  | "ya_vinculado"       // el crédito ya tiene un cobro

export type Decision =
  | { accion: "confirmar"; movimiento_id: string; transferencia: TransferenciaInformada; por: "unica" | "pagador" }
  | { accion: "nada"; movimiento_id: string; motivo: Motivo; candidatas: TransferenciaInformada[] }

/** Transferencias informadas que cumplen monto + cuenta + fecha para ese crédito. */
export function candidatasPara(m: CreditoBanco, informadas: TransferenciaInformada[], opts: Opciones = {}): TransferenciaInformada[] {
  return informadas.filter((t) =>
    !t.vinculada &&
    t.cuenta_bancaria_id === m.cuenta_bancaria_id &&
    mismoMonto(m.monto, t.monto) &&
    enVentana(m.fecha, t.fecha, opts.feriados))
}

/** Decisión para UN crédito, sin mirar a los demás. */
export function decidirCredito(m: CreditoBanco, informadas: TransferenciaInformada[], pagadores: Pagador[], opts: Opciones = {}): Decision {
  if (m.vinculado) return { accion: "nada", movimiento_id: m.id, motivo: "ya_vinculado", candidatas: [] }
  const todas = candidatasPara(m, informadas, opts)
  if (!todas.length) return { accion: "nada", movimiento_id: m.id, motivo: "sin_candidato", candidatas: [] }
  let elegida: TransferenciaInformada | null = null
  let por: "unica" | "pagador" = "unica"
  if (todas.length === 1) elegida = todas[0]
  else {
    const porPagador = todas.filter((t) => pagaPorElCliente(m, t.cliente_id, t.cliente_cuit, pagadores))
    if (porPagador.length === 1) { elegida = porPagador[0]; por = "pagador" }
  }
  if (!elegida) return { accion: "nada", movimiento_id: m.id, motivo: "varias", candidatas: todas }
  if (!elegida.solo_este_medio) return { accion: "nada", movimiento_id: m.id, motivo: "otros_medios", candidatas: [elegida] }
  return { accion: "confirmar", movimiento_id: m.id, transferencia: elegida, por }
}

/**
 * Decisión para todos los créditos juntos. Además de la regla de cada uno: si dos créditos eligen la
 * MISMA transferencia, ninguno se confirma solo (no se sabe cuál es).
 */
export function emparejar(creditos: CreditoBanco[], informadas: TransferenciaInformada[], pagadores: Pagador[], opts: Opciones = {}): Decision[] {
  const decisiones = creditos.map((m) => decidirCredito(m, informadas, pagadores, opts))
  const usos = new Map<string, number>()
  for (const d of decisiones) if (d.accion === "confirmar") usos.set(d.transferencia.detalle_id, (usos.get(d.transferencia.detalle_id) ?? 0) + 1)
  return decisiones.map((d) =>
    d.accion === "confirmar" && (usos.get(d.transferencia.detalle_id) ?? 0) > 1
      ? { accion: "nada", movimiento_id: d.movimiento_id, motivo: "compartida", candidatas: [d.transferencia] }
      : d)
}

// ─── Créditos sin identificar: a qué cliente sugerir ────────────────────────────────────

export interface ClienteSugerible { id: string; cuit?: string | null }
export interface Sugerencia { cliente_id: string; por: "pagador" | "cuit_cliente"; veces: number }

/**
 * Clientes sugeridos para un crédito sin identificar: primero los que tienen a ese pagador (más usados
 * primero), después los clientes cuyo CUIT es el del que transfirió. Puede haber varios (una persona que
 * paga por dos clientes, o clientes que comparten CUIT): se sugieren, nunca se eligen solos.
 */
export function sugerirClientes(m: CreditoBanco, pagadores: Pagador[], clientes: ClienteSugerible[]): Sugerencia[] {
  const out = new Map<string, Sugerencia>()
  const cuitMov = cuitUtil(m.contraparte_cuit)
  const nombreMov = normalizarNombrePagador(m.contraparte_nombre)
  const porPagador = pagadores
    .filter((p) => {
      const cuitP = cuitUtil(p.pagador_cuit)
      if (cuitMov && cuitP) return mismoCuit(cuitMov, cuitP)
      return Boolean(nombreMov && p.pagador_nombre_normalizado === nombreMov)
    })
    .sort((a, b) => (b.veces ?? 0) - (a.veces ?? 0) || String(b.ultimo_uso ?? "").localeCompare(String(a.ultimo_uso ?? "")))
  for (const p of porPagador) if (!out.has(p.cliente_id)) out.set(p.cliente_id, { cliente_id: p.cliente_id, por: "pagador", veces: p.veces ?? 0 })
  if (cuitMov) for (const c of clientes) if (!out.has(c.id) && cuitUtil(c.cuit) && mismoCuit(c.cuit, cuitMov)) out.set(c.id, { cliente_id: c.id, por: "cuit_cliente", veces: 0 })
  return [...out.values()]
}

// ─── Transferencias informadas que no aparecieron ───────────────────────────────────────

/**
 * Informada hace más de 2 días hábiles y sin crédito vinculado. Solo se avisa si del banco ya se leyó
 * algo POSTERIOR al plazo (si la cuenta no se cargó, no se sabe: no se avisa).
 */
export function noAparecio(t: TransferenciaInformada, hoy: string, ultimaLecturaCuenta: string | null | undefined, feriados?: Set<string>): boolean {
  if (t.vinculada || !t.cuenta_bancaria_id) return false
  const limite = sumarDiasHabiles(t.fecha, DIAS_HABILES_AVISO, feriados)
  return hoy > limite && Boolean(ultimaLecturaCuenta && ultimaLecturaCuenta > limite)
}
