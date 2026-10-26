// Tope de devolución en el equipo (#25, prueba de salida 26/10/2026: CHEN compró 6 naftalinas y
// entraron dos devoluciones de 6). La MISMA regla que el servidor (`excedeTopeDevolucion`,
// lib/cobranzas/tope-devolucion.ts): por renglón, contra su comprobante de origen, no se puede
// devolver más de lo vendido menos lo ya devuelto. Lo ya devuelto suma lo que trae la réplica
// (devoluciones pendientes, aceptadas o con NC, de cualquier app) y lo cargado en este equipo
// que todavía no salió. Funciones PURAS (tests en packages/core/test/chofer-salida.test.ts).
//
// Si el origen no está en la réplica (réplica vieja, comprobante sin detalle, origen de respaldo),
// no se topea acá: el servidor lo controla igual y, si se pasa, rechaza con el texto por artículo.

export interface FilaDevolvible { comprobante_venta_id: string; articulo_id: string; vendido: number; devuelto: number }

export interface RenglonParaTope { articulo_id: string; cantidad: number; comprobante_venta_id?: string | null; origen_comp?: { comprobante_venta_id: string | null } | null }

/** Comprobante de origen de un renglón cargado en la app. */
export const origenDe = (r: RenglonParaTope) => r.comprobante_venta_id ?? r.origen_comp?.comprobante_venta_id ?? null

export interface Tope {
  vendido: number
  /** Ya devuelto (servidor + sin enviar), sin contar el renglón que se está editando */
  devuelto: number
  /** Lo máximo que se puede devolver en este renglón */
  maximo: number
}

/**
 * Tope de un renglón. `sinEnviar` = renglones de devoluciones de este equipo que todavía no llegaron
 * al servidor (y que por eso la réplica no cuenta). null = no se puede controlar en el equipo.
 */
export function topeDevolucion(devolvible: FilaDevolvible[] | null | undefined, renglon: RenglonParaTope, sinEnviar: RenglonParaTope[] = []): Tope | null {
  const comp = origenDe(renglon)
  if (!devolvible || !comp) return null
  const fila = devolvible.find((f) => f.comprobante_venta_id === comp && f.articulo_id === renglon.articulo_id)
  if (!fila) return null
  const local = sinEnviar.filter((r) => r.articulo_id === renglon.articulo_id && origenDe(r) === comp).reduce((s, r) => s + (Number(r.cantidad) || 0), 0)
  const devuelto = (Number(fila.devuelto) || 0) + local
  return { vendido: Number(fila.vendido) || 0, devuelto, maximo: Math.max(0, (Number(fila.vendido) || 0) - devuelto) }
}

const cant = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",")

/** "Ya se devolvieron 6 de 6" / "Se vendieron 6, ya se devolvieron 2: podés devolver hasta 4". */
export function textoTope(t: Tope, descripcion?: string): string {
  const quien = descripcion ? `${descripcion}: ` : ""
  if (t.maximo <= 0) return `${quien}ya se devolvieron ${cant(t.devuelto)} de ${cant(t.vendido)}. No se puede devolver más.`
  return t.devuelto > 0
    ? `${quien}se vendieron ${cant(t.vendido)}, ya se devolvieron ${cant(t.devuelto)}: podés devolver hasta ${cant(t.maximo)}.`
    : `${quien}se vendieron ${cant(t.vendido)}: podés devolver hasta ${cant(t.maximo)}.`
}

/** El primer renglón que se pasa del tope (para no dejar registrar), o null. */
export function primerExceso(devolvible: FilaDevolvible[] | null | undefined, renglones: Array<RenglonParaTope & { descripcion?: string }>, sinEnviar: RenglonParaTope[] = []): string | null {
  for (const r of renglones) {
    const t = topeDevolucion(devolvible, r, sinEnviar)
    if (t && (Number(r.cantidad) || 0) > t.maximo + 1e-6) return textoTope(t, r.descripcion)
  }
  return null
}
