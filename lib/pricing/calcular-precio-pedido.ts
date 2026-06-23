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
  segmento_precio?: "limpieza_bazar" | "perfumeria" | null
  rubros?: { slug: string } | null
  descuentos: DescuentoTipado[]
  proveedor?: { tipo_descuento?: string } | null
  precio_lista_especial?: number | null
  oferta_lista_especial?: number | null
}

export interface PrecioCalculado {
  precioAlCliente: number   // precio final que paga el cliente (IVA incluido para presup, neto para factura)
  precioNeto: number        // precio antes de IVA (para presupuesto: incluye IVA dentro)
  ivaUnitario: number       // IVA por unidad (0 si incluido)
  ivaIncluido: boolean
  vaEnComprobante: "factura" | "presupuesto"
  // Breakdown para kardex / display
  precioLista: number       // precio post-recargo, post-oferta, ANTES de bonificaciones (pre-IVA adj)
  bonifGeneralPct: number   // bonificación general del cliente aplicada al neto
  bonifViajantePct: number  // bonificación viajante del cliente aplicada al neto
  precioConDescuento: number // precioLista * (1-general/100)*(1-viajante/100), pre-IVA adj
}

function round2(n: number) { return Math.round(n * 100) / 100 }

export function calcularPrecioPedido(
  articulo: ArticuloPrecioInput,
  listaDatos: DatosLista,
  metodoFacturacion: MetodoFacturacion,
  bonif: { generalPct?: number; viajantePct?: number } = {},
): PrecioCalculado {
  const datosArticulo = articuloToDatosArticulo(articulo as any, articulo.descuentos)
  const resultado = calcularPrecioFinal(datosArticulo, listaDatos, metodoFacturacion, bonif)

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
    bonifGeneralPct: resultado.bonifGeneralPct,
    bonifViajantePct: resultado.bonifViajantePct,
    precioConDescuento: resultado.precioConDescuento,
  }
}
