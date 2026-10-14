// Extracto de cuenta corriente de un cliente (libro mayor cuenta_corriente_clientes):
// facturas, presupuestos, pagos, notas de crédito/débito y ajustes con el saldo
// acumulado. UNA sola versión para el ERP (/clientes/[id]/cuenta-corriente) y la app
// del vendedor (Cobrar → Resumen): pedido del dueño 14/10/2026, "tiene que ser lo mismo
// que vemos en el ERP". PURO: sin DB (la carga está en extracto-servidor.ts).

export interface MovimientoCC {
  id?: string
  fecha: string
  tipo_movimiento: string
  debe: number
  haber: number
  numero_comprobante?: string | null
  observaciones?: string | null
  referencia_tipo?: string | null
  referencia_id?: string | null
  /** Tipo real del comprobante referenciado (FA, PRES, NCA, REV…) */
  comprobante_tipo?: string | null
}

export const ETIQUETA_MOV: Record<string, string> = {
  venta: "Factura / Venta",
  factura: "Factura",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste manual",
  debito: "Ajuste (débito)",
  credito: "Ajuste (crédito)",
  devolucion: "Devolución",
  presupuesto: "Presupuesto",
}

// Con el tipo real del comprobante referenciado, la etiqueta es exacta
// (la REV interna no es lo mismo que una NC fiscal)
export const ETIQUETA_TIPO: Record<string, string> = {
  FA: "Factura A",
  FB: "Factura B",
  FC: "Factura C",
  PRES: "Presupuesto",
  REV: "Reversa",
  NC: "Nota de crédito",
  NCA: "Nota de crédito A",
  NCB: "Nota de crédito B",
  NCC: "Nota de crédito C",
  NDA: "Nota de débito A",
  NDB: "Nota de débito B",
  NDC: "Nota de débito",
  REM: "Remito",
}

export function etiquetaMovimiento(m: MovimientoCC): string {
  // La reversa de un pago anulado se postea como tipo 'ajuste' pero NO es
  // un ajuste manual: rotularla por su referencia real.
  if (m.referencia_tipo === "pago_anulacion") return "Anulación de pago"
  return (m.comprobante_tipo && ETIQUETA_TIPO[m.comprobante_tipo]) ?? ETIQUETA_MOV[m.tipo_movimiento] ?? (m.tipo_movimiento || "Movimiento")
}

/** true = el movimiento es un comprobante de venta con PDF (se abre/comparte). */
export const esComprobanteConPdf = (m: MovimientoCC) => m.referencia_tipo === "comprobante_venta" && !!m.referencia_id

/** Movimientos en orden cronológico con el saldo acumulado (debe − haber). */
export function armarExtracto<T extends MovimientoCC>(movimientos: T[]): Array<T & { saldo_acumulado: number }> {
  const movs = [...movimientos].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  let acumulado = 0
  return movs.map((m) => {
    acumulado += Number(m.debe || 0) - Number(m.haber || 0)
    return { ...m, saldo_acumulado: Math.round(acumulado * 100) / 100 }
  })
}
