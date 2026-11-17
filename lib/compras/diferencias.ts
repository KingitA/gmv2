/**
 * Diferencias de una línea de compra: lo PEDIDO (orden de compra) contra lo RECIBIDO
 * (depósito) contra lo FACTURADO (comprobantes con precios). Única cuenta para la pantalla
 * de verificación y para el servidor que resuelve la diferencia (E-90, E-91).
 *
 * Todo en UNIDADES base y precios NETOS POR UNIDAD (lista menos los descuentos de la línea),
 * que es lo que muestra la pantalla. El IVA va discriminado aparte.
 *
 * Casos reales del 17/11 (OC-000011), que antes daban mal porque se usaba el precio de
 * lista sin descuento y sin IVA:
 *   · precio:   (1.450,00 − 1.415,05) × 48 u = $1.677,60 neto   (se generaban $2.097,12)
 *   · faltante: 50 u × $556,83              = $27.841,50 neto   (se generaban $34.802,00)
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-diferencias.test.ts
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Precio de lista menos los descuentos en cascada (D1..D4, en %). */
export function precioNeto(lista: unknown, descuentos: unknown[] = []): number {
  return descuentos.reduce<number>((p, d) => p * (1 - num(d) / 100), num(lista))
}

/**
 * Neto tal como se lee en un documento: a centavos. La orden y la factura muestran (y el
 * proveedor factura) precios con dos decimales; sin este redondeo 1.768,81 − 20 % daba
 * 1.415,048 y la diferencia por 48 u salía $1.677,70 en vez de los $1.677,60 de la pantalla.
 */
export function netoDocumento(lista: unknown, descuentos: unknown[] = []): number {
  return r2(precioNeto(lista, descuentos))
}

export interface LineaOC {
  /** En la unidad pedida (bultos si tipo_cantidad = bulto) */
  cantidad_pedida: number
  /** Unidades base por cada 1 de cantidad_pedida (unidades por bulto, o 1) */
  factor: number
  /** Precio de LISTA por unidad base */
  precio_unitario: number
  descuentos: number[]
}

export interface LineaFactura {
  /** Tal cual la factura */
  cantidad_facturada: number
  /** Unidades base por cada 1 de cantidad_facturada (1 si la factura viene por unidad) */
  factor: number
  /** Precio de LISTA tal cual la factura (por bulto si factor > 1) */
  precio_unitario: number
  descuentos: number[]
  iva_porcentaje: number
}

export interface Importe {
  neto: number
  iva: number
  total: number
}

export interface DiferenciaLinea {
  oc: { unidades: number; neto_unidad: number } | null
  recibido_unidades: number
  factura: {
    unidades: number
    /** Neto por unidad (promedio ponderado si el artículo está en más de un renglón) */
    neto_unidad: number
    /** Lista por unidad y descuentos del renglón (para actualizar el costo sin pisar la lista con el neto) */
    lista_unidad: number
    descuentos: number[]
    iva_porcentaje: number
  } | null
  /** Facturado a otro precio que el acordado. null = no hay diferencia (o falta una de las dos puntas). */
  precio: ({ por_unidad: number; unidades: number; a_favor: "nuestro" | "proveedor" } & Importe) | null
  /**
   * Facturado ≠ recibido. faltante = nos facturaron de más (reclamable); sobrante = llegó más de
   * lo facturado. null = coinciden, o todavía no hay factura.
   */
  cantidad: ({ unidades: number; tipo: "faltante" | "sobrante" } & Importe) | null
}

/** Redondeos chicos del OCR / de pasar descuentos a porcentaje no son una diferencia de precio. */
export const TOLERANCIA_PRECIO = 0.005
const TOLERANCIA_CANTIDAD = 0.01

export function importe(neto: number, ivaPorcentaje: number): Importe {
  const n = r2(neto)
  const iva = r2(n * (num(ivaPorcentaje) / 100))
  return { neto: n, iva, total: r2(n + iva) }
}

export function calcularDiferencia(p: {
  oc: LineaOC | null
  /** Renglones del artículo en comprobantes CON precios (factura / adquisición) de la orden; sin NC, ND ni remitos */
  factura: LineaFactura[]
  recibido_unidades: number
}): DiferenciaLinea {
  const oc = p.oc
    ? { unidades: r4(num(p.oc.cantidad_pedida) * (num(p.oc.factor) || 1)), neto_unidad: netoDocumento(p.oc.precio_unitario, p.oc.descuentos) }
    : null

  let factura: DiferenciaLinea["factura"] = null
  const lineas = p.factura.filter((l) => num(l.cantidad_facturada) > 0)
  if (lineas.length > 0) {
    let unidades = 0
    let netoTotal = 0
    for (const l of lineas) {
      const f = num(l.factor) || 1
      const u = num(l.cantidad_facturada) * f
      unidades += u
      netoTotal += u * (netoDocumento(l.precio_unitario, l.descuentos) / f)
    }
    // Lista, descuentos e IVA: los del renglón con precio (el primero)
    const ref = lineas.find((l) => num(l.precio_unitario) > 0) ?? lineas[0]!
    factura = {
      unidades: r4(unidades),
      neto_unidad: unidades > 0 ? r4(netoTotal / unidades) : 0,
      lista_unidad: r4(num(ref.precio_unitario) / (num(ref.factor) || 1)),
      descuentos: ref.descuentos.map(num),
      iva_porcentaje: num(ref.iva_porcentaje),
    }
  }

  const recibido = r4(Math.max(0, num(p.recibido_unidades)))

  let precio: DiferenciaLinea["precio"] = null
  if (oc && factura && oc.neto_unidad > 0 && factura.neto_unidad > 0) {
    const dif = factura.neto_unidad - oc.neto_unidad
    if (Math.abs(dif) / oc.neto_unidad > TOLERANCIA_PRECIO) {
      precio = {
        por_unidad: r4(Math.abs(dif)),
        unidades: factura.unidades,
        // facturado más caro que lo acordado ⇒ la diferencia es a NUESTRO favor (se reclama)
        a_favor: dif > 0 ? "nuestro" : "proveedor",
        ...importe(Math.abs(dif) * factura.unidades, factura.iva_porcentaje),
      }
    }
  }

  let cantidad: DiferenciaLinea["cantidad"] = null
  if (factura) {
    const dif = factura.unidades - recibido
    if (Math.abs(dif) > TOLERANCIA_CANTIDAD) {
      cantidad = {
        unidades: r4(Math.abs(dif)),
        tipo: dif > 0 ? "faltante" : "sobrante",
        ...importe(Math.abs(dif) * factura.neto_unidad, factura.iva_porcentaje),
      }
    }
  }

  return { oc, recibido_unidades: recibido, factura, precio, cantidad }
}
