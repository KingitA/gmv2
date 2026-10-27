// Tope de devolución en el equipo (#25, prueba de salida 26/10/2026: CHEN compró 6 naftalinas y
// entraron dos devoluciones de 6). La MISMA regla que el servidor (`excedeTopeDevolucion`,
// lib/cobranzas/tope-devolucion.ts): por renglón, contra su comprobante de origen, no se puede
// devolver más de lo vendido menos lo ya devuelto. Lo ya devuelto suma lo que trae la réplica
// (devoluciones pendientes, aceptadas o con NC, de cualquier app) y lo cargado en este equipo
// que todavía no salió. Funciones PURAS (tests en packages/core/test/chofer-salida.test.ts).
//
// C8 (Juan 27/10): si el origen es un PRESUPUESTO, lo que pasa de lo comprado NO se frena: el
// servidor lo manda al PRES de respaldo 0002-00000001 como "sistema viejo" y la oficina lo controla
// (repartirExcedenteAlRespaldo, lib/cobranzas/respaldo-devolucion.ts). En FACTURA el tope sigue.
//
// Si el origen no está en la réplica (réplica vieja, comprobante sin detalle, origen de respaldo),
// no se topea acá: el servidor lo controla igual y, si se pasa, rechaza con el texto por artículo.

export interface FilaDevolvible { comprobante_venta_id: string; articulo_id: string; vendido: number; devuelto: number; /** C8: el comprobante es un PRES (no el respaldo) */ presupuesto?: boolean }

/** PRES de respaldo "del sistema viejo" (= NUMERO_RESPALDO_DEVOLUCION del servidor) */
const NUMERO_RESPALDO = "0002-00000001"

export interface RenglonParaTope { articulo_id: string; cantidad: number; comprobante_venta_id?: string | null; origen_comp?: { comprobante_venta_id: string | null; fiscal?: boolean; numero_comprobante?: string | null } | null }

/** Comprobante de origen de un renglón cargado en la app. */
export const origenDe = (r: RenglonParaTope) => r.comprobante_venta_id ?? r.origen_comp?.comprobante_venta_id ?? null

export interface Tope {
  vendido: number
  /** Ya devuelto (servidor + sin enviar), sin contar el renglón que se está editando */
  devuelto: number
  /** Lo máximo que se puede devolver en este renglón (en presupuesto, lo que va contra lo comprado) */
  maximo: number
  /** C8: origen PRES ⇒ el excedente NO se frena, va como "sistema viejo" */
  presupuesto: boolean
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
  // Réplica sin el dato (antes del 27/10): el origen que mandó el servidor dice si es presupuesto
  const presupuesto = fila.presupuesto ?? (renglon.origen_comp?.fiscal === false && renglon.origen_comp?.numero_comprobante !== NUMERO_RESPALDO)
  return { vendido: Number(fila.vendido) || 0, devuelto, maximo: Math.max(0, (Number(fila.vendido) || 0) - devuelto), presupuesto }
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

/** ¿Este tope frena? (factura sí; presupuesto no, C8) */
export const frena = (t: Tope | null): t is Tope => !!t && !t.presupuesto

/** C8: lo que pasa de lo comprado en un presupuesto (0 si no pasa o si es factura). */
export const excedenteSistemaViejo = (t: Tope | null, cantidad: number) => (t?.presupuesto ? Math.max(0, (Number(cantidad) || 0) - t.maximo) : 0)

export const textoExcedente = (n: number) => `Lo que pasa de lo comprado (${cant(n)}) va como sistema viejo: lo revisa la oficina.`

/** El primer renglón que se pasa del tope (para no dejar registrar), o null. */
export function primerExceso(devolvible: FilaDevolvible[] | null | undefined, renglones: Array<RenglonParaTope & { descripcion?: string }>, sinEnviar: RenglonParaTope[] = []): string | null {
  for (const r of renglones) {
    const t = topeDevolucion(devolvible, r, sinEnviar)
    if (frena(t) && (Number(r.cantidad) || 0) > t.maximo + 1e-6) return textoTope(t, r.descripcion)
  }
  return null
}
