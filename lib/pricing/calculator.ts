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
  descuentos: DescuentoTipado[]
  tipo_descuento: "cascada" | "sobre_lista"
  porcentaje_ganancia: number
  bonif_recargo: number             // positivo = recargo, negativo = bonif
  categoria: string
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
  const esPerfumeria = (art.categoria || "").toUpperCase().includes("PERFUMERIA")
    || (art.categoria || "").toUpperCase().includes("PERFUMERÍA")
  if (esPerfumeria) {
    return art.iva_compras === "adquisicion_stock" ? lista.recargo_perfumeria_negro : lista.recargo_perfumeria_blanco
  }
  return lista.recargo_limpieza_bazar
}

// ─── Paso 3 + 4: Precio Final ─────────────────────────

export function calcularPrecioFinal(
  art: DatosArticulo, lista: DatosLista, metodoFacturacion: MetodoFacturacion, descuentoCliente: number = 0,
): ResultadoPrecio {
  const { costoNeto, precioBase } = calcularPrecioBase(art)
  const recargoListaPct = obtenerRecargoLista(art, lista)
  const precioLista = round2(precioBase * (1 + recargoListaPct / 100))
  const precioConDescuento = round2(precioLista * (1 - (descuentoCliente || 0) / 100))
  const esNegro = art.iva_ventas === "presupuesto"

  let vaEnComprobante: "factura" | "presupuesto"
  if (metodoFacturacion === "Final") vaEnComprobante = esNegro ? "presupuesto" : "factura"
  else if (metodoFacturacion === "Factura") vaEnComprobante = "factura"
  else vaEnComprobante = "presupuesto"

  let descuentoNegroEnFacturaPct = 0, precioAntesIva = precioConDescuento
  let ivaIncluido = false, ivaPct = 0, montoIvaDiscriminado = 0, precioUnitarioFinal = precioConDescuento

  if (vaEnComprobante === "factura") {
    if (esNegro) { descuentoNegroEnFacturaPct = 10; precioAntesIva = round2(precioConDescuento * 0.90) }
    else precioAntesIva = precioConDescuento
    ivaPct = 21; montoIvaDiscriminado = round2(precioAntesIva * 0.21); precioUnitarioFinal = precioAntesIva
  } else {
    if (esNegro) { precioUnitarioFinal = precioConDescuento }
    else { ivaPct = 21; precioUnitarioFinal = round2(precioConDescuento * 1.21); ivaIncluido = true }
  }

  return {
    costoNeto, precioBase, recargoListaPct, precioLista, descuentoClientePct: descuentoCliente || 0,
    precioConDescuento, descuentoNegroEnFacturaPct, precioAntesIva, ivaIncluido, ivaPct,
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
    descuentos,
    tipo_descuento: art.proveedor?.tipo_descuento || art.tipo_descuento || "cascada",
    porcentaje_ganancia: art.porcentaje_ganancia || 0,
    bonif_recargo: art.bonif_recargo || 0,
    categoria: art.categoria || art.rubro || "",
    iva_compras: art.iva_compras || "factura",
    iva_ventas: art.iva_ventas || "factura",
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
