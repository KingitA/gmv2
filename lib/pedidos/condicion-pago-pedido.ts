// Condición de pago del PEDIDO y de sus comprobantes (Juan, 19/11/2026 — fase 2 de 4).
//
// - Al crear el pedido se copia la condición de la ficha del cliente a las columnas
//   *_pedido (como se congelan la lista y el método). Se puede cambiar solo para ese
//   pedido desde el ERP mientras sea editable.
// - NO FRENA NADA: ficha vacía → columnas vacías (se muestra en rojo), nunca un valor
//   supuesto ni un rechazo.
// - Cada comprobante guarda condicion_pago_texto (la del pedido; si no tiene, la de la
//   ficha) y fecha_vencimiento = fecha del comprobante + plazo (contado y anticipado: el
//   mismo día). Sin condición: vence el MISMO DÍA (como la apertura de saldos), y el
//   texto queda vacío.
//
// Módulo PURO (sin base de datos): lo usan createPedido, la facturación y los tests.

import { normalizarCondicion, textoCondicionPago, vencimientoDeuda, type CondicionPago } from "../clientes/condicion-pago"

export const COLS_CONDICION_PEDIDO = [
  "condicion_pago_tipo_pedido", "plazo_dias_pedido", "forma_pago_pedido", "cheque_dias_desde_pedido", "cheque_dias_hasta_pedido",
] as const

export const COLS_CONDICION_CLIENTE = ["condicion_pago_tipo", "plazo_dias", "forma_pago", "cheque_dias_desde", "cheque_dias_hasta"] as const

export interface ColumnasCondicionPedido {
  condicion_pago_tipo_pedido: CondicionPago["condicion_pago_tipo"]
  plazo_dias_pedido: number | null
  forma_pago_pedido: CondicionPago["forma_pago"]
  cheque_dias_desde_pedido: number | null
  cheque_dias_hasta_pedido: number | null
}

/** Condición de la ficha del cliente (columnas sin sufijo), normalizada. */
export function condicionDeFicha(c: Record<string, any> | null | undefined): CondicionPago {
  return normalizarCondicion({
    condicion_pago_tipo: c?.condicion_pago_tipo,
    plazo_dias: c?.plazo_dias,
    forma_pago: c?.forma_pago,
    cheque_dias_desde: c?.cheque_dias_desde,
    cheque_dias_hasta: c?.cheque_dias_hasta,
  })
}

/** Condición guardada en el pedido (columnas *_pedido), normalizada. */
export function condicionDePedido(p: Record<string, any> | null | undefined): CondicionPago {
  return normalizarCondicion({
    condicion_pago_tipo: p?.condicion_pago_tipo_pedido,
    plazo_dias: p?.plazo_dias_pedido,
    forma_pago: p?.forma_pago_pedido,
    cheque_dias_desde: p?.cheque_dias_desde_pedido,
    cheque_dias_hasta: p?.cheque_dias_hasta_pedido,
  })
}

/** Condición → columnas *_pedido (para el insert del pedido o la edición). */
export function columnasPedido(c: Partial<CondicionPago>): ColumnasCondicionPedido {
  const n = normalizarCondicion(c)
  return {
    condicion_pago_tipo_pedido: n.condicion_pago_tipo,
    plazo_dias_pedido: n.plazo_dias,
    forma_pago_pedido: n.forma_pago,
    cheque_dias_desde_pedido: n.cheque_dias_desde,
    cheque_dias_hasta_pedido: n.cheque_dias_hasta,
  }
}

export const condicionVacia = (c: CondicionPago) => !c.condicion_pago_tipo && !c.forma_pago

/** La que rige un comprobante: la del pedido si tiene algo cargado; si no, la de la ficha. */
export function condicionParaComprobante(pedido: Record<string, any> | null | undefined, cliente: Record<string, any> | null | undefined): CondicionPago {
  const delPedido = condicionDePedido(pedido)
  return condicionVacia(delPedido) ? condicionDeFicha(cliente) : delPedido
}

/** Texto y vencimiento que se guardan en el comprobante. Sin condición: texto null, vence el mismo día. */
export function datosPagoComprobante(fechaComprobanteISO: string, c: CondicionPago): { condicion_pago_texto: string | null; fecha_vencimiento: string } {
  return {
    condicion_pago_texto: textoCondicionPago(c) || null,
    fecha_vencimiento: vencimientoDeuda(fechaComprobanteISO, c.condicion_pago_tipo === "cuenta_corriente" ? c.plazo_dias : 0),
  }
}

/** Etiqueta corta para el listado de pedidos: "Contado" · "CC 30 d" · "Anticipado"; "" si no hay condición. */
export function etiquetaCortaCondicion(c: CondicionPago): string {
  if (c.condicion_pago_tipo === "contado") return "Contado"
  if (c.condicion_pago_tipo === "anticipado") return "Anticipado"
  if (c.condicion_pago_tipo === "cuenta_corriente") return c.plazo_dias ? `CC ${c.plazo_dias} d` : "CC"
  return ""
}
