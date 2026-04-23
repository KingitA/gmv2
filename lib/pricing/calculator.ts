// =====================================================
// Sistema de Precios GM — Calculador v2
// =====================================================
// Soporta N descuentos tipados (comercial/financiero/promocional)
// + bonificación/recargo ocasional

export interface DescuentoTipado {
  tipo: "comercial" | "financiero" | "promocional"
  porcentaje: number
  orden: number
}

export interface DatosArticulo {
  precio_compra: number
  /** Si está seteado, se usa como precio base directamente sin calcular desde precio_compra */
  precio_base_stored?: number | null
  descuentos: DescuentoTipado[]
  tipo_descuento: "cascada" | "sobre_lista"
  porcentaje_ganancia: number
  bonif_recargo: number             // positivo = recargo, negativo = bonif
  categoria: string
  /** Slug del rubro relacional: 'limpieza' | 'bazar' | 'perfumeria'. Tiene prioridad sobre categoria para detectar segmento. */
  rubro_slug?: string
  iva_compras: "factura" | "adquisicion_stock" | "mixto"
  iva_ventas: "factura" | "presupuesto"
}

export interface DatosLista {
  recargo_limpieza_bazar: number
  recargo_perfumeria_negro: number
  recargo_perfumeria_blanco: number
}

export type MetodoFacturacion = "Factura" | "Presupuesto" | "Final"

export interface ResultadoPrecio {
  costoNeto: number
  precioBase: number
  recargoListaPct: number
  precioLista: number
  descuentoClientePct: number
  precioConDescuento: number
  descuentoNegroEnFacturaPct: number
  precioAntesIva: number
  ivaIncluido: boolean
  ivaPct: number
  montoIvaDiscriminado: number
  precioUnitarioFinal: number
  vaEnComprobante: "factura" | "presupuesto"
}

// Resumen de descuentos por tipo
export interface ResumenDescuentos {
  comercial: number[]
  financiero: number[]
  promocional: number[]
  totalComercial: number
  totalFinanciero: number
  totalPromocional: number
}

export function resumirDescuentos(descuentos: DescuentoTipado[]): ResumenDescuentos {
  const comercial = descuentos.filter(d => d.tipo === "comercial").sort((a, b) => a.orden - b.orden).map(d => d.porcentaje)
  const financiero = descuentos.filter(d => d.tipo === "financiero").sort((a, b) => a.orden - b.orden).map(d => d.porcentaje)
  const promocional = descuentos.filter(d => d.tipo === "promocional").sort((a, b) => a.orden - b.orden).map(d => d.porcentaje)
  return {
    comercial, financiero, promocional,
    totalComercial: comercial.reduce((s, v) => s + v, 0),
    totalFinanciero: financiero.reduce((s, v) => s + v, 0),
    totalPromocional: promocional.reduce((s, v) => s + v, 0),
  }
}

// ─── Paso 1: Precio Base ───────────────────────────────

export function calcularPrecioBase(art: DatosArticulo): { costoNeto: number; precioBase: number } {
  // Feature: precio_base_stored — si está seteado, se usa directamente
  // sin recalcular desde precio_compra, descuentos y margen.
  if (art.precio_base_stored != null && art.precio_base_stored > 0) {
    return { costoNeto: 0, precioBase: art.precio_base_stored }
  }

  let costoNeto = art.precio_compra || 0

  // Ordenar todos los descuentos por orden
  const todosDesc = [...(art.descuentos || [])].sort((a, b) => a.orden - b.orden)

  if (art.tipo_descuento === "cascada") {
    for (const d of todosDesc) {
      costoNeto *= (1 - d.porcentaje / 100)
    }
  } else {
    const sumaDesc = todosDesc.reduce((s, d) => s + d.porcentaje, 0)
    costoNeto *= (1 - sumaDesc / 100)
  }

  // Margen de ganancia
  let precioBase = costoNeto * (1 + (art.porcentaje_ganancia || 0) / 100)

  // Bonificación/recargo
  if (art.bonif_recargo && art.bonif_recargo !== 0) {
    precioBase *= (1 + art.bonif_recargo / 100)
  }

  return { costoNeto: round2(costoNeto), precioBase: round2(precioBase) }
}

// ─── Paso 2: Recargo de Lista ──────────────────────────

export function obtenerRecargoLista(art: DatosArticulo, lista: DatosLista): number {
  // Nuevo: usar rubro_slug si está disponible (más preciso que string de categoria)
  if (art.rubro_slug) {
    if (art.rubro_slug === 'perfumeria') {
      // perf0 = presupuesto (negro), perf+ = factura (blanco)
      return art.iva_ventas === 'presupuesto' ? lista.recargo_perfumeria_negro : lista.recargo_perfumeria_blanco
    }
    return lista.recargo_limpieza_bazar
  }
  // Fallback legacy: detección por string de categoria
  const esPerfumeria = (art.categoria || "").toUpperCase().includes("PERFUMERIA")
    || (art.categoria || "").toUpperCase().includes("PERFUMERÍA")
  if (esPerfumeria) {
    return art.iva_compras === "adquisicion_stock" ? lista.recargo_perfumeria_negro : lista.recargo_perfumeria_blanco
  }
  return lista.recargo_limpieza_bazar
}

// ─── Coeficiente IVA según combinación compras/ventas ──
//
// Determina el ajuste de precio según cómo entró y cómo sale el artículo.
// No es IVA contable — es un ajuste comercial para que el precio no explote.
//
// iva_compras:
//   "adquisicion_stock" = entra en negro (sin IVA)
//   "mixto"             = entra con IVA 10.5%
//   "factura"           = entra en blanco (IVA 21%)
//
// iva_ventas:
//   "presupuesto" = sale en negro
//   "factura"     = sale en blanco (Factura A)

export function obtenerCoeficienteIva(
  iva_compras: DatosArticulo["iva_compras"],
  iva_ventas: DatosArticulo["iva_ventas"],
): number {
  // Entra blanco, sale blanco → sin ajuste
  if (iva_compras === "factura" && iva_ventas === "factura") return 1.00

  // Entra blanco, sale negro → IVA va dentro del precio
  if (iva_compras === "factura" && iva_ventas === "presupuesto") return 1.21

  // Entra mixto, sale blanco → descuento 5% para no disparar el precio (ajuste comercial)
  if (iva_compras === "mixto" && iva_ventas === "factura") return 0.95

  // Entra mixto, sale negro → +10% para recuperar el IVA pagado al proveedor
  if (iva_compras === "mixto" && iva_ventas === "presupuesto") return 1.10

  // Entra negro, sale negro → sin ajuste
  if (iva_compras === "adquisicion_stock" && iva_ventas === "presupuesto") return 1.00

  // Entra negro, sale blanco → descuento 10% para no disparar el precio
  if (iva_compras === "adquisicion_stock" && iva_ventas === "factura") return 0.90

  return 1.00 // fallback
}

// ─── Paso 3 + 4: Precio Final ─────────────────────────

export function calcularPrecioFinal(
  art: DatosArticulo, lista: DatosLista, metodoFacturacion: MetodoFacturacion, descuentoCliente: number = 0,
): ResultadoPrecio {
  const { costoNeto, precioBase } = calcularPrecioBase(art)
  const recargoListaPct = obtenerRecargoLista(art, lista)
  const precioLista = round2(precioBase * (1 + recargoListaPct / 100))
  const precioConDescuento = round2(precioLista * (1 - (descuentoCliente || 0) / 100))

  // Determinar comprobante según método del cliente
  const esNegro = art.iva_ventas === "presupuesto"
  let vaEnComprobante: "factura" | "presupuesto"
  if (metodoFacturacion === "Final") vaEnComprobante = esNegro ? "presupuesto" : "factura"
  else if (metodoFacturacion === "Factura") vaEnComprobante = "factura"
  else vaEnComprobante = "presupuesto"

  // Coeficiente de ajuste según IVA compras/ventas del artículo
  const coefIva = obtenerCoeficienteIva(art.iva_compras, art.iva_ventas)

  let coefAjusteAplicado = 0
  let precioAntesIva = precioConDescuento
  let ivaIncluido = false
  let ivaPct = 0
  let montoIvaDiscriminado = 0
  let precioUnitarioFinal = precioConDescuento

  if (vaEnComprobante === "factura") {
    // Sale en Factura A: precio neto + IVA 21% discriminado abajo
    precioAntesIva = round2(precioConDescuento * coefIva)
    if (coefIva !== 1.00) coefAjusteAplicado = round2((1 - coefIva) * 100)
    ivaPct = 21
    montoIvaDiscriminado = round2(precioAntesIva * 0.21)
    precioUnitarioFinal = precioAntesIva
  } else {
    // Sale en Presupuesto: precio final con IVA incluido (no discriminado)
    precioAntesIva = precioConDescuento
    precioUnitarioFinal = round2(precioConDescuento * coefIva)
    if (coefIva !== 1.00) {
      ivaIncluido = true
      ivaPct = coefIva > 1 ? round2((coefIva - 1) * 100) : 0
    }
  }

  return {
    costoNeto, precioBase, recargoListaPct, precioLista,
    descuentoClientePct: descuentoCliente || 0,
    precioConDescuento,
    descuentoNegroEnFacturaPct: coefAjusteAplicado,
    precioAntesIva, ivaIncluido, ivaPct,
    montoIvaDiscriminado, precioUnitarioFinal, vaEnComprobante,
  }
}

// ─── Helper para totales de pedido ─────────────────────

export interface ItemPedidoParaCalculo { articulo: DatosArticulo; cantidad: number }
export interface TotalesComprobante {
  tipo: "factura" | "presupuesto"
  items: Array<{ articuloIndex: number; cantidad: number; precioUnitario: number; subtotal: number; ivaUnitario: number; descNegroAplicado: boolean; resultado: ResultadoPrecio }>
  subtotalNeto: number; totalIva: number; totalFinal: number
}

export function calcularTotalesPedido(items: ItemPedidoParaCalculo[], lista: DatosLista, metodoFacturacion: MetodoFacturacion, descuentoCliente = 0): TotalesComprobante[] {
  const comprobantes: Record<string, TotalesComprobante> = {}
  items.forEach((item, index) => {
    const r = calcularPrecioFinal(item.articulo, lista, metodoFacturacion, descuentoCliente)
    if (!comprobantes[r.vaEnComprobante]) comprobantes[r.vaEnComprobante] = { tipo: r.vaEnComprobante, items: [], subtotalNeto: 0, totalIva: 0, totalFinal: 0 }
    const sub = round2(r.precioUnitarioFinal * item.cantidad)
    const iva = round2(r.montoIvaDiscriminado * item.cantidad)
    comprobantes[r.vaEnComprobante].items.push({ articuloIndex: index, cantidad: item.cantidad, precioUnitario: r.precioUnitarioFinal, subtotal: sub, ivaUnitario: r.montoIvaDiscriminado, descNegroAplicado: r.descuentoNegroEnFacturaPct > 0, resultado: r })
    if (r.ivaIncluido) { comprobantes[r.vaEnComprobante].subtotalNeto += sub; comprobantes[r.vaEnComprobante].totalFinal += sub }
    else { comprobantes[r.vaEnComprobante].subtotalNeto += sub; comprobantes[r.vaEnComprobante].totalIva += iva; comprobantes[r.vaEnComprobante].totalFinal += sub + iva }
  })
  const result = Object.values(comprobantes)
  result.forEach(c => { c.subtotalNeto = round2(c.subtotalNeto); c.totalIva = round2(c.totalIva); c.totalFinal = round2(c.totalFinal) })
  return result
}

// Convertir artículo de DB (con descuentos viejos o nuevos) a DatosArticulo
export function articuloToDatosArticulo(art: any, descuentosDB?: DescuentoTipado[]): DatosArticulo {
  let descuentos: DescuentoTipado[] = descuentosDB || []
  // Fallback: si no hay descuentos nuevos, usar los viejos descuento1-4
  if (descuentos.length === 0) {
    const old = [art.descuento1, art.descuento2, art.descuento3, art.descuento4]
    old.forEach((d, i) => {
      if (d && d > 0) descuentos.push({ tipo: "comercial", porcentaje: d, orden: i + 1 })
    })
  }
  return {
    precio_compra: art.precio_compra || 0,
    precio_base_stored: art.precio_base ?? null,
    descuentos,
    tipo_descuento: art.proveedor?.tipo_descuento || art.tipo_descuento || "cascada",
    porcentaje_ganancia: art.porcentaje_ganancia || 0,
    bonif_recargo: art.bonif_recargo || 0,
    categoria: art.categoria || art.rubro || "",
    rubro_slug: art.rubro_slug || art.rubros?.slug || undefined,
    iva_compras: art.iva_compras || "factura",
    iva_ventas: art.iva_ventas || "factura",
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Determinación de grupo de precio ─────────────────
// Extrae la lógica de segmentación de obtenerRecargoLista como función pública.
// Usada por el nuevo sistema de fórmulas configurables (listas_precio_reglas).

export function determinarGrupoPrecio(
  categoria: string,
  rubro_slug?: string,
): "LIMPIEZA_BAZAR" | "PERFUMERIA" {
  if (rubro_slug) return rubro_slug === 'perfumeria' ? "PERFUMERIA" : "LIMPIEZA_BAZAR"
  const cat = (categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA")) return "PERFUMERIA"
  return "LIMPIEZA_BAZAR"
}
