type VendedorComisiones = {
  comision_limpieza_bazar: number
  comision_perfumeria_0: number
  comision_perfumeria_plus: number
}

/**
 * Retorna el porcentaje de comisión según el segmento del artículo y su iva_ventas.
 * - limpieza_bazar → comision_limpieza_bazar
 * - perfumeria + iva_ventas='factura' (blanco) → comision_perfumeria_plus
 * - perfumeria + iva_ventas≠'factura' (negro) → comision_perfumeria_0
 */
export function getComisionPorcentaje(
  vendedor: VendedorComisiones,
  segmento: string | null,
  ivaVentas: string | null,
): number {
  if (segmento === 'limpieza_bazar') return Number(vendedor.comision_limpieza_bazar ?? 0)
  if (segmento === 'perfumeria') {
    return ivaVentas === 'factura'
      ? Number(vendedor.comision_perfumeria_plus ?? 0)
      : Number(vendedor.comision_perfumeria_0 ?? 0)
  }
  return 0
}

/**
 * Retorna el precio neto sin IVA.
 * Solo divide por 1.21 si el método de facturación es presupuesto/REV
 * Y el artículo tiene iva_ventas='factura' (blanco, paga IVA en compras).
 */
export function getPrecioNeto(
  precio: number,
  metodoFacturacion: string | null,
  ivaVentas: string | null,
): number {
  const esPresupuesto =
    metodoFacturacion === 'presupuesto' ||
    metodoFacturacion === 'REV' ||
    metodoFacturacion?.toLowerCase().includes('presupuesto')
  if (esPresupuesto && ivaVentas === 'factura') {
    return precio / 1.21
  }
  return precio
}

function round2(n: number) { return Math.round(n * 100) / 100 }

/**
 * Fórmula ÚNICA de la comisión del vendedor (usada al crear el pedido = "vendida",
 * y al cobrar = "cobrada", y en ajustes).
 *
 *   comisión = baseNeto × cantidad × (1−mercadería%) × (1−financiero%) × max(0, comisión% − viajante%) / 100
 *
 * Regla del dueño (06/10/2026): el descuento de viajante se le descuenta al
 * vendedor en PUNTOS de comisión (20% de comisión con 5% de viajante ⇒ cobra
 * 15%), y esa tasa se aplica sobre el precio SIN el descuento de viajante pero
 * después de todos los demás (oferta, general, mercadería, contado). Si el
 * viajante supera la comisión, la comisión es 0 (nunca negativa).
 *
 * - baseNeto: neto por unidad SIN el viajante. El renglón guarda el neto YA con
 *   el viajante aplicado (`netoIncluyeViajante`, default true): se lo saca
 *   dividiendo por (1 − viajante%). La mercadería bonificada no lleva viajante en
 *   su precio (`netoIncluyeViajante: false`).
 *   Se le quita el IVA si corresponde (presupuesto + iva_ventas='factura').
 * - Mercadería y financiero reducen la base ("la venta real es $90"): la comisión
 *   se paga sobre la venta efectivamente cobrada.
 */
export function calcularComisionMonto(params: {
  precioNetoUnitario: number
  cantidad: number
  metodoFacturacion: string | null
  ivaVentas: string | null
  comisionPct: number
  viajantePct: number
  mercaderiaPct?: number
  financieroPct?: number
  netoIncluyeViajante?: boolean
}): { monto: number; tasaEfectivaPct: number } {
  const viajante = Number(params.viajantePct) || 0
  const netoUnitConViajante = getPrecioNeto(params.precioNetoUnitario, params.metodoFacturacion, params.ivaVentas)
  const sacarViajante = params.netoIncluyeViajante !== false && viajante > 0 && viajante < 100
  const netoUnit = sacarViajante ? netoUnitConViajante / (1 - viajante / 100) : netoUnitConViajante
  const factorBase = (1 - (params.mercaderiaPct || 0) / 100) * (1 - (params.financieroPct || 0) / 100)
  const base = netoUnit * params.cantidad * factorBase
  const tasaEfectivaPct = round2(Math.max(0, (Number(params.comisionPct) || 0) - viajante))
  const monto = round2(base * tasaEfectivaPct / 100)
  return { monto, tasaEfectivaPct }
}
