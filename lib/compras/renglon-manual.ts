/**
 * Un renglón de comprobante cargado o corregido A MANO: la cuenta que ve quien lo carga.
 *
 * Prueba en producción del 18/11: el diálogo tomaba la cantidad en la unidad de la orden (bultos)
 * sin decirlo. Se cargó "36 a $608,97" pensando en unidades y quedaron 1.296 unidades a $16,92.
 * Ahora quien carga ELIGE la unidad (unidades o bultos de N) y ve, antes de guardar, a cuántas
 * unidades equivale, el neto por unidad y el importe del renglón.
 *
 * Convención del detalle (la misma de la lectura automática): `cantidad_facturada` y
 * `precio_unitario` van como en la factura, en la unidad elegida; `tipo_cantidad = 'bulto'` solo si
 * esa cantidad son bultos. El importe = cantidad × neto, redondeado una vez.
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-ocr-match.test.ts
 */
import { netoCompra } from "./neto-compra"

export type UnidadRenglon = "unidad" | "bulto"

export interface RenglonManual {
  cantidad: number
  unidad: UnidadRenglon
  /** Precio de LISTA por la unidad elegida (por bulto si la unidad es bulto) */
  precio_unitario: number
  descuentos: number[]
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Unidades por bulto que valen para convertir (1 si el artículo no tiene bulto). */
export function factorDeUnidad(unidad: unknown, unidadesPorBulto: unknown): number {
  const upb = num(unidadesPorBulto)
  return unidad === "bulto" && upb > 1 ? upb : 1
}

export interface CuentaRenglon {
  /** Unidades base (lo que cuenta para el stock y la recepción) */
  unidades: number
  /** Neto por la unidad elegida, sin redondear */
  neto: number
  /** Neto por unidad base, sin redondear */
  neto_por_unidad: number
  /** cantidad × neto, redondeado una vez */
  importe: number
}

export function cuentaRenglon(r: RenglonManual, unidadesPorBulto: unknown, tipoDescuento?: unknown): CuentaRenglon {
  const factor = factorDeUnidad(r.unidad, unidadesPorBulto)
  const neto = netoCompra(r.precio_unitario, r.descuentos, tipoDescuento)
  return {
    unidades: Math.round(num(r.cantidad) * factor * 10000) / 10000,
    neto,
    neto_por_unidad: neto / factor,
    importe: r2(num(r.cantidad) * neto),
  }
}

/** Qué le falta al renglón para poder guardarse. null = está bien. */
export function faltaEnRenglon(r: Partial<RenglonManual>, unidadesPorBulto: unknown): string | null {
  if (!(num(r.cantidad) > 0)) return "Falta la cantidad."
  if (r.unidad !== "unidad" && r.unidad !== "bulto") return "Elegí si la cantidad son unidades o bultos."
  if (r.unidad === "bulto" && !(num(unidadesPorBulto) > 1)) return "Este artículo no tiene unidades por bulto cargadas: cargá la cantidad en unidades."
  if (num(r.precio_unitario) < 0) return "El precio no puede ser negativo."
  const d = (r.descuentos || []).map(num)
  if (d.some((x) => x < 0 || x > 100)) return "Los descuentos van de 0 a 100 %."
  return null
}
