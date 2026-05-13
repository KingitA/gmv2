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
