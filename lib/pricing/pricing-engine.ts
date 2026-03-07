/**
 * Comprehensive Pricing Engine
 * Handles all pricing variables including discounts, freight, taxes, and commissions
 */

export interface PricingContext {
  cliente: {
    id: string
    descuento_especial: number
    dias_credito: number
    condicion_iva: string
    aplica_percepciones: boolean
    zona: string
    nivel_puntos?: string
  }
  items: Array<{
    producto_id: string
    cantidad: number
    precio_base: number
    unidades_por_bulto: number
  }>
  proveedor?: {
    margen_base: number
    comision_viajante: number
  }
  zona_flete?: {
    costo_flete: number
  }
  descuento_adicional?: number
  aplicar_descuento_pronto_pago?: boolean
}

export interface PricingResult {
  items: Array<{
    producto_id: string
    cantidad: number
    precio_unitario: number
    precio_original: number
    descuento_porcentaje: number
    descuento_monto: number
    subtotal: number
  }>
  subtotal: number
  descuento_total: number
  descuento_pronto_pago: number
  flete: number
  iva: number
  percepciones: number
  total: number
  comision_viajante: number
  breakdown: {
    descuento_cliente: number
    descuento_volumen: number
    descuento_nivel: number
    descuento_adicional: number
  }
}

/**
 * Calculate tier-based discount based on loyalty level
 */
function getTierDiscount(nivel?: string): number {
  const tierDiscounts: Record<string, number> = {
    bronce: 0,
    plata: 2,
    oro: 5,
    platino: 8,
  }
  return tierDiscounts[nivel || "bronce"] || 0
}

/**
 * Calculate volume discount based on quantity
 */
function getVolumeDiscount(cantidad: number, unidades_por_bulto: number): number {
  const bultos = Math.floor(cantidad / unidades_por_bulto)

  if (bultos >= 10) return 5 // 5% for 10+ bultos
  if (bultos >= 5) return 3 // 3% for 5-9 bultos
  if (bultos >= 3) return 2 // 2% for 3-4 bultos
  return 0
}

/**
 * Calculate early payment discount based on payment terms
 */
function getEarlyPaymentDiscount(dias_credito: number, aplicar: boolean): number {
  if (!aplicar) return 0

  if (dias_credito === 0) return 3 // 3% for cash payment
  if (dias_credito <= 15) return 2 // 2% for payment within 15 days
  if (dias_credito <= 30) return 1 // 1% for payment within 30 days
  return 0
}

/**
 * Calculate freight cost based on zone and order total
 */
function calculateFreight(zona_flete_costo: number, subtotal: number): number {
  // Free shipping for orders over $50,000
  if (subtotal >= 50000) return 0

  // 50% discount on freight for orders over $25,000
  if (subtotal >= 25000) return zona_flete_costo * 0.5

  return zona_flete_costo
}

/**
 * Calculate IVA based on client's tax condition
 */
function calculateIVA(subtotal: number, condicion_iva: string): number {
  const IVA_RATE = 0.21

  switch (condicion_iva) {
    case "responsable_inscripto":
      return 0 // No IVA for registered taxpayers
    case "exento":
      return 0 // Exempt from IVA
    case "monotributista":
    case "consumidor_final":
    default:
      return subtotal * IVA_RATE
  }
}

/**
 * Calculate retention/perception taxes
 */
function calculatePercepciones(subtotal: number, aplica_percepciones: boolean): number {
  if (!aplica_percepciones) return 0
  return subtotal * 0.03 // 3% retention
}

/**
 * Calculate commission for traveling salesperson
 */
function calculateCommission(total: number, comision_porcentaje: number): number {
  return total * (comision_porcentaje / 100)
}

/**
 * Main pricing calculation function
 */
export function calculatePricing(context: PricingContext): PricingResult {
  const {
    cliente,
    items,
    proveedor,
    zona_flete,
    descuento_adicional = 0,
    aplicar_descuento_pronto_pago = false,
  } = context

  // Calculate tier discount
  const descuento_nivel = getTierDiscount(cliente.nivel_puntos)

  // Process each item
  const processedItems = items.map((item) => {
    // Base discount from client
    const descuento_cliente = cliente.descuento_especial || 0

    // Volume discount
    const descuento_volumen = getVolumeDiscount(item.cantidad, item.unidades_por_bulto)

    // Total item discount (cumulative)
    const descuento_total_item = descuento_cliente + descuento_volumen + descuento_nivel + descuento_adicional

    // Apply discount to price
    const precio_con_descuento = item.precio_base * (1 - descuento_total_item / 100)
    const descuento_monto = item.precio_base - precio_con_descuento
    const subtotal_item = precio_con_descuento * item.cantidad

    return {
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: precio_con_descuento,
      precio_original: item.precio_base,
      descuento_porcentaje: descuento_total_item,
      descuento_monto: descuento_monto * item.cantidad,
      subtotal: subtotal_item,
    }
  })

  // Calculate subtotal
  const subtotal = processedItems.reduce((sum, item) => sum + item.subtotal, 0)

  // Calculate total discount amount
  const descuento_total = processedItems.reduce((sum, item) => sum + item.descuento_monto, 0)

  // Calculate early payment discount
  const descuento_pronto_pago_porcentaje = getEarlyPaymentDiscount(cliente.dias_credito, aplicar_descuento_pronto_pago)
  const descuento_pronto_pago = subtotal * (descuento_pronto_pago_porcentaje / 100)

  // Adjusted subtotal after early payment discount
  const subtotal_ajustado = subtotal - descuento_pronto_pago

  // Calculate freight
  const flete = zona_flete ? calculateFreight(zona_flete.costo_flete, subtotal_ajustado) : 0

  // Calculate taxes
  const iva = calculateIVA(subtotal_ajustado, cliente.condicion_iva)
  const percepciones = calculatePercepciones(subtotal_ajustado, cliente.aplica_percepciones)

  // Calculate final total
  const total = subtotal_ajustado + flete + iva + percepciones

  // Calculate commission
  const comision_viajante = proveedor ? calculateCommission(total, proveedor.comision_viajante) : 0

  // Breakdown of discounts
  const breakdown = {
    descuento_cliente: cliente.descuento_especial || 0,
    descuento_volumen:
      items.reduce((sum, item) => sum + getVolumeDiscount(item.cantidad, item.unidades_por_bulto), 0) / items.length,
    descuento_nivel,
    descuento_adicional,
  }

  return {
    items: processedItems,
    subtotal,
    descuento_total,
    descuento_pronto_pago,
    flete,
    iva,
    percepciones,
    total,
    comision_viajante,
    breakdown,
  }
}

/**
 * Calculate price for a single product with client context
 */
export function calculateProductPrice(
  precio_base: number,
  cliente: {
    descuento_especial: number
    nivel_puntos?: string
  },
  cantidad = 1,
  unidades_por_bulto = 1,
): {
  precio_final: number
  descuento_aplicado: number
  ahorro: number
} {
  const descuento_cliente = cliente.descuento_especial || 0
  const descuento_nivel = getTierDiscount(cliente.nivel_puntos)
  const descuento_volumen = getVolumeDiscount(cantidad, unidades_por_bulto)

  const descuento_total = descuento_cliente + descuento_nivel + descuento_volumen
  const precio_final = precio_base * (1 - descuento_total / 100)
  const ahorro = (precio_base - precio_final) * cantidad

  return {
    precio_final,
    descuento_aplicado: descuento_total,
    ahorro,
  }
}

/**
 * Validate pricing rules and constraints
 */
export function validatePricing(context: PricingContext): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate items
  if (context.items.length === 0) {
    errors.push("No hay productos en el pedido")
  }

  // Validate quantities
  context.items.forEach((item, index) => {
    if (item.cantidad <= 0) {
      errors.push(`Item ${index + 1}: La cantidad debe ser mayor a 0`)
    }
    if (item.precio_base <= 0) {
      errors.push(`Item ${index + 1}: El precio base debe ser mayor a 0`)
    }
  })

  // Calculate pricing to check totals
  const pricing = calculatePricing(context)

  // Check for excessive discounts
  if (pricing.descuento_total > pricing.subtotal * 0.5) {
    warnings.push("El descuento total supera el 50% del subtotal")
  }

  // Check for negative totals
  if (pricing.total < 0) {
    errors.push("El total del pedido no puede ser negativo")
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
