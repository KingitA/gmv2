"use server"

import { createClient } from "@/lib/supabase/server"
import { calculatePricing, calculateProductPrice, type PricingContext } from "@/lib/pricing/pricing-engine"

/**
 * Get freight cost for a specific zone
 */
export async function getZonaFlete(zona: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.from("zonas_flete").select("*").eq("nombre", zona).eq("activo", true).single()

  if (error) {
    // Return default freight if zone not found
    return { costo_flete: 0, dias_entrega: 1 }
  }

  return data
}

/**
 * Calculate complete pricing for an order
 */
export async function calculateOrderPricing(
  clienteId: string,
  items: Array<{
    producto_id: string
    cantidad: number
  }>,
  options?: {
    descuento_adicional?: number
    aplicar_descuento_pronto_pago?: boolean
  },
) {
  const supabase = await createClient()

  // Get client info
  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select(
      `
      *,
      puntos_cliente:puntos_cliente(nivel, descuento_nivel)
    `,
    )
    .eq("id", clienteId)
    .single()

  if (clienteError) throw clienteError

  // Get products info
  const productIds = items.map((item) => item.producto_id)
  const { data: productos, error: productosError } = await supabase
    .from("productos")
    .select(
      `
      *,
      proveedores:proveedor_id(margen_base, comision_viajante)
    `,
    )
    .in("id", productIds)

  if (productosError) throw productosError

  // Get freight info
  const zonaFlete = await getZonaFlete(cliente.zona)

  // Build pricing context
  const pricingContext: PricingContext = {
    cliente: {
      id: cliente.id,
      descuento_especial: cliente.descuento_especial || 0,
      dias_credito: cliente.dias_credito || 0,
      condicion_iva: cliente.condicion_iva,
      aplica_percepciones: cliente.aplica_percepciones,
      zona: cliente.zona,
      nivel_puntos: cliente.puntos_cliente?.[0]?.nivel,
    },
    items: items.map((item) => {
      const producto = productos.find((p) => p.id === item.producto_id)!
      return {
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_base: producto.precio_base,
        unidades_por_bulto: producto.unidades_por_bulto,
      }
    }),
    proveedor: productos[0]?.proveedores,
    zona_flete: zonaFlete,
    descuento_adicional: options?.descuento_adicional,
    aplicar_descuento_pronto_pago: options?.aplicar_descuento_pronto_pago,
  }

  // Calculate pricing
  const pricing = calculatePricing(pricingContext)

  return pricing
}

/**
 * Get product price with client-specific discounts
 */
export async function getProductPriceForClient(productoId: string, clienteId: string, cantidad = 1) {
  const supabase = await createClient()

  // Get product
  const { data: producto, error: productoError } = await supabase
    .from("productos")
    .select("precio_base, unidades_por_bulto")
    .eq("id", productoId)
    .single()

  if (productoError) throw productoError

  // Get client
  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select(
      `
      descuento_especial,
      puntos_cliente:puntos_cliente(nivel)
    `,
    )
    .eq("id", clienteId)
    .single()

  if (clienteError) throw clienteError

  // Calculate price
  const pricing = calculateProductPrice(
    producto.precio_base,
    {
      descuento_especial: cliente.descuento_especial || 0,
      nivel_puntos: cliente.puntos_cliente?.[0]?.nivel,
    },
    cantidad,
    producto.unidades_por_bulto,
  )

  return pricing
}

/**
 * Get pricing breakdown for display
 */
export async function getPricingBreakdown(clienteId: string) {
  const supabase = await createClient()

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select(
      `
      *,
      puntos_cliente:puntos_cliente(nivel, descuento_nivel, puntos_acumulados)
    `,
    )
    .eq("id", clienteId)
    .single()

  if (error) throw error

  const zonaFlete = await getZonaFlete(cliente.zona)

  return {
    descuento_base: cliente.descuento_especial || 0,
    descuento_nivel: cliente.puntos_cliente?.[0]?.descuento_nivel || 0,
    nivel_actual: cliente.puntos_cliente?.[0]?.nivel || "bronce",
    puntos_acumulados: cliente.puntos_cliente?.[0]?.puntos_acumulados || 0,
    dias_credito: cliente.dias_credito,
    condicion_iva: cliente.condicion_iva,
    aplica_percepciones: cliente.aplica_percepciones,
    zona: cliente.zona,
    costo_flete_base: zonaFlete.costo_flete,
    dias_entrega: zonaFlete.dias_entrega,
  }
}
