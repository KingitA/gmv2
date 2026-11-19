/**
 * Mail de la orden de pago al proveedor: a quién va y qué dice. Archivo PURO (sin base ni red).
 * Test: mobile/packages/core/test/credicoop.test.ts (por eso los imports son relativos).
 *
 * Decisión de Juan (19/11/2026): cuando la orden queda pagada, se le manda al proveedor «en caso
 * de tener alguien a quien mandárselo, si no, queda cerrada sin enviar».
 */
import { fecha, moneda } from "../formato"
import { mailValido } from "../compras/mail-orden"

const separar = (v: unknown): string[] => {
  const out: string[] = []
  for (const parte of String(v ?? "").split(/[,;\s]+/)) {
    const m = parte.trim().toLowerCase()
    if (m && mailValido(m) && !out.includes(m)) out.push(m)
  }
  return out
}

export type OrigenMailPago = "pagos" | "oficina" | "general" | "vendedor"

/**
 * A quién se le manda la orden de pago: el mail de pagos de la ficha si existe ese dato; si no,
 * el de la oficina (administración), el general, y recién al final el del vendedor.
 * Sin ninguno → `para` vacío: la orden queda pagada sin enviar.
 */
export function mailsParaOrdenPago(p: Record<string, unknown> | null | undefined): { para: string[]; origen: OrigenMailPago | null } {
  const fuentes: [OrigenMailPago, unknown][] = [["pagos", p?.mail_pagos], ["oficina", p?.mail_oficina], ["general", p?.email], ["vendedor", p?.mail_vendedor]]
  for (const [origen, v] of fuentes) {
    const mails = separar(v)
    if (mails.length > 0) return { para: mails, origen }
  }
  return { para: [], origen: null }
}

const MEDIO: Record<string, string> = { efectivo: "Efectivo", cheque: "Cheque", cheque_propio: "Cheque propio", transferencia: "Transferencia", deposito: "Depósito" }

export interface DatosMailOrdenPago {
  numero_op: string
  fecha: string
  proveedor: string
  empresa: string
  monto_total: number
  total_retenciones: number
  neto_a_pagar: number
  numero_certificado?: string | null
  medios: Array<{ medio: string; monto: number; referencia?: string | null }>
  telefono?: string | null
}

export const asuntoOrdenPago = (d: Pick<DatosMailOrdenPago, "numero_op" | "empresa">) => `Orden de pago ${d.numero_op} — ${d.empresa}`

export function cuerpoOrdenPago(d: DatosMailOrdenPago): string {
  const lineas: string[] = [
    `Estimados ${d.proveedor}:`,
    "",
    `Les informamos que ${d.empresa} realizó el pago de la orden de pago N° ${d.numero_op}, del ${fecha(d.fecha)}.`,
    "",
    `Importe de los comprobantes: ${moneda(d.monto_total)}`,
  ]
  if (d.total_retenciones > 0) {
    lineas.push(`Retenciones: ${moneda(d.total_retenciones)}${d.numero_certificado ? ` (certificado N° ${d.numero_certificado}, adjunto)` : ""}`)
  }
  lineas.push(`Importe pagado: ${moneda(d.neto_a_pagar)}`)
  const medios = d.medios.filter((m) => m.monto > 0)
  if (medios.length > 0) {
    lineas.push("", "Forma de pago:")
    for (const m of medios) lineas.push(`- ${MEDIO[m.medio] ?? m.medio}: ${moneda(m.monto)}${m.referencia ? ` (${m.referencia})` : ""}`)
  }
  lineas.push("", d.total_retenciones > 0 && d.numero_certificado ? "Adjuntamos la orden de pago y el certificado de retención." : "Adjuntamos la orden de pago.", "", "Saludos,", d.empresa)
  if (d.telefono) lineas.push(`Tel. ${d.telefono}`)
  return lineas.join("\n")
}
