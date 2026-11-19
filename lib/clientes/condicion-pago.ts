// Condición y forma de pago del cliente (Juan, 19/11/2026 — fase 1 de 4).
//
// Antes clientes.condicion_pago era un texto suelto que mezclaba CUÁNDO paga con
// CÓMO paga ("Efectivo", "Cheque 30 días"…). Ahora son dos cosas:
//   - CONDICIÓN (cuándo):  condicion_pago_tipo = contado | cuenta_corriente | anticipado
//                           plazo_dias solo en cuenta corriente (contado y anticipado = 0)
//   - FORMA (cómo):         forma_pago = efectivo | transferencia | cheque
//                           con cheque: cheque_dias_desde / cheque_dias_hasta (hasta >= desde)
//                           30–30 = "Cheque a 30 días", 0–0 = "Cheque al día",
//                           60–90 = "Cheques de 60 a 90 días" (muchos cheques escalonados).
// Los días del cheque cuentan desde el VENCIMIENTO de la deuda, y el vencimiento es
// la fecha del comprobante + plazo_dias.
//
// El texto viejo (clientes.condicion_pago) se sigue guardando porque lo mandan y lo
// leen las APK instaladas: la base lo traduce en los dos sentidos (disparador de
// 20261119_condiciones_pago.sql, misma tabla que TEXTO_VIEJO acá abajo).
//
// Módulo PURO (sin base de datos): lo usan el ERP, las fases siguientes y los tests.

import { sumarDiasISO } from "../formato"

export type CondicionPagoTipo = "contado" | "cuenta_corriente" | "anticipado"
export type FormaPago = "efectivo" | "transferencia" | "cheque"

export interface CondicionPago {
  condicion_pago_tipo: CondicionPagoTipo | null
  plazo_dias: number | null
  forma_pago: FormaPago | null
  cheque_dias_desde: number | null
  cheque_dias_hasta: number | null
}

export const CONDICION_VACIA: CondicionPago = {
  condicion_pago_tipo: null, plazo_dias: null, forma_pago: null, cheque_dias_desde: null, cheque_dias_hasta: null,
}

export const CONDICIONES: { valor: CondicionPagoTipo; etiqueta: string; ayuda: string }[] = [
  { valor: "contado", etiqueta: "Contado", ayuda: "paga al recibir" },
  { valor: "cuenta_corriente", etiqueta: "Cuenta corriente", ayuda: "paga a N días de la factura" },
  { valor: "anticipado", etiqueta: "Anticipado", ayuda: "paga antes de que se le entregue" },
]

export const FORMAS: { valor: FormaPago; etiqueta: string }[] = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "cheque", etiqueta: "Cheque" },
]

const entero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Deja la condición coherente sin rechazar nada (Juan: "no frenar nada"):
 * plazo solo en cuenta corriente, días de cheque solo con cheque, hasta >= desde.
 * Lo que falta queda vacío (null), nunca un valor supuesto.
 */
export function normalizarCondicion(c: Partial<CondicionPago>): CondicionPago {
  const tipo = (["contado", "cuenta_corriente", "anticipado"] as const).find((t) => t === c.condicion_pago_tipo) ?? null
  const forma = (["efectivo", "transferencia", "cheque"] as const).find((f) => f === c.forma_pago) ?? null
  const plazo = tipo === "cuenta_corriente" ? entero(c.plazo_dias) : tipo ? 0 : null
  let desde = forma === "cheque" ? entero(c.cheque_dias_desde) : null
  let hasta = forma === "cheque" ? entero(c.cheque_dias_hasta) : null
  if (desde == null && hasta != null) desde = hasta
  if (hasta == null && desde != null) hasta = desde
  if (desde != null && hasta != null && hasta < desde) [desde, hasta] = [hasta, desde]
  return { condicion_pago_tipo: tipo, plazo_dias: plazo, forma_pago: forma, cheque_dias_desde: desde, cheque_dias_hasta: hasta }
}

/** "Cheque al día" · "Cheque a 30 días" · "Cheques de 60 a 90 días" · "Cheque" (sin días) */
export function textoCheque(desde: number | null, hasta: number | null): string {
  if (desde == null && hasta == null) return "Cheque"
  const d = desde ?? hasta!
  const h = hasta ?? d
  if (d === h) return d === 0 ? "Cheque al día" : `Cheque a ${d} días`
  return d === 0 ? `Cheques del día a ${h} días` : `Cheques de ${d} a ${h} días`
}

/** "Contado" · "Cuenta corriente 30 días" · "Anticipado" (vacío si no hay condición) */
export function textoCondicion(c: Pick<CondicionPago, "condicion_pago_tipo" | "plazo_dias">): string {
  if (c.condicion_pago_tipo === "contado") return "Contado"
  if (c.condicion_pago_tipo === "anticipado") return "Anticipado"
  if (c.condicion_pago_tipo === "cuenta_corriente") return c.plazo_dias ? `Cuenta corriente ${c.plazo_dias} días` : "Cuenta corriente"
  return ""
}

/** "Efectivo" · "Transferencia" · "Cheques de 60 a 90 días" (vacío si no hay forma) */
export function textoForma(c: Pick<CondicionPago, "forma_pago" | "cheque_dias_desde" | "cheque_dias_hasta">): string {
  if (c.forma_pago === "efectivo") return "Efectivo"
  if (c.forma_pago === "transferencia") return "Transferencia"
  if (c.forma_pago === "cheque") return textoCheque(c.cheque_dias_desde, c.cheque_dias_hasta)
  return ""
}

/** "Contado · Efectivo" · "Cuenta corriente 30 días · Cheques de 60 a 90 días" (vacío si no hay nada) */
export function textoCondicionPago(c: CondicionPago): string {
  return [textoCondicion(c), textoForma(c)].filter(Boolean).join(" · ")
}

/**
 * Texto viejo de clientes.condicion_pago → campos nuevos (Juan: "todos contado según
 * su condición de pago"). Misma tabla que el disparador de la base. Un texto que no se
 * reconoce (o vacío) no inventa nada: devuelve todo vacío.
 */
export const TEXTO_VIEJO: Record<string, CondicionPago> = {
  "efectivo": { condicion_pago_tipo: "contado", plazo_dias: 0, forma_pago: "efectivo", cheque_dias_desde: null, cheque_dias_hasta: null },
  "transferencia": { condicion_pago_tipo: "contado", plazo_dias: 0, forma_pago: "transferencia", cheque_dias_desde: null, cheque_dias_hasta: null },
  "cheque al dia": { condicion_pago_tipo: "contado", plazo_dias: 0, forma_pago: "cheque", cheque_dias_desde: 0, cheque_dias_hasta: 0 },
  "cheque 30 dias": { condicion_pago_tipo: "contado", plazo_dias: 0, forma_pago: "cheque", cheque_dias_desde: 30, cheque_dias_hasta: 30 },
  "cheque 30/60/90": { condicion_pago_tipo: "contado", plazo_dias: 0, forma_pago: "cheque", cheque_dias_desde: 30, cheque_dias_hasta: 90 },
}

const claveTexto = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim()

export function desdeTextoViejo(texto: string | null | undefined): CondicionPago {
  if (!texto) return { ...CONDICION_VACIA }
  const k = claveTexto(texto)
  if (TEXTO_VIEJO[k]) return { ...TEXTO_VIEJO[k] }
  // "Cheque 45 días" / "cheque a 45 dias" (escrito a mano en una APK o un Excel)
  const m = k.match(/^cheques? (?:a )?(\d{1,3}) dias?$/)
  if (m) {
    const d = Number(m[1])
    return { condicion_pago_tipo: "contado", plazo_dias: 0, forma_pago: "cheque", cheque_dias_desde: d, cheque_dias_hasta: d }
  }
  return { ...CONDICION_VACIA }
}

/**
 * Campos nuevos → texto viejo, para las APK instaladas: si es contado y la forma
 * tiene nombre viejo, ese nombre ("Efectivo", "Cheque 30 días"…); si no, el texto
 * nuevo completo ("Cuenta corriente 30 días · Efectivo"). Sin datos = null.
 */
export function textoViejo(c: CondicionPago): string | null {
  if (c.condicion_pago_tipo === "contado") {
    if (c.forma_pago === "efectivo") return "Efectivo"
    if (c.forma_pago === "transferencia") return "Transferencia"
    if (c.forma_pago === "cheque") {
      if (c.cheque_dias_desde === 0 && c.cheque_dias_hasta === 0) return "Cheque al día"
      if (c.cheque_dias_desde === 30 && c.cheque_dias_hasta === 30) return "Cheque 30 días"
      if (c.cheque_dias_desde === 30 && c.cheque_dias_hasta === 90) return "Cheque 30/60/90"
    }
  }
  return textoCondicionPago(c) || null
}

/** Vencimiento de la deuda: fecha del comprobante + plazo (contado y anticipado = el mismo día). "AAAA-MM-DD" */
export function vencimientoDeuda(fechaComprobanteISO: string, plazoDias: number | null | undefined): string {
  return sumarDiasISO(fechaComprobanteISO.slice(0, 10), Math.max(0, Math.trunc(Number(plazoDias) || 0)))
}

/**
 * Fechas de los cheques: cuentan desde el VENCIMIENTO. Ejemplo de Juan: CC 30 días +
 * cheque a 60 → entrego el 19/11, vence el 19/12 y el cheque es del 19/02.
 * Devuelve { desde, hasta } ("AAAA-MM-DD"); null si la forma no es cheque.
 */
export function fechasCheque(vencimientoISO: string, c: Pick<CondicionPago, "forma_pago" | "cheque_dias_desde" | "cheque_dias_hasta">): { desde: string; hasta: string } | null {
  if (c.forma_pago !== "cheque") return null
  const d = c.cheque_dias_desde ?? c.cheque_dias_hasta ?? 0
  const h = c.cheque_dias_hasta ?? d
  return { desde: sumarDiasISO(vencimientoISO, d), hasta: sumarDiasISO(vencimientoISO, h) }
}
