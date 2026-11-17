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

/**
 * Cómo aplica sus descuentos el proveedor. Lo dice su ficha (`proveedores.tipo_descuento`):
 *   · "cascada":     uno sobre el otro  → lista × (1 − d1) × (1 − d2) × …
 *   · "sobre_lista": todos sobre la lista → lista × (1 − (d1 + d2 + …))
 * Decisión de Juan (17/11): «Lo aclara en la ficha del proveedor, hay dos opciones: En cascada /
 * sobre precio lista.» Misma regla que el motor de precios de venta (lib/pricing/calculator.ts).
 */
export type TipoDescuento = "cascada" | "sobre_lista"

export function tipoDescuentoDe(v: unknown): TipoDescuento {
  return v === "sobre_lista" ? "sobre_lista" : "cascada"
}

/**
 * Precio de lista menos los descuentos (D1..D4, en %), según cómo los aplica el proveedor.
 * ÚNICA cuenta del neto de compra: la usan la verificación, las diferencias, la regla de suma
 * y el costo. (T1-A arma la misma función con esta firma; se unifican al integrar.)
 */
export function netoCompra(lista: unknown, descuentos: unknown[] = [], tipo: TipoDescuento | null | undefined = "cascada"): number {
  if (tipo === "sobre_lista") {
    const suma = descuentos.reduce<number>((s, d) => s + num(d), 0)
    return num(lista) * Math.max(0, 1 - suma / 100)
  }
  return descuentos.reduce<number>((p, d) => p * (1 - num(d) / 100), num(lista))
}

/** Igual que netoCompra (nombre anterior). */
export function precioNeto(lista: unknown, descuentos: unknown[] = [], tipo?: TipoDescuento | null): number {
  return netoCompra(lista, descuentos, tipo)
}

/**
 * Neto tal como se lee en un documento: a centavos. La orden y la factura muestran (y el
 * proveedor factura) precios con dos decimales; sin este redondeo 1.768,81 − 20 % daba
 * 1.415,048 y la diferencia por 48 u salía $1.677,70 en vez de los $1.677,60 de la pantalla.
 */
export function netoDocumento(lista: unknown, descuentos: unknown[] = [], tipo?: TipoDescuento | null): number {
  return r2(netoCompra(lista, descuentos, tipo))
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

/**
 * El mismo artículo en más de un renglón de la orden: se trata como UNA línea (se suman las
 * unidades; el precio y los descuentos son los del primer renglón).
 */
export function combinarLineasOC(lineas: LineaOC[]): LineaOC | null {
  if (lineas.length === 0) return null
  if (lineas.length === 1) return lineas[0]!
  const unidades = lineas.reduce((s, l) => s + num(l.cantidad_pedida) * (num(l.factor) || 1), 0)
  return { cantidad_pedida: r4(unidades), factor: 1, precio_unitario: lineas[0]!.precio_unitario, descuentos: lineas[0]!.descuentos }
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
    /** Unidades facturadas SIN cargo (bonificadas: precio 0 o 100 % de descuento). E-42 */
    bonificadas: number
    /** El artículo viene en renglones con precios distintos: no hay UNA lista + descuentos que copiar al artículo */
    precios_distintos: boolean
  } | null
  /** Facturado a otro precio que el acordado. null = no hay diferencia (o falta una de las dos puntas). */
  precio: ({ por_unidad: number; unidades: number; a_favor: "nuestro" | "proveedor" } & Importe) | null
  /**
   * Facturado ≠ recibido. faltante = nos facturaron de más (reclamable); sobrante = llegó más de
   * lo facturado. null = coinciden, o todavía no hay factura.
   */
  cantidad: ({ unidades: number; tipo: "faltante" | "sobrante" } & Importe) | null
  /**
   * Unidades de la orden que no llegaron ni se facturaron (el proveedor no las mandó). No es
   * plata: es mercadería que falta recibir. Sigue abierta hasta que llegue el resto o se dé la
   * orden por cerrada sin él. E-92
   */
  pendiente_oc: number
}

/** Redondeos chicos del OCR / de pasar descuentos a porcentaje no son una diferencia de precio. */
export const TOLERANCIA_PRECIO = 0.005
/**
 * …salvo que en plata sea importante: si la diferencia de la línea (por unidad × unidades) pasa
 * este importe NETO, se muestra y se puede resolver aunque sea menor al 0,5 %. Aceptado por Juan
 * el 17/11. Ninguna tolerancia cambia la deuda: la deuda es siempre el total de la factura.
 */
export const TOPE_DIFERENCIA_PESOS = 1000
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
  /** Cómo aplica los descuentos el proveedor (su ficha). Sin dato: en cascada. */
  tipo_descuento?: TipoDescuento | null
}): DiferenciaLinea {
  const tipo = p.tipo_descuento
  const oc = p.oc
    ? { unidades: r4(num(p.oc.cantidad_pedida) * (num(p.oc.factor) || 1)), neto_unidad: netoDocumento(p.oc.precio_unitario, p.oc.descuentos, tipo) }
    : null

  let factura: DiferenciaLinea["factura"] = null
  const lineas = p.factura.filter((l) => num(l.cantidad_facturada) > 0)
  if (lineas.length > 0) {
    let unidades = 0
    let conCargo = 0
    let netoTotal = 0
    const preciosVistos = new Set<number>()
    for (const l of lineas) {
      const f = num(l.factor) || 1
      const u = num(l.cantidad_facturada) * f
      const neto = netoDocumento(l.precio_unitario, l.descuentos, tipo)
      unidades += u
      // Lo bonificado (sin cargo) cuenta como mercadería facturada pero NO baja el precio:
      // el precio se compara solo sobre lo que se cobra (E-42).
      if (neto > 0) {
        conCargo += u
        netoTotal += u * (neto / f)
        preciosVistos.add(r4(neto / f))
      }
    }
    // Lista, descuentos e IVA: los del primer renglón con cargo
    const ref = lineas.find((l) => netoDocumento(l.precio_unitario, l.descuentos, tipo) > 0) ?? lineas[0]!
    factura = {
      unidades: r4(unidades),
      neto_unidad: conCargo > 0 ? r4(netoTotal / conCargo) : 0,
      lista_unidad: r4(num(ref.precio_unitario) / (num(ref.factor) || 1)),
      descuentos: ref.descuentos.map(num),
      iva_porcentaje: num(ref.iva_porcentaje),
      bonificadas: r4(unidades - conCargo),
      precios_distintos: preciosVistos.size > 1,
    }
  }

  const recibido = r4(Math.max(0, num(p.recibido_unidades)))

  let precio: DiferenciaLinea["precio"] = null
  if (oc && factura && oc.neto_unidad > 0 && factura.neto_unidad > 0) {
    const dif = factura.neto_unidad - oc.neto_unidad
    // La diferencia de precio va sobre lo que efectivamente se paga a ese precio: las unidades
    // RECIBIDAS (con tope en las cobradas). Lo facturado que no llegó es faltante y se reclama
    // entero al precio facturado: si además se le sumara la diferencia de precio, esas unidades
    // se reclamarían dos veces.
    const cobradas = r4(Math.min(factura.unidades - factura.bonificadas, recibido))
    if (cobradas > 0 && (Math.abs(dif) / oc.neto_unidad > TOLERANCIA_PRECIO || Math.abs(dif) * cobradas > TOPE_DIFERENCIA_PESOS)) {
      precio = {
        por_unidad: r4(Math.abs(dif)),
        unidades: cobradas,
        // facturado más caro que lo acordado ⇒ la diferencia es a NUESTRO favor (se reclama)
        a_favor: dif > 0 ? "nuestro" : "proveedor",
        ...importe(Math.abs(dif) * cobradas, factura.iva_porcentaje),
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

  const pendiente_oc = oc ? r4(Math.max(0, oc.unidades - Math.max(recibido, factura?.unidades ?? 0))) : 0

  return { oc, recibido_unidades: recibido, factura, precio, cantidad, pendiente_oc: pendiente_oc > TOLERANCIA_CANTIDAD ? pendiente_oc : 0 }
}

/**
 * Devolver mercadería que SÍ entró (rechazo, sobrante): cuántas de esas unidades se le pueden
 * reclamar al proveedor = lo facturado menos lo que nos quedamos. Lo que se devuelve y no
 * estaba facturado (un sobrante) no genera nota de crédito.
 */
export function reclamablePorDevolucion(dif: DiferenciaLinea, devolverUnidades: number): { unidades: number } & Importe {
  const devolver = Math.max(0, Math.min(num(devolverUnidades), dif.recibido_unidades))
  if (!dif.factura) return { unidades: 0, neto: 0, iva: 0, total: 0 }
  const nosQuedamos = dif.recibido_unidades - devolver
  const unidades = r4(Math.max(0, dif.factura.unidades - nosQuedamos))
  return { unidades, ...importe(unidades * dif.factura.neto_unidad, dif.factura.iva_porcentaje) }
}

/**
 * Llegó más mercadería que la facturada (sobrante). Decisión de Juan, 17/11/2026: "debe aparecer
 * un cartel para ver si se recibe y esperamos factura, o solo se recibe, ajusta stock pero no se
 * paga de más. Esto para cuando envían mercadería bonificada."
 *
 *   · espera_factura: lo que el proveedor va a facturar por esas unidades = unidades de más al
 *     precio neto de la ORDEN (si el artículo no estaba en la orden, al facturado) + IVA. Queda
 *     como nota de débito esperada. No es deuda todavía: la deuda es lo que dicen los comprobantes.
 *   · bonificado: no se paga nada más. El costo real por unidad baja, porque lo pagado se reparte
 *     entre más unidades: neto facturado × (unidades pagadas ÷ unidades recibidas). Va solo al
 *     último costo; el precio de lista del artículo no se toca.
 * null = no hay sobrante.
 */
export function cuentaSobrante(dif: DiferenciaLinea): { unidades: number; espera_factura: Importe; ultimo_costo_bonificado: number } | null {
  if (!dif.cantidad || dif.cantidad.tipo !== "sobrante" || !dif.factura) return null
  const unidades = dif.cantidad.unidades
  const precio = dif.oc && dif.oc.neto_unidad > 0 ? dif.oc.neto_unidad : dif.factura.neto_unidad
  const pagadas = Math.max(0, dif.factura.unidades - dif.factura.bonificadas)
  return {
    unidades,
    espera_factura: importe(unidades * precio, dif.factura.iva_porcentaje),
    ultimo_costo_bonificado: dif.recibido_unidades > 0 ? r4((dif.factura.neto_unidad * pagadas) / dif.recibido_unidades) : 0,
  }
}
