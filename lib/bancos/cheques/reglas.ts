/**
 * Cheques contra el banco (Tanda 4 del plan de bancos, 27/11/2026) — reglas PURAS.
 *
 * Qué se decide acá (sin base de datos, con sus pruebas en mobile/packages/core/test/bancos-cheques.test.ts):
 *  - qué renglón del banco es de cheques (acreditación, comisión, pago de un cheque propio, rechazo)
 *  - el número de cheque que trae el renglón (Credicoop: "Ch:68977284" o el comprobante "977284")
 *  - con qué cheque(s) depositados se acredita: por número si el renglón lo trae; si no, por
 *    importe; y para los depósitos sumados (Provincia) el conjunto de cheques depositados el mismo
 *    día que suma EXACTO. Si hay más de una posibilidad → no se decide.
 *  - la comisión del banco de esa acreditación (solo si se identifica sin dudas)
 *  - cheque propio debitado: por número (e importe) o, sin número, por importe
 *  - rechazo: los cheques posibles (lo confirma el dueño, nunca solo)
 *  - días hábiles: fecha esperada (48 h) y alerta (96 h)
 *
 * Importes: siempre exactos al centavo (se comparan en centavos enteros).
 */
import { sumarDiasISO } from "../../formato"

// ─── Renglones del banco ──────────────────────────────────────────────────────

export interface LineaBanco {
  id: string
  cuenta_bancaria_id: string
  fecha: string // AAAA-MM-DD
  monto: number // crédito +, débito −
  descripcion: string | null
  concepto_banco?: string | null
  referencia_externa?: string | null
  saldo_banco?: number | null
}

export type ClaseLinea = "acreditacion" | "comision" | "debito_propio" | "rechazo"

const texto = (l: Pick<LineaBanco, "descripcion" | "concepto_banco">) =>
  `${l.concepto_banco ?? ""} ${l.descripcion ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[−–—]/g, "-")

const RE_RECHAZO = /rechaz/i
const RE_COMISION = /\b(com|comis|comision)\b[^a-z0-9]*(acred|ech\b|ech\s+canje)|comis\w*\s+acred|\bcom\s+ech\b/i
const RE_ACREDITACION = /acredit\w*\s+(de\s+)?valores|acred\w*\s+valores|\bdep\.?\s*ch\b|deposito\s+(de\s+)?cheque|cam\.?\s*fed|canje\s+(interno|o\/?\s*bancos)|acreditac\w*.*camara/i
const RE_DEBITO_PROPIO = /pago\s+(de\s+)?cheque|cheque\s+por\s+ventanilla/i

/** Qué es el renglón, para cheques. null = no es de cheques (o es algo que clasifica la tanda 2). */
export function clasificarLinea(l: LineaBanco): ClaseLinea | null {
  const t = texto(l)
  if (l.monto < 0) {
    if (/comis/i.test(t) || /\bcom\b/i.test(t)) return RE_COMISION.test(t) && !RE_RECHAZO.test(t) ? "comision" : null
    if (RE_RECHAZO.test(t) && /cheq|ech|ch\b|o\.?e\.?/i.test(t)) return "rechazo"
    if (RE_DEBITO_PROPIO.test(t) && !/titular\s+de\s+cuenta/i.test(t)) return "debito_propio"
    return null
  }
  if (l.monto > 0 && RE_ACREDITACION.test(t) && !RE_RECHAZO.test(t)) return "acreditacion"
  return null
}

const soloDigitos = (s: string) => s.replace(/\D/g, "")
const sinCeros = (s: string) => s.replace(/^0+/, "")

/**
 * Número de cheque que trae el renglón, o null. Solo formas conocidas (nunca un número cualquiera:
 * "DEP. CH. 48 HS. BNA 2860001" trae la sucursal, no el cheque; "NRO: 000000000" es vacío).
 */
export function numeroDeLinea(l: LineaBanco): string | null {
  const t = texto(l)
  const formas = [
    /\bCh\s*:\s*(\d{4,})/i, // Credicoop: "Dep:1309916727-BANCO MACRO-Ch:68977284"
    /cheque\s+por\s+ventanilla\s+(\d{4,})/i, // Provincia
    /pago\s+(?:de\s+)?cheque(?:\s+de)?\s+camara\s+(\d{4,})/i, // Credicoop (captura)
    /\bcomp\.\s*(\d{4,})/i, // Credicoop por API: "— comp. 977284"
    /\bnro\s*:?\s*(\d{4,})/i,
  ]
  for (const re of formas) {
    const m = t.match(re)
    if (m && sinCeros(m[1])) return m[1]
  }
  // Credicoop PDF / captura: el comprobante quedó en la clave ("bccl-pdf:2026-10-06|c988638|...")
  const ref = l.referencia_externa ?? ""
  const m = ref.match(/^bccl-[a-z]+:[^|]*\|c(\d{4,})\|/i)
  if (m && sinCeros(m[1])) return m[1]
  return null
}

/**
 * ¿El número del banco es el de este cheque? Igual sin ceros a la izquierda, o los últimos
 * dígitos cuando el banco lo trae cortado (Credicoop pone los últimos 6 en el comprobante).
 */
export function mismoNumero(numeroCheque: string | null | undefined, numeroBanco: string | null | undefined): boolean {
  const c = soloDigitos(String(numeroCheque ?? ""))
  const b = soloDigitos(String(numeroBanco ?? ""))
  if (!sinCeros(c) || !sinCeros(b)) return false
  if (sinCeros(c) === sinCeros(b)) return true
  return b.length >= 6 && c.length >= b.length && c.slice(-b.length) === b
}

// ─── Importes en centavos ─────────────────────────────────────────────────────

export const centavos = (n: number) => Math.round(Math.abs(Number(n) || 0) * 100)

// ─── Acreditación de cheques depositados ──────────────────────────────────────

export interface ChequeDepositado {
  id: string
  numero: string | null
  monto: number
  fecha_deposito: string | null
  cuenta_banco_id: string | null
}

export type Decision =
  | { tipo: "unico"; cheques: string[]; por: "numero" | "importe" | "suma" }
  | { tipo: "ambiguo"; opciones: number; motivo: string }
  | { tipo: "ninguno"; motivo: string }

/** Tope de la búsqueda de sumas: más cheques el mismo día o más pasos → no se decide */
const MAX_CHEQUES_DIA = 30
const MAX_PASOS = 200_000

/**
 * Combinaciones (de 2 o más cheques) que suman exacto `objetivo` centavos. Corta al llegar a
 * `tope` soluciones o si la búsqueda se hace demasiado larga (devuelve null = no se sabe).
 */
export function combinacionesQueSuman(montos: Array<{ id: string; c: number }>, objetivo: number, tope = 2): string[][] | null {
  if (montos.length > MAX_CHEQUES_DIA) return null
  const xs = [...montos].sort((a, b) => b.c - a.c)
  const resto: number[] = new Array(xs.length + 1).fill(0)
  for (let i = xs.length - 1; i >= 0; i--) resto[i] = resto[i + 1] + xs[i].c
  const sols: string[][] = []
  let pasos = 0
  let cortado = false
  const elegidos: string[] = []
  const buscar = (i: number, falta: number) => {
    if (sols.length >= tope || cortado) return
    if (++pasos > MAX_PASOS) { cortado = true; return }
    if (falta === 0) { if (elegidos.length >= 2) sols.push([...elegidos]); return }
    if (i >= xs.length || resto[i] < falta) return
    if (xs[i].c <= falta) {
      elegidos.push(xs[i].id)
      buscar(i + 1, falta - xs[i].c)
      elegidos.pop()
    }
    buscar(i + 1, falta)
  }
  buscar(0, objetivo)
  return cortado ? null : sols
}

/**
 * Con qué cheque(s) depositados se acredita este renglón. `candidatos` = DEPOSITADOS de la
 * misma cuenta y todavía sin usar.
 */
export function decidirAcreditacion(linea: LineaBanco, candidatos: ChequeDepositado[]): Decision {
  const objetivo = centavos(linea.monto)
  const posibles = candidatos.filter((c) => c.cuenta_banco_id === linea.cuenta_bancaria_id && (!c.fecha_deposito || c.fecha_deposito <= linea.fecha))
  const numero = numeroDeLinea(linea)

  if (numero) {
    const porNumero = posibles.filter((c) => mismoNumero(c.numero, numero))
    const exactos = porNumero.filter((c) => centavos(c.monto) === objetivo)
    if (exactos.length === 1) return { tipo: "unico", cheques: [exactos[0].id], por: "numero" }
    if (exactos.length > 1) return { tipo: "ambiguo", opciones: exactos.length, motivo: "Más de un cheque con ese número e importe" }
    if (porNumero.length) return { tipo: "ninguno", motivo: "El cheque de ese número tiene otro importe" }
    return { tipo: "ninguno", motivo: "Ningún cheque depositado con ese número" }
  }

  // Sin número: un cheque con ese importe, o varios depositados el mismo día que suman exacto
  const soluciones: Array<{ ids: string[]; por: "importe" | "suma" }> = []
  for (const c of posibles) if (centavos(c.monto) === objetivo) soluciones.push({ ids: [c.id], por: "importe" })
  const porDia = new Map<string, ChequeDepositado[]>()
  for (const c of posibles) {
    if (!c.fecha_deposito || centavos(c.monto) >= objetivo) continue
    porDia.set(c.fecha_deposito, [...(porDia.get(c.fecha_deposito) ?? []), c])
  }
  for (const grupo of porDia.values()) {
    if (soluciones.length > 1 || grupo.length < 2) continue
    const combos = combinacionesQueSuman(grupo.map((c) => ({ id: c.id, c: centavos(c.monto) })), objetivo, 2)
    if (combos === null) return { tipo: "ambiguo", opciones: 0, motivo: "Demasiados cheques ese día para decidir" }
    for (const ids of combos) soluciones.push({ ids, por: "suma" })
  }
  if (soluciones.length === 1) return { tipo: "unico", cheques: soluciones[0].ids, por: soluciones[0].por }
  if (soluciones.length > 1) return { tipo: "ambiguo", opciones: soluciones.length, motivo: "Más de una combinación de cheques da ese importe" }
  return { tipo: "ninguno", motivo: "Ningún cheque depositado con ese importe" }
}

// ─── Comisión del banco por la acreditación ───────────────────────────────────

/** Comisiones conocidas de acreditación (Credicoop 0,7 %, 1 %, 1,4 %; Nación 0,7 %) */
export const TASAS_COMISION = [0.007, 0.01, 0.014]

const esComisionDe = (credito: LineaBanco, com: LineaBanco) =>
  TASAS_COMISION.some((t) => Math.abs(Math.round(Math.abs(credito.monto) * t * 100) - centavos(com.monto)) <= 1)

const encadena = (credito: LineaBanco, com: LineaBanco) =>
  credito.saldo_banco != null && com.saldo_banco != null &&
  Math.abs(Math.round((Number(credito.saldo_banco) + Number(com.monto)) * 100) - Math.round(Number(com.saldo_banco) * 100)) === 0

/**
 * La comisión que el banco cobró por ESTA acreditación, o null si no se puede saber sin dudas
 * (entonces la clasifica la tanda 2 como gasto bancario y la acreditación va sin gastos: no se
 * cuenta dos veces). `comisiones` = renglones de comisión del mismo día y cuenta, sin usar;
 * `creditosDelDia` = todas las acreditaciones de cheques de ese día y cuenta (incluida esta).
 */
export function comisionDe(credito: LineaBanco, comisiones: LineaBanco[], creditosDelDia: LineaBanco[]): string | null {
  const delDia = comisiones.filter((c) => c.fecha === credito.fecha && c.cuenta_bancaria_id === credito.cuenta_bancaria_id && c.monto < 0)
  if (!delDia.length) return null
  // 1) Saldo corrido: el renglón de la comisión viene justo después del crédito
  const porSaldo = delDia.filter((c) => encadena(credito, c))
  if (porSaldo.length === 1) return porSaldo[0].id
  // 2) Por la tasa, si ninguna otra acreditación del día podría tener esa misma comisión
  const otros = creditosDelDia.filter((x) => x.id !== credito.id)
  const porTasa = delDia.filter((c) => esComisionDe(credito, c))
  if (porTasa.length === 1 && !otros.some((o) => esComisionDe(o, porTasa[0]))) return porTasa[0].id
  // 3) Una sola acreditación y una sola comisión en el día
  if (delDia.length === 1 && otros.length === 0) return delDia[0].id
  return null
}

// ─── Cheques propios debitados ────────────────────────────────────────────────

export interface ChequePropio {
  id: string
  numero: string | null
  monto: number
  cuenta_banco_id: string | null
}

/** Cheque propio ENTREGADO_A_PROVEEDOR que el banco pagó: por número (e importe); sin número, solo por importe en esa cuenta. */
export function decidirDebitoPropio(linea: LineaBanco, candidatos: ChequePropio[]): Decision {
  const objetivo = centavos(linea.monto)
  const numero = numeroDeLinea(linea)
  if (numero) {
    const ok = candidatos.filter((c) => (c.cuenta_banco_id == null || c.cuenta_banco_id === linea.cuenta_bancaria_id)
      && mismoNumero(c.numero, numero) && centavos(c.monto) === objetivo)
    if (ok.length === 1) return { tipo: "unico", cheques: [ok[0].id], por: "numero" }
    if (ok.length > 1) return { tipo: "ambiguo", opciones: ok.length, motivo: "Más de un cheque propio con ese número" }
    return { tipo: "ninguno", motivo: "Ningún cheque propio entregado con ese número e importe" }
  }
  const ok = candidatos.filter((c) => c.cuenta_banco_id === linea.cuenta_bancaria_id && centavos(c.monto) === objetivo)
  if (ok.length === 1) return { tipo: "unico", cheques: [ok[0].id], por: "importe" }
  if (ok.length > 1) return { tipo: "ambiguo", opciones: ok.length, motivo: "Más de un cheque propio con ese importe" }
  return { tipo: "ninguno", motivo: "Ningún cheque propio entregado con ese importe" }
}

// ─── Rechazos ─────────────────────────────────────────────────────────────────

export interface ChequeTercero extends ChequeDepositado {
  estado: string
}

/**
 * Cheques que podrían ser el rechazado (depositados o ya acreditados en esa cuenta). Por número e
 * importe si el renglón trae número; si no (o no aparece), por importe. NO se rechaza nada acá:
 * es la lista para el aviso que confirma el dueño.
 */
export function posiblesRechazados(linea: LineaBanco, candidatos: ChequeTercero[]): string[] {
  const objetivo = centavos(linea.monto)
  const enCuenta = candidatos.filter((c) => c.cuenta_banco_id === linea.cuenta_bancaria_id && ["DEPOSITADO", "COBRADO"].includes(c.estado)
    && (!c.fecha_deposito || c.fecha_deposito <= linea.fecha))
  const numero = numeroDeLinea(linea)
  if (numero) {
    const porNumero = enCuenta.filter((c) => mismoNumero(c.numero, numero) && centavos(c.monto) === objetivo)
    if (porNumero.length) return porNumero.map((c) => c.id)
  }
  return enCuenta.filter((c) => centavos(c.monto) === objetivo).map((c) => c.id)
}

// ─── Días hábiles, fecha esperada y alerta ────────────────────────────────────

const esFinde = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

/** iso + n días hábiles bancarios (sin sábados, domingos ni feriados/puentes). */
export function sumarDiasHabiles(iso: string, n: number, feriados: ReadonlySet<string> = new Set()): string {
  let d = iso
  let k = 0
  while (k < Math.max(0, n)) {
    d = sumarDiasISO(d, 1)
    if (esFinde(d) || feriados.has(d)) continue
    k++
  }
  return d
}

/** Días hábiles para la alerta: 4 = 96 h (el doble de las 48 h de la acreditación). */
export const DIAS_ALERTA = 4
export const DIAS_ACREDITACION = 2

/** ¿Este depositado ya pasó las 96 h hábiles sin acreditarse? */
export function estaDemorado(fechaDeposito: string | null, hoy: string, feriados: ReadonlySet<string> = new Set(), diasAlerta = DIAS_ALERTA): boolean {
  if (!fechaDeposito) return false
  return hoy >= sumarDiasHabiles(fechaDeposito, diasAlerta, feriados)
}
