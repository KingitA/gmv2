// =====================================================
// Sistema de Precios GM — Calculador
// =====================================================
//
// Flujo:
// 1. Precio base = precio_compra - descuentos + margen - descuento_propio
// 2. Precio lista = precio_base × (1 + recargo_lista%)
// 3. Precio con descuento cliente = precio_lista × (1 - descuento_especial%)
// 4. Precio final + IVA según método de facturación del pedido
//
// Tipos de facturación:
// - "Factura": todo va con IVA discriminado al pie
//     → artículos blancos: precio + IVA 21% discriminado
//     → artículos negros: precio -10% + IVA 21% discriminado
// - "Presupuesto": nada discrimina IVA
//     → artículos blancos: IVA incluido en precio (×1.21)
//     → artículos negros: sin IVA
// - "Final": genera 2 comprobantes
//     → artículos blancos → Factura con IVA discriminado
//     → artículos negros → Presupuesto sin IVA
// =====================================================

export interface DatosArticulo {
  precio_compra: number
  descuento1: number
  descuento2: number
  descuento3: number
  descuento4: number
  tipo_descuento: "cascada" | "sobre_lista"  // del proveedor
  porcentaje_ganancia: number
  descuento_propio?: number  // descuento por stock viejo, promo nuestra
  categoria: string          // PERFUMERIA, LIMPIEZA, BAZAR, etc.
  iva_compras: "factura" | "adquisicion_stock" | "mixto"  // blanco, negro, mixto
  iva_ventas: "factura" | "presupuesto"                    // blanco o negro en ventas
}

export interface DatosLista {
  recargo_limpieza_bazar: number
  recargo_perfumeria_negro: number
  recargo_perfumeria_blanco: number
}

export type MetodoFacturacion = "Factura" | "Presupuesto" | "Final"

export interface ResultadoPrecio {
  // Paso 1
  costoNeto: number
  precioBase: number

  // Paso 2
  recargoListaPct: number
  precioLista: number

  // Paso 3 (descuento cliente)
  descuentoClientePct: number
  precioConDescuento: number

  // Paso 4 (facturación)
  descuentoNegroEnFacturaPct: number   // 10% si negro va en factura
  precioAntesIva: number
  ivaIncluido: boolean                  // true = IVA dentro del precio, false = discriminado aparte
  ivaPct: number                        // 21 o 0
  montoIvaDiscriminado: number          // el monto que va al pie de la factura (0 si incluido)
  precioUnitarioFinal: number           // lo que se muestra al cliente

  // Info para comprobante
  vaEnComprobante: "factura" | "presupuesto"  // en qué comprobante cae este artículo
}

// ─── Paso 1: Precio Base ───────────────────────────────

export function calcularPrecioBase(art: DatosArticulo): { costoNeto: number; precioBase: number } {
  let costoNeto = art.precio_compra || 0

  const d1 = art.descuento1 || 0
  const d2 = art.descuento2 || 0
  const d3 = art.descuento3 || 0
  const d4 = art.descuento4 || 0

  if (art.tipo_descuento === "cascada") {
    costoNeto *= (1 - d1 / 100)
    costoNeto *= (1 - d2 / 100)
    costoNeto *= (1 - d3 / 100)
    costoNeto *= (1 - d4 / 100)
  } else {
    // sobre_lista: se suman y aplican de una
    const descTotal = d1 + d2 + d3 + d4
    costoNeto *= (1 - descTotal / 100)
  }

  // Margen de ganancia
  const margen = art.porcentaje_ganancia || 0
  let precioBase = costoNeto * (1 + margen / 100)

  // Descuento propio (promo nuestra, stock viejo)
  if (art.descuento_propio && art.descuento_propio > 0) {
    precioBase *= (1 - art.descuento_propio / 100)
  }

  return {
    costoNeto: round2(costoNeto),
    precioBase: round2(precioBase),
  }
}

// ─── Paso 2: Recargo de Lista ──────────────────────────

export function obtenerRecargoLista(art: DatosArticulo, lista: DatosLista): number {
  const esPerfumeria = (art.categoria || "").toUpperCase().includes("PERFUMERIA")
    || (art.categoria || "").toUpperCase().includes("PERFUMERÍA")

  if (esPerfumeria) {
    // Perfumería: depende de si se compra en blanco o negro
    if (art.iva_compras === "adquisicion_stock") {
      return lista.recargo_perfumeria_negro  // negro
    } else {
      return lista.recargo_perfumeria_blanco // blanco (factura o mixto)
    }
  } else {
    // Limpieza, Bazar, y cualquier otra categoría
    return lista.recargo_limpieza_bazar
  }
}

// ─── Paso 3 + 4: Precio Final ─────────────────────────

export function calcularPrecioFinal(
  art: DatosArticulo,
  lista: DatosLista,
  metodoFacturacion: MetodoFacturacion,
  descuentoCliente: number = 0,
): ResultadoPrecio {
  // Paso 1
  const { costoNeto, precioBase } = calcularPrecioBase(art)

  // Paso 2
  const recargoListaPct = obtenerRecargoLista(art, lista)
  const precioLista = round2(precioBase * (1 + recargoListaPct / 100))

  // Paso 3 — Descuento del cliente
  const descuentoClientePct = descuentoCliente || 0
  const precioConDescuento = round2(precioLista * (1 - descuentoClientePct / 100))

  // Paso 4 — IVA según facturación
  const esNegro = art.iva_ventas === "presupuesto"

  // Determinar en qué comprobante cae
  let vaEnComprobante: "factura" | "presupuesto"
  if (metodoFacturacion === "Final") {
    vaEnComprobante = esNegro ? "presupuesto" : "factura"
  } else if (metodoFacturacion === "Factura") {
    vaEnComprobante = "factura"
  } else {
    vaEnComprobante = "presupuesto"
  }

  let descuentoNegroEnFacturaPct = 0
  let precioAntesIva = precioConDescuento
  let ivaIncluido = false
  let ivaPct = 0
  let montoIvaDiscriminado = 0
  let precioUnitarioFinal = precioConDescuento

  if (vaEnComprobante === "factura") {
    // ── VA EN FACTURA ──
    if (esNegro) {
      // Artículo negro en factura: -10% + IVA 21% discriminado
      descuentoNegroEnFacturaPct = 10
      precioAntesIva = round2(precioConDescuento * 0.90)
    } else {
      // Artículo blanco en factura: normal + IVA 21% discriminado
      precioAntesIva = precioConDescuento
    }
    ivaPct = 21
    montoIvaDiscriminado = round2(precioAntesIva * 0.21)
    precioUnitarioFinal = precioAntesIva  // en factura el precio unitario es sin IVA
    ivaIncluido = false

  } else {
    // ── VA EN PRESUPUESTO ──
    if (esNegro) {
      // Artículo negro en presupuesto: sin IVA
      precioAntesIva = precioConDescuento
      ivaPct = 0
      montoIvaDiscriminado = 0
      precioUnitarioFinal = precioConDescuento
      ivaIncluido = false
    } else {
      // Artículo blanco en presupuesto: IVA incluido en precio
      precioAntesIva = precioConDescuento
      ivaPct = 21
      montoIvaDiscriminado = 0  // no se discrimina
      precioUnitarioFinal = round2(precioConDescuento * 1.21)  // incluido
      ivaIncluido = true
    }
  }

  return {
    costoNeto,
    precioBase,
    recargoListaPct,
    precioLista,
    descuentoClientePct,
    precioConDescuento,
    descuentoNegroEnFacturaPct,
    precioAntesIva,
    ivaIncluido,
    ivaPct,
    montoIvaDiscriminado,
    precioUnitarioFinal,
    vaEnComprobante,
  }
}

// ─── Helper para calcular totales de un pedido completo ──

export interface ItemPedidoParaCalculo {
  articulo: DatosArticulo
  cantidad: number
}

export interface TotalesComprobante {
  tipo: "factura" | "presupuesto"
  items: Array<{
    articuloIndex: number
    cantidad: number
    precioUnitario: number
    subtotal: number
    ivaUnitario: number
    descNegroAplicado: boolean
    resultado: ResultadoPrecio
  }>
  subtotalNeto: number
  totalIva: number
  totalFinal: number
}

export function calcularTotalesPedido(
  items: ItemPedidoParaCalculo[],
  lista: DatosLista,
  metodoFacturacion: MetodoFacturacion,
  descuentoCliente: number = 0,
): TotalesComprobante[] {
  const comprobantes: Record<string, TotalesComprobante> = {}

  items.forEach((item, index) => {
    const resultado = calcularPrecioFinal(item.articulo, lista, metodoFacturacion, descuentoCliente)
    const tipo = resultado.vaEnComprobante

    if (!comprobantes[tipo]) {
      comprobantes[tipo] = {
        tipo,
        items: [],
        subtotalNeto: 0,
        totalIva: 0,
        totalFinal: 0,
      }
    }

    const subtotalItem = round2(resultado.precioUnitarioFinal * item.cantidad)
    const ivaItem = round2(resultado.montoIvaDiscriminado * item.cantidad)

    comprobantes[tipo].items.push({
      articuloIndex: index,
      cantidad: item.cantidad,
      precioUnitario: resultado.precioUnitarioFinal,
      subtotal: subtotalItem,
      ivaUnitario: resultado.montoIvaDiscriminado,
      descNegroAplicado: resultado.descuentoNegroEnFacturaPct > 0,
      resultado,
    })

    if (resultado.ivaIncluido) {
      // IVA incluido: el subtotal ya tiene IVA adentro
      comprobantes[tipo].subtotalNeto += subtotalItem
      comprobantes[tipo].totalFinal += subtotalItem
    } else {
      // IVA discriminado: subtotal + IVA aparte
      comprobantes[tipo].subtotalNeto += subtotalItem
      comprobantes[tipo].totalIva += ivaItem
      comprobantes[tipo].totalFinal += subtotalItem + ivaItem
    }
  })

  // Redondear totales
  const result = Object.values(comprobantes)
  result.forEach(c => {
    c.subtotalNeto = round2(c.subtotalNeto)
    c.totalIva = round2(c.totalIva)
    c.totalFinal = round2(c.totalFinal)
  })

  return result
}

// ─── Utilidades ────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
