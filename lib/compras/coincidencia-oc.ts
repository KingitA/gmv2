/**
 * ¿Qué artículo de la ORDEN DE COMPRA es este renglón de la factura?
 *
 * Se usa para vincular los renglones que el matching no pudo resolver (sin_match / sugerido):
 *  - la pantalla de verificación propone el artículo de la orden que coincide,
 *  - y si coincide con UN SOLO artículo de la orden se vincula solo (lib/compras/vincular-renglon.ts).
 *
 * La factura puede traer la cantidad en bultos o en unidades, y el precio por bulto o por unidad.
 * Un artículo de la orden COINCIDE con el renglón cuando:
 *   (cantidad = lo pedido en BULTOS   y precio ≈ precio unitario de la orden × unidades por bulto)
 *   o (cantidad = lo pedido en UNIDADES y precio ≈ precio unitario de la orden)
 *
 * Tolerancia del precio: 0,5 % o $1, lo que sea mayor (redondeos del proveedor:
 * factura $15.346,61 contra 767,33 × 20 = $15.346,60).
 *
 * Funciones PURAS (sin base ni pantalla): pruebas en mobile/packages/core/test/coincidencia-oc.test.ts.
 */

export interface RenglonFacturaCoincidencia {
  cantidad: number
  /** Precio unitario tal cual la factura (por bulto o por unidad, no se sabe) */
  precio: number
}

export interface ArticuloOrdenCoincidencia {
  articulo_id: string
  /** Cantidad del renglón de la orden, en la unidad de `tipo_cantidad` */
  cantidad_pedida: number
  /** 'unidad' = pedido en unidades; cualquier otro valor (o vacío) = pedido en bultos */
  tipo_cantidad?: string | null
  unidades_por_bulto?: number | null
  /** Precio por UNIDAD en la orden */
  precio_unitario: number
}

export type FormaCoincidencia = "bulto" | "unidad"

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Unidades por bulto con sentido (sin dato o ≤ 1 = 1) */
export function upbOrden(a: Pick<ArticuloOrdenCoincidencia, "unidades_por_bulto">): number {
  const u = num(a.unidades_por_bulto)
  return u > 1 ? u : 1
}

/** Lo pedido en unidades y en bultos */
export function pedidoDe(a: ArticuloOrdenCoincidencia): { unidades: number; bultos: number; upb: number } {
  const upb = upbOrden(a)
  const unidades = a.tipo_cantidad === "unidad" ? num(a.cantidad_pedida) : num(a.cantidad_pedida) * upb
  return { unidades, bultos: unidades / upb, upb }
}

/** Precios "iguales": diferencia ≤ máx(0,5 %, $1) */
export function precioParecido(a: number, b: number): boolean {
  const x = num(a)
  const y = num(b)
  if (x <= 0 || y <= 0) return false
  const tolerancia = Math.max(1, 0.005 * Math.max(x, y))
  return Math.abs(x - y) <= tolerancia
}

const mismaCantidad = (a: number, b: number) => a > 0 && Math.abs(a - b) < 0.0001

/** Cómo coincide el renglón con el artículo de la orden (por bulto o por unidad), o null si no coincide */
export function coincidencia(f: RenglonFacturaCoincidencia, a: ArticuloOrdenCoincidencia): FormaCoincidencia | null {
  const cant = num(f.cantidad)
  const precio = num(f.precio)
  if (cant <= 0 || precio <= 0) return null
  const { unidades, bultos, upb } = pedidoDe(a)
  const pu = num(a.precio_unitario)
  if (mismaCantidad(cant, bultos) && precioParecido(precio, pu * upb)) return "bulto"
  if (mismaCantidad(cant, unidades) && precioParecido(precio, pu)) return "unidad"
  return null
}

/** Artículos de la orden que coinciden con el renglón (sin repetir artículo) */
export function articulosQueCoinciden<T extends ArticuloOrdenCoincidencia>(f: RenglonFacturaCoincidencia, orden: T[]): T[] {
  const vistos = new Set<string>()
  const out: T[] = []
  for (const a of orden) {
    if (vistos.has(a.articulo_id)) continue
    if (coincidencia(f, a)) {
      vistos.add(a.articulo_id)
      out.push(a)
    }
  }
  return out
}

/**
 * Vínculos automáticos: para cada renglón, el ÚNICO artículo de la orden que coincide.
 * No se vincula solo (queda para que elija una persona) cuando:
 *  - coincide con más de un artículo o con ninguno,
 *  - dos renglones apuntan al mismo artículo,
 *  - el artículo ya está vinculado a otro renglón del mismo comprobante (`yaVinculados`).
 * Devuelve renglón → articulo_id.
 */
export function vinculosAutomaticos(
  renglones: Array<RenglonFacturaCoincidencia & { id: string }>,
  orden: ArticuloOrdenCoincidencia[],
  yaVinculados: Iterable<string> = [],
): Map<string, string> {
  const ocupados = new Set(yaVinculados)
  const propuesta = new Map<string, string>()
  const cuenta = new Map<string, number>()
  for (const r of renglones) {
    const c = articulosQueCoinciden(r, orden)
    if (c.length !== 1) continue
    const id = c[0].articulo_id
    if (ocupados.has(id)) continue
    propuesta.set(r.id, id)
    cuenta.set(id, (cuenta.get(id) || 0) + 1)
  }
  for (const [renglon, art] of [...propuesta]) if ((cuenta.get(art) || 0) > 1) propuesta.delete(renglon)
  return propuesta
}
