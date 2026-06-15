// =====================================================
// Sistema de Precios GM — Calculador v2
// =====================================================
// Soporta N descuentos tipados (comercial/financiero/promocional)
// + bonificación/recargo ocasional
// + sistema de fórmulas configurables por lista/grupo/iva (listas_precio_reglas)

import { evaluarFormula } from "@/lib/pricing/formula-evaluator"

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
  /** Override explícito del segmento de precio. Tiene prioridad sobre rubro_slug y categoria.
   *  Permite que un artículo aparezca en catálogo bajo un rubro distinto al que determina su precio. */
  segmento_precio?: "limpieza_bazar" | "perfumeria" | null
  iva_compras: "factura" | "adquisicion_stock" | "mixto"
  iva_ventas: "factura" | "presupuesto"
  /** Lista Especial (Feature 2): precio neto fijo del artículo (sin impuestos). */
  precio_lista_especial?: number | null
  /** Lista Especial: % de oferta sobre el neto especial. */
  oferta_lista_especial?: number | null
}

export interface DatosLista {
  recargo_limpieza_bazar: number
  recargo_perfumeria_negro: number
  recargo_perfumeria_blanco: number
  /** Código de la lista: "bahia" | "neco" | "viajante" */
  lista_codigo?: string
  /**
   * Mapa de reglas de fórmulas indexado por "GRUPO|iva_compras|iva_ventas".
   * Valor: objeto con claves de sublista → fórmula (string).
   * Ej: { "LIMPIEZA_BAZAR|factura|factura": { viajante: "Base*1.3*1.21" } }
   */
  formulas_reglas?: Record<string, Record<string, string>>
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
  // Prioridad 0: segmento_precio explícito (override independiente del rubro de catálogo)
  if (art.segmento_precio === 'perfumeria') {
    return _recargoPerf(art, lista)
  }
  if (art.segmento_precio === 'limpieza_bazar') return lista.recargo_limpieza_bazar

  // Prioridad 1: rubro_slug relacional (más preciso que string de categoria)
  if (art.rubro_slug) {
    if (art.rubro_slug === 'perfumeria') return _recargoPerf(art, lista)
    return lista.recargo_limpieza_bazar
  }
  // Fallback legacy: detección por string de categoria
  const esPerfumeria = (art.categoria || "").toUpperCase().includes("PERFUMERIA")
    || (art.categoria || "").toUpperCase().includes("PERFUMERÍA")
  if (esPerfumeria) return _recargoPerf(art, lista)
  return lista.recargo_limpieza_bazar
}

function _recargoPerf(art: DatosArticulo, lista: DatosLista): number {
  return art.iva_ventas === 'presupuesto' ? lista.recargo_perfumeria_negro : lista.recargo_perfumeria_blanco
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

// ─── Resolución de clave de fórmula por lista/metodo ─
//
// Convierte lista_codigo + metodoFacturacion → clave de sublista en listas_precio_reglas.
// Viajante tiene una sola clave. Bahia/neco tienen una por método:
//   Presupuesto → "{lista}_presupuesto"  (todo va a presupuesto)
//   Final       → "{lista}_final"        (sigue iva_ventas del artículo)
//   Factura     → "{lista}_con_iva"      (todo va a factura, precio s/iva + 21%)
//
// La interpretación del resultado se hace con vaEnComprobante:
//   factura → neto = result/1.21 · presupuesto → usar directo

function resolveSublistaKey(
  lista_codigo: string | undefined,
  metodoFacturacion: MetodoFacturacion,
): string | null {
  if (!lista_codigo) return null
  const code = lista_codigo.toLowerCase()
  if (code === "viajante") return "viajante"
  // bahia / neco
  if (metodoFacturacion === "Presupuesto") return `${code}_presupuesto`
  if (metodoFacturacion === "Final")       return `${code}_final`
  if (metodoFacturacion === "Factura")     return `${code}_con_iva`
  return null
}

// ─── Paso 3 + 4: Precio Final ─────────────────────────

export function calcularPrecioFinal(
  art: DatosArticulo, lista: DatosLista, metodoFacturacion: MetodoFacturacion, descuentoCliente: number = 0,
): ResultadoPrecio {
  // ─── Lista Especial (Feature 2) ───────────────────────────────────────────
  // Precio neto fijo cargado en el artículo (precio_lista_especial) menos la oferta.
  // Saltea toda la cascada y los descuentos: SIEMPRE factura (neto + IVA 21%).
  if ((lista.lista_codigo || "").toLowerCase() === "especial") {
    const baseEsp  = art.precio_lista_especial || 0
    const netoEsp  = round2(baseEsp * (1 - (art.oferta_lista_especial || 0) / 100))
    return {
      costoNeto: 0,
      precioBase: baseEsp,
      recargoListaPct: 0,
      precioLista: netoEsp,
      descuentoClientePct: 0,
      precioConDescuento: netoEsp,
      descuentoNegroEnFacturaPct: 0,
      precioAntesIva: netoEsp,
      ivaIncluido: false,
      ivaPct: 21,
      montoIvaDiscriminado: round2(netoEsp * 0.21),
      precioUnitarioFinal: netoEsp,
      vaEnComprobante: "factura",
    }
  }

  const { costoNeto, precioBase } = calcularPrecioBase(art)

  // Determinar comprobante según método del cliente
  const esNegro = art.iva_ventas === "presupuesto"
  let vaEnComprobante: "factura" | "presupuesto"
  if (metodoFacturacion === "Final") vaEnComprobante = esNegro ? "presupuesto" : "factura"
  else if (metodoFacturacion === "Factura") vaEnComprobante = "factura"
  else vaEnComprobante = "presupuesto"

  // ─── Sistema de fórmulas configurables ───────────────
  // Si la lista tiene fórmulas, el precio viene directo de la fórmula.
  // La fórmula devuelve el precio CON IVA incluido.
  // Para factura: neto = formulaResult / 1.21
  // Para presupuesto: total = formulaResult
  let precioListaFormula: number | null = null
  if (lista.formulas_reglas && lista.lista_codigo) {
    const grupo = determinarGrupoPrecio(art.categoria, art.rubro_slug, art.segmento_precio)
    const reglaKey = `${grupo}|${art.iva_compras}|${art.iva_ventas}`
    const formulas = lista.formulas_reglas[reglaKey]
    if (formulas) {
      const sublistaKey = resolveSublistaKey(lista.lista_codigo, metodoFacturacion)
      if (sublistaKey && formulas[sublistaKey]) {
        precioListaFormula = evaluarFormula(formulas[sublistaKey], { Base: precioBase })
      }
    }
  }

  let recargoListaPct: number
  let precioLista: number
  let precioConDescuento: number
  let coefAjusteAplicado = 0
  let precioAntesIva: number
  let ivaIncluido = false
  let ivaPct = 0
  let montoIvaDiscriminado = 0
  let precioUnitarioFinal: number

  if (precioListaFormula !== null) {
    // Precio desde fórmula — ya incluye IVA
    recargoListaPct = precioBase > 0 ? round2((precioListaFormula / precioBase - 1) * 100) : 0

    if (vaEnComprobante === "factura") {
      const netoFormula = round2(precioListaFormula / 1.21)
      precioLista = netoFormula
      precioConDescuento = round2(netoFormula * (1 - (descuentoCliente || 0) / 100))
      precioAntesIva = precioConDescuento
      ivaPct = 21
      montoIvaDiscriminado = round2(precioAntesIva * 0.21)
      precioUnitarioFinal = precioAntesIva
    } else {
      precioLista = precioListaFormula
      precioConDescuento = round2(precioListaFormula * (1 - (descuentoCliente || 0) / 100))
      precioAntesIva = precioConDescuento
      precioUnitarioFinal = precioConDescuento
      ivaIncluido = true
    }
  } else {
    // Fallback al sistema legacy de recargo porcentual
    recargoListaPct = obtenerRecargoLista(art, lista)
    precioLista = round2(precioBase * (1 + recargoListaPct / 100))
    precioConDescuento = round2(precioLista * (1 - (descuentoCliente || 0) / 100))

    const esPerf = art.segmento_precio === 'perfumeria' || art.rubro_slug === 'perfumeria'
    const coefIva = esPerf ? 1.00 : obtenerCoeficienteIva(art.iva_compras, vaEnComprobante)

    if (vaEnComprobante === "factura") {
      precioAntesIva = round2(precioConDescuento * coefIva)
      if (coefIva !== 1.00) coefAjusteAplicado = round2((1 - coefIva) * 100)
      ivaPct = 21
      montoIvaDiscriminado = round2(precioAntesIva * 0.21)
      precioUnitarioFinal = precioAntesIva
    } else {
      precioAntesIva = precioConDescuento
      precioUnitarioFinal = round2(precioConDescuento * coefIva)
      if (coefIva !== 1.00) {
        ivaIncluido = true
        ivaPct = coefIva > 1 ? round2((coefIva - 1) * 100) : 0
      }
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
// Mapea valores legacy del DB ('0', '+') a los valores tipados del motor
function normalizeIvaCompras(v: any): DatosArticulo["iva_compras"] {
  if (v === "adquisicion_stock") return "adquisicion_stock"
  if (v === "mixto") return "mixto"
  // '0' = perf0 (entra sin IVA = negro) · '+' / 'factura' / anything else = blanco
  if (v === "0") return "adquisicion_stock"
  return "factura"
}
function normalizeIvaVentas(v: any): DatosArticulo["iva_ventas"] {
  if (v === "presupuesto") return "presupuesto"
  // '0' = perf0 (vende en negro, IVA no discriminado en presupuesto) · todo lo demás = blanco
  if (v === "0") return "presupuesto"
  return "factura"
}

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
    segmento_precio: (art.segmento_precio as DatosArticulo["segmento_precio"]) ?? null,
    iva_compras: normalizeIvaCompras(art.iva_compras),
    iva_ventas: normalizeIvaVentas(art.iva_ventas),
    precio_lista_especial: art.precio_lista_especial ?? null,
    oferta_lista_especial: art.oferta_lista_especial ?? null,
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Determinación de grupo de precio ─────────────────
// Extrae la lógica de segmentación de obtenerRecargoLista como función pública.
// Usada por el nuevo sistema de fórmulas configurables (listas_precio_reglas).

export function determinarGrupoPrecio(
  categoria: string,
  rubro_slug?: string,
  segmento_precio?: string | null,
): "LIMPIEZA_BAZAR" | "PERFUMERIA" {
  // Override explícito tiene máxima prioridad
  if (segmento_precio === 'perfumeria') return "PERFUMERIA"
  if (segmento_precio === 'limpieza_bazar') return "LIMPIEZA_BAZAR"
  if (rubro_slug) return rubro_slug === 'perfumeria' ? "PERFUMERIA" : "LIMPIEZA_BAZAR"
  const cat = (categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA")) return "PERFUMERIA"
  return "LIMPIEZA_BAZAR"
}
