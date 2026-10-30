// Cómo se MUESTRA el estado de pago de un comprobante con 10 % contado (P2-23).
// Regla de Juan: nada del 10 % se muestra como pago, saldo ni "a favor". Si
// debía $100 con contado, "a pagar $90" (el saldo ya viene neto); pagó $90 → $0.
//  - El PRES/FA cuyo único crédito es la REV/NC del contado no está "parcial":
//    está pendiente (con 10 % contado) hasta que el cliente paga algo.
//  - La REV/NC del contado no está "pagada": está aplicada a su comprobante.
// Solo pantalla: estado_pago y saldo_pendiente de la base no se tocan.
import { esBonificacionContado } from "@/lib/pedidos/anulacion-pedido"

const CREDITOS = new Set(["NCA", "NCB", "NCC", "REV"])

export type EstadoPagoVista = "pendiente" | "parcial" | "pagado" | "aplicada"

export interface ComprobanteVista {
  tipo_comprobante: string
  total_factura: number | string | null
  saldo_pendiente: number | string | null
  estado_pago: string
  observaciones?: string | null
}

/** ¿Es la REV/NC del 10 % contado? */
export function esNotaContado(c: { tipo_comprobante: string; observaciones?: string | null }): boolean {
  return CREDITOS.has(c.tipo_comprobante) && esBonificacionContado(c.observaciones)
}

/**
 * @param contadoAplicado cuánto de notas del 10 % contado tiene imputado este comprobante
 * @param aplicadaA       para una nota del contado: números de los comprobantes a los que se aplicó
 */
export function vistaEstadoPago(
  c: ComprobanteVista,
  contadoAplicado = 0,
  aplicadaA: string[] = [],
): { estado: EstadoPagoVista; nota: string | null } {
  const saldo = Number(c.saldo_pendiente) || 0
  if (esNotaContado(c) && Math.abs(saldo) < 0.005) {
    return { estado: "aplicada", nota: aplicadaA.length ? `Aplicada a ${aplicadaA.join(", ")}` : "10 % contado aplicado" }
  }
  const estado = (["pendiente", "parcial", "pagado"].includes(c.estado_pago) ? c.estado_pago : "pendiente") as EstadoPagoVista
  if (contadoAplicado > 0.005 && Math.abs(saldo) >= 0.005) {
    // Lo que pagó de verdad = total − saldo − el 10 %
    const pagado = (Number(c.total_factura) || 0) - saldo - contadoAplicado
    if (pagado <= 0.005) return { estado: "pendiente", nota: "con 10 % contado" }
    return { estado, nota: "con 10 % contado" }
  }
  return { estado, nota: null }
}
