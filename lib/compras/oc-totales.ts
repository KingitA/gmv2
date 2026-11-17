/**
 * Cuánto vale una orden de compra: UNA sola cuenta para la pantalla, el PDF, el mail y la base
 * (E-08, E-12, E-97). La misma regla está escrita en SQL en `oc_totales` (migración 20261117n).
 *
 *  · `precio_unitario` es SIEMPRE por unidad. Si el renglón se pide por bulto, las unidades son
 *    cantidad × unidades por bulto (regla de lib/deposito/unidades.ts).
 *  · Renglón = unidades × precio neto, redondeado a centavos. El precio neto (precio de lista con
 *    los 4 descuentos en cascada) NO se redondea antes de multiplicar: redondearlo era lo que
 *    hacía diferir en centavos el total de la orden entre la creación y la verificación.
 *  · Blanco / negro según el régimen de compra del artículo (`articulos.iva_compras`):
 *      factura → con factura (blanco) · adquisicion_stock → sin factura (negro) · mixto → mitad y mitad.
 *  · Sobre el neto blanco: IVA 21 % + percepciones del proveedor (IVA e IIBB).
 *  · La retención de Ganancias NO se suma: no es deuda con el proveedor (se le retiene al pagar).
 *
 * Archivo PURO. Test: mobile/packages/core/test/entrada-orden-compra.test.ts (por eso los imports son relativos)
 */
import { redondear } from "../formato"
import { aUnidadesBase, unidadesPorBultoDe } from "../deposito/unidades"

export const IVA_COMPRAS_PCT = 21

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

export interface TotalesOC {
  neto_blanco: number
  neto_negro: number
  /** neto_blanco + neto_negro: el "total sin impuestos" */
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
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function regimenDe(v: unknown): RegimenCompra {
  return v === "adquisicion_stock" || v === "mixto" ? v : "factura"
}

/** Precio neto por unidad: lista con los 4 descuentos en cascada. SIN redondear. */
export function precioNeto(r: Pick<RenglonOC, "precio_unitario" | "descuento1" | "descuento2" | "descuento3" | "descuento4">): number {
  return [r.descuento1, r.descuento2, r.descuento3, r.descuento4].reduce<number>((p, d) => p * (1 - n(d) / 100), n(r.precio_unitario))
}

/** Unidades base del renglón. */
export function unidadesRenglon(r: Pick<RenglonOC, "cantidad_pedida" | "tipo_cantidad" | "unidades_por_bulto">): number {
  return aUnidadesBase(r.cantidad_pedida, r.tipo_cantidad === "unidad" ? 1 : unidadesPorBultoDe(r.unidades_por_bulto))
}

/** Neto del renglón (sin impuestos), en centavos. */
export function netoRenglon(r: RenglonOC): number {
  return redondear(unidadesRenglon(r) * precioNeto(r))
}

export function totalesOC(renglones: RenglonOC[], proveedor?: { percepcion_iva?: number | null; percepcion_iibb?: number | null } | null): TotalesOC {
  let netoBlanco = 0
  let netoNegro = 0
  let unidades = 0
  let cuenta = 0
  for (const r of renglones) {
    const unid = unidadesRenglon(r)
    if (!(unid > 0)) continue
    cuenta++
    unidades += unid
    const neto = netoRenglon(r)
    const regimen = regimenDe(r.iva_compras)
    if (regimen === "adquisicion_stock") netoNegro += neto
    else if (regimen === "mixto") {
      const mitad = redondear(neto / 2)
      netoBlanco += mitad
      netoNegro += neto - mitad
    } else netoBlanco += neto
  }
  netoBlanco = redondear(netoBlanco)
  netoNegro = redondear(netoNegro)
  const pctPercepciones = n(proveedor?.percepcion_iva) + n(proveedor?.percepcion_iibb)
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
  }
}
