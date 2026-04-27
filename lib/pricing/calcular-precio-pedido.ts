/**
 * Calcula el precio al cliente para un artículo dado un pedido (lista + método de facturación).
 * Usado tanto al crear el pedido como al agregar ítems manualmente.
 *
 * Retorna:
 *   precioAlCliente  — precio con IVA incluido (lo que el cliente paga, lo que va al total del pedido)
 *   precioNeto       — precio sin IVA (para factura A: este va en la línea del comprobante)
 *   ivaUnitario      — monto de IVA por unidad (0 si IVA incluido)
 *   ivaIncluido      — true si el IVA está dentro de precioAlCliente
 *   vaEnComprobante  — "factura" | "presupuesto"
 */

import {
  calcularPrecioFinal,
  articuloToDatosArticulo,
  type DatosLista,
  type MetodoFacturacion,
  type DescuentoTipado,
} from "@/lib/pricing/calculator"

export interface ArticuloPrecioInput {
  id: string
  precio_compra: number
  precio_base?: number | null
  precio_base_contado?: number | null
  porcentaje_ganancia?: number
  bonif_recargo?: number
  categoria?: string
  iva_compras?: string
  iva_ventas?: string
  descuentos: DescuentoTipado[]
  proveedor?: { tipo_descuento?: string } | null
}

export interface PrecioCalculado {
  precioAlCliente: number   // precio final que paga el cliente (IVA incluido para presup, neto para factura)
  precioNeto: number        // precio antes de IVA (para presupuesto: incluye IVA dentro)
  ivaUnitario: number       // IVA por unidad (0 si incluido)
  ivaIncluido: boolean
  vaEnComprobante: "factura" | "presupuesto"
  // Breakdown para kardex
  precioLista: number       // precio post-recargo, ANTES de descuento_cliente (pre-IVA adj)
  descuentoClientePct: number
  precioConDescuento: number // precioLista * (1 - descuentoCliente/100), pre-IVA adj
}

function round2(n: number) { return Math.round(n * 100) / 100 }

export function calcularPrecioPedido(
  articulo: ArticuloPrecioInput,
  listaDatos: DatosLista,
  metodoFacturacion: MetodoFacturacion,
  descuentoCliente: number = 0,
): PrecioCalculado {
  const datosArticulo = articuloToDatosArticulo(articulo as any, articulo.descuentos)
  const resultado = calcularPrecioFinal(datosArticulo, listaDatos, metodoFacturacion, descuentoCliente)

  // precioAlCliente = lo que el cliente realmente paga
  // Para presupuesto: precioUnitarioFinal ya tiene IVA incluido
  // Para factura: precioUnitarioFinal es el neto, el cliente paga neto + IVA
  const precioAlCliente = resultado.vaEnComprobante === "factura"
    ? round2(resultado.precioUnitarioFinal + resultado.montoIvaDiscriminado)
    : resultado.precioUnitarioFinal

  return {
    precioAlCliente,
    precioNeto: resultado.precioUnitarioFinal,
    ivaUnitario: resultado.montoIvaDiscriminado,
    ivaIncluido: resultado.ivaIncluido,
    vaEnComprobante: resultado.vaEnComprobante,
    precioLista: resultado.precioLista,
    descuentoClientePct: resultado.descuentoClientePct,
    precioConDescuento: resultado.precioConDescuento,
  }
}
