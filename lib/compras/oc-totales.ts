/**
 * Cuánto vale una orden de compra: UNA sola cuenta para la pantalla, el PDF, el mail y la base
 * (E-08, E-12, E-97). La misma regla está escrita en SQL en `oc_totales` (migración 20261117n).
 *
 *  · `precio_unitario` es SIEMPRE por unidad. Si el renglón se pide por bulto, las unidades son
 *    cantidad × unidades por bulto (regla de lib/deposito/unidades.ts).
 *  · Precio neto = lista con los descuentos como los aplica ESE proveedor (en cascada o sobre
 *    precio de lista): `netoCompra` de lib/compras/neto-compra.ts.
 *  · Renglón = unidades × precio neto, redondeado a centavos. El precio neto NO se redondea antes
 *    de multiplicar: redondearlo era lo que hacía diferir en centavos el total de la orden entre
 *    la creación y la verificación.
 *  · Blanco / negro según el régimen de compra del artículo (`articulos.iva_compras`):
 *      factura → con factura (blanco) · adquisicion_stock → sin factura (negro) ·
 *      mixto → una parte con factura y el resto sin. La proporción depende del proveedor
 *      (Juan, 17/11: «la proporción varía según proveedor»): `mixto_pct_factura`, de la ficha,
 *      copiada a la orden y editable ahí. Sin dato: 50 %.
 *  · Sobre el neto blanco: IVA 21 % + percepciones del proveedor (IVA e IIBB).
 *  · La retención de Ganancias NO se suma: no es deuda con el proveedor (se le retiene al pagar).
 *
 * La separación blanco / negro es INTERNA (provisión, vencimientos, nuestra pantalla): la orden
 * que recibe el proveedor es un solo pedido con un solo total (Juan, 17/11).
 *
 * Archivo PURO. Test: mobile/packages/core/test/entrada-orden-compra.test.ts (por eso los imports son relativos)
 */
import { redondear } from "../formato"
import { aUnidadesBase, unidadesPorBultoDe } from "../deposito/unidades"
import { netoCompra } from "./neto-compra"

export const IVA_COMPRAS_PCT = 21
/** Parte con factura de un artículo "mixto" cuando el proveedor no tiene el dato cargado */
export const MIXTO_PCT_FACTURA_DEFECTO = 50

export type RegimenCompra = "factura" | "adquisicion_stock" | "mixto"

export interface RenglonOC {
  cantidad_pedida: number
  tipo_cantidad?: string | null
  precio_unitario: number
  descuento1?: number | null
  descuento2?: number | null
  descuento3?: number | null
  descuento4?: number | null
  /** Del artículo (se lee de la base, no del navegador) */
  unidades_por_bulto?: number | null
  iva_compras?: string | null
}

/** Lo que define la cuenta además de los renglones: sale del proveedor y de la orden */
export interface ContextoOC {
  percepcion_iva?: number | null
  percepcion_iibb?: number | null
  /** `proveedores.tipo_descuento`: cascada | sobre_lista */
  tipo_descuento?: string | null
  /** % con factura de los artículos mixtos (0 a 100). null = 50 */
  mixto_pct_factura?: number | null
}

export interface TotalesOC {
  neto_blanco: number
  neto_negro: number
  /** neto_blanco + neto_negro: el "total sin impuestos" (lo que ve el proveedor) */
  neto: number
  iva: number
  percepciones: number
  /** neto blanco + IVA + percepciones */
  total_blanco: number
  total_negro: number
  /** Lo que se estima deber: total_blanco + total_negro */
  total: number
  renglones: number
  unidades: number
  /** Hay artículos mixtos en la orden */
  hay_mixto: boolean
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function regimenDe(v: unknown): RegimenCompra {
  return v === "adquisicion_stock" || v === "mixto" ? v : "factura"
}

/** % con factura de lo mixto, acotado a 0-100. Vacío o inválido = 50. */
export function mixtoPctFactura(v: unknown): number {
  if (v === null || v === undefined || v === "") return MIXTO_PCT_FACTURA_DEFECTO
  const x = Number(v)
  return Number.isFinite(x) && x >= 0 && x <= 100 ? x : MIXTO_PCT_FACTURA_DEFECTO
}

/** Precio neto por unidad, SIN redondear, con los descuentos como los aplica el proveedor. */
export function precioNeto(r: Pick<RenglonOC, "precio_unitario" | "descuento1" | "descuento2" | "descuento3" | "descuento4">, tipoDescuento?: string | null): number {
  return netoCompra(r.precio_unitario, [r.descuento1, r.descuento2, r.descuento3, r.descuento4], tipoDescuento)
}

/** Unidades base del renglón. */
export function unidadesRenglon(r: Pick<RenglonOC, "cantidad_pedida" | "tipo_cantidad" | "unidades_por_bulto">): number {
  return aUnidadesBase(r.cantidad_pedida, r.tipo_cantidad === "unidad" ? 1 : unidadesPorBultoDe(r.unidades_por_bulto))
}

/** Neto del renglón (sin impuestos), en centavos. */
export function netoRenglon(r: RenglonOC, tipoDescuento?: string | null): number {
  return redondear(unidadesRenglon(r) * precioNeto(r, tipoDescuento))
}

export function totalesOC(renglones: RenglonOC[], contexto?: ContextoOC | null): TotalesOC {
  const pctMixto = mixtoPctFactura(contexto?.mixto_pct_factura)
  let netoBlanco = 0
  let netoNegro = 0
  let unidades = 0
  let cuenta = 0
  let hayMixto = false
  for (const r of renglones) {
    const unid = unidadesRenglon(r)
    if (!(unid > 0)) continue
    cuenta++
    unidades += unid
    const neto = netoRenglon(r, contexto?.tipo_descuento)
    const regimen = regimenDe(r.iva_compras)
    if (regimen === "adquisicion_stock") netoNegro += neto
    else if (regimen === "mixto") {
      hayMixto = true
      const conFactura = redondear((neto * pctMixto) / 100)
      netoBlanco += conFactura
      netoNegro += neto - conFactura
    } else netoBlanco += neto
  }
  netoBlanco = redondear(netoBlanco)
  netoNegro = redondear(netoNegro)
  const pctPercepciones = n(contexto?.percepcion_iva) + n(contexto?.percepcion_iibb)
  const iva = redondear((netoBlanco * IVA_COMPRAS_PCT) / 100)
  const percepciones = redondear((netoBlanco * pctPercepciones) / 100)
  const totalBlanco = redondear(netoBlanco + iva + percepciones)
  return {
    neto_blanco: netoBlanco,
    neto_negro: netoNegro,
    neto: redondear(netoBlanco + netoNegro),
    iva,
    percepciones,
    total_blanco: totalBlanco,
    total_negro: netoNegro,
    total: redondear(totalBlanco + netoNegro),
    renglones: cuenta,
    unidades: redondear(unidades, 4),
    hay_mixto: hayMixto,
  }
}
