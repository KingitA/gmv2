/**
 * Listas de precios de proveedor (E-20, E-22): la cuenta de la VISTA PREVIA y de lo que se aplica.
 *
 *   · Un precio vacío en el archivo = "no tocar el precio". Un descuento VACÍO = "no tocar ese
 *     descuento"; un descuento 0 = "ese descuento pasa a ser 0" (antes el 0 se tomaba como vacío y
 *     un proveedor que sacaba un descuento no se podía cargar).
 *   · El neto se calcula como dice la ficha del proveedor (en cascada o sobre precio de lista):
 *     netoCompra de lib/compras/neto-compra.ts.
 *   · Alerta de suba o baja grande: el neto cambia más que el umbral (15 % por defecto, se puede
 *     cambiar en la pantalla).
 *   · Aviso de precio de venta: aplicar la lista NO toca precios de venta. Se avisa qué artículos
 *     quedan con el precio de venta desactualizado (los que tienen precio base guardado: no sigue
 *     al costo) y cuáles cambian solos (sin precio base guardado: se calculan desde el costo).
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-listas.test.ts
 */
import { netoCompra } from "./neto-compra"
import { parseMonto } from "../formato"

export const UMBRAL_ALERTA_PCT = 15

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

/** Valor de una celda de precio o descuento: vacío → null ("no tocar"); un número (también 0) → ese número. */
export function valorDeCelda(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === "" || s === "-") return null
  // formato argentino (1.234,56), con la regla de siempre del sistema; también "12 %"
  return parseMonto(s.replace(/%/g, ""))
}

export interface ItemLista {
  precio_compra?: number | null
  descuento1?: number | null
  descuento2?: number | null
  descuento3?: number | null
  descuento4?: number | null
}
export interface ArticuloCosto {
  precio_compra?: number | null
  descuento1?: number | null
  descuento2?: number | null
  descuento3?: number | null
  descuento4?: number | null
  precio_base?: number | null
  porcentaje_ganancia?: number | null
  bonif_recargo?: number | null
}

export interface CambioLista {
  /** Lo que tiene hoy el artículo */
  actual: { precio: number; descuentos: number[]; neto: number }
  /** Lo que quedaría al aplicar */
  nuevo: { precio: number; descuentos: number[]; neto: number }
  /** Columnas del artículo que cambian (lo que se escribe). Vacío = el artículo ya está igual. */
  cambios: Partial<Record<"precio_compra" | "descuento1" | "descuento2" | "descuento3" | "descuento4", number>>
  /** % de cambio del NETO (positivo = suba). null si el artículo no tenía costo */
  variacion_pct: number | null
  alerta: "suba" | "baja" | null
  /** El renglón no trae nada para aplicar (ni precio ni descuentos) */
  vacio: boolean
}

/** Qué le pasa a un artículo si se aplica este renglón de la lista. */
export function cambioDeItem(item: ItemLista, art: ArticuloCosto | null | undefined, tipoDescuento?: unknown, umbralPct: number = UMBRAL_ALERTA_PCT): CambioLista {
  const dActual = [art?.descuento1, art?.descuento2, art?.descuento3, art?.descuento4].map(num)
  const pActual = num(art?.precio_compra)
  // precio: vacío o 0 = no tocar (un precio de compra 0 no es un precio)
  const pNuevo = item.precio_compra != null && num(item.precio_compra) > 0 ? r4(num(item.precio_compra)) : pActual
  const dItem = [item.descuento1, item.descuento2, item.descuento3, item.descuento4]
  // descuento: null = no tocar; 0 = pasa a 0
  const dNuevo = dItem.map((d, i) => (d === null || d === undefined ? dActual[i]! : r4(num(d))))

  const cambios: CambioLista["cambios"] = {}
  if (Math.abs(pNuevo - pActual) > 0.00005) cambios.precio_compra = pNuevo
  dNuevo.forEach((d, i) => { if (Math.abs(d - dActual[i]!) > 0.00005) cambios[`descuento${i + 1}` as "descuento1"] = d })

  const netoActual = netoCompra(pActual, dActual, tipoDescuento)
  const netoNuevo = netoCompra(pNuevo, dNuevo, tipoDescuento)
  const variacion = netoActual > 0 ? r2(((netoNuevo - netoActual) / netoActual) * 100) : null
  const umbral = umbralPct > 0 ? umbralPct : UMBRAL_ALERTA_PCT
  return {
    actual: { precio: pActual, descuentos: dActual, neto: r4(netoActual) },
    nuevo: { precio: pNuevo, descuentos: dNuevo, neto: r4(netoNuevo) },
    cambios,
    variacion_pct: variacion,
    alerta: variacion === null ? null : variacion > umbral ? "suba" : variacion < -umbral ? "baja" : null,
    vacio: !(item.precio_compra != null && num(item.precio_compra) > 0) && dItem.every((d) => d === null || d === undefined),
  }
}

export interface AvisoVenta {
  /**
   * "desactualizado": el artículo tiene precio base GUARDADO; no sigue al costo, así que queda con
   *   otro margen que el de su ficha. Hay que revisarlo a mano.
   * "cambia_solo": no tiene precio base guardado; el precio de venta se calcula desde el costo y
   *   cambia solo en cuanto cambia el costo.
   */
  tipo: "desactualizado" | "cambia_solo"
  /** Precio base de venta que tiene guardado (solo "desactualizado") */
  precio_base_guardado: number | null
  /** Precio base que daría el costo nuevo con el margen de la ficha */
  precio_base_segun_costo: number
  /** Cuánto habría que mover el precio base guardado para acompañar al costo, en % */
  diferencia_pct: number | null
}

/** Precio base de venta que sale de un costo neto con el margen y la bonificación / recargo de la ficha. */
export function precioBaseDesdeCosto(netoCosto: number, art: ArticuloCosto | null | undefined): number {
  let base = num(netoCosto) * (1 + num(art?.porcentaje_ganancia) / 100)
  if (num(art?.bonif_recargo) !== 0) base *= 1 + num(art?.bonif_recargo) / 100
  return r2(base)
}

/**
 * ¿Cómo queda el precio de venta si el costo neto del artículo pasa de `netoActual` a `netoNuevo`?
 * null = el costo no cambia (o no hay cómo saberlo). Misma regla que calcularPrecioBase de
 * lib/pricing/calculator.ts: con precio base guardado se usa ese; sin él, costo × margen.
 */
export function avisoPrecioVenta(art: ArticuloCosto | null | undefined, netoActual: number, netoNuevo: number): AvisoVenta | null {
  if (!(netoNuevo > 0) || Math.abs(netoNuevo - netoActual) < 0.005) return null
  const segunCosto = precioBaseDesdeCosto(netoNuevo, art)
  const guardado = num(art?.precio_base)
  if (guardado > 0) {
    const dif = r2(((segunCosto - guardado) / guardado) * 100)
    // menos de 1 % de diferencia: el precio guardado ya acompaña al costo
    if (Math.abs(dif) < 1) return null
    return { tipo: "desactualizado", precio_base_guardado: guardado, precio_base_segun_costo: segunCosto, diferencia_pct: dif }
  }
  return { tipo: "cambia_solo", precio_base_guardado: null, precio_base_segun_costo: segunCosto, diferencia_pct: null }
}

export interface FilaLista {
  codigo: string | null
  descripcion: string | null
  precio_compra: number | null
  descuento1: number | null
  descuento2: number | null
  descuento3: number | null
  descuento4: number | null
}

/**
 * Renglones de una lista en Excel / CSV (filas tal cual la planilla). Busca la fila de títulos y
 * reconoce: código, descripción, precio (lista) y hasta cuatro descuentos ("desc 1", "dto2",
 * "bonif 3"… o una sola columna "descuento"). Una celda de descuento vacía queda null.
 */
export function filasDeListaExcel(rows: unknown[][]): FilaLista[] {
  if (!rows || rows.length === 0) return []
  const norm = (c: unknown) => String(c ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
  const claves = ["descripcion", "producto", "detalle", "codigo", "sku", "ean", "precio", "costo", "lista", "descuento", "dto", "bonif", "desc"]
  let fila = 0, mejor = 0
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const texto = (rows[i] || []).map(norm).join(" ")
    const n = claves.filter((k) => texto.includes(k)).length
    if (n > mejor) { mejor = n; fila = i }
  }
  const titulos = (rows[fila] || []).map(norm)
  const col = { codigo: -1, descripcion: -1, precio: -1 }
  const descuentos: number[] = []
  titulos.forEach((h, i) => {
    const esDescuento = /^(desc(uento)?|dto|bonif(icacion)?)\b/.test(h) || /\b(dto|bonif)\b/.test(h) || (h.includes("desc") && !h.includes("descrip"))
    if (esDescuento) { descuentos.push(i); return }
    if (col.descripcion < 0 && (h.includes("descrip") || h.includes("detalle") || h.includes("producto") || h.includes("articulo"))) { col.descripcion = i; return }
    if (col.codigo < 0 && (h.includes("codigo") || h.includes("sku") || h.includes("ean") || h === "cod" || h === "id")) { col.codigo = i; return }
    if (col.precio < 0 && (h.includes("precio") || h.includes("costo") || h.includes("lista") || h.includes("importe")) && !h.includes("total") && !h.includes("neto") && !h.includes("final")) col.precio = i
  })
  // si no hay una columna de precio "de lista", vale una que diga precio / costo aunque sea neto
  if (col.precio < 0) col.precio = titulos.findIndex((h) => (h.includes("precio") || h.includes("costo")) && !h.includes("total"))

  const salida: FilaLista[] = []
  for (let i = fila + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const codigo = col.codigo >= 0 ? String(r[col.codigo] ?? "").trim() : ""
    const descripcion = col.descripcion >= 0 ? String(r[col.descripcion] ?? "").trim() : ""
    const precio = col.precio >= 0 ? valorDeCelda(r[col.precio]) : null
    const d = descuentos.slice(0, 4).map((c) => valorDeCelda(r[c]))
    if (!codigo && !descripcion) continue
    // un renglón sin precio y sin descuentos es un título de rubro o una fila en blanco
    if (precio === null && d.every((x) => x === null)) continue
    salida.push({ codigo: codigo || null, descripcion: descripcion || null, precio_compra: precio, descuento1: d[0] ?? null, descuento2: d[1] ?? null, descuento3: d[2] ?? null, descuento4: d[3] ?? null })
  }
  return salida
}

/** ¿La lista rige desde una fecha futura? (fechas ISO aaaa-mm-dd; `hoy` = hoy en Argentina) */
export function esVigenciaFutura(fechaVigencia: string | null | undefined, hoy: string): boolean {
  const f = String(fechaVigencia || "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(f) && f > hoy
}
