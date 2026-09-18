// =====================================================
// Vigencia de insumos de precio — PURO (isomórfico)
// =====================================================
// Dos mecanismos, ambos resueltos acá para que servidor y dispositivo den lo mismo:
//
// 1. Cambios PROGRAMADOS (tabla precios_programados): "a partir del lunes 08:00
//    el artículo X pasa a precio_base = 1234". Los dispositivos los descargan por
//    adelantado y los aplican solos al llegar la hora (aplicarProgramados), aunque
//    estén offline todo el día. El servidor además los materializa (función SQL
//    aplicar_precios_programados) escribiendo la tabla real.
//
// 2. HISTORIAL (tabla precio_insumos_historial): cada versión de una fila de insumo
//    con [vigente_desde, vigente_hasta). Permite reconstruir los insumos "vigentes
//    a la fecha de captura" de un pedido offline (reconstruirAFecha) y recalcular
//    en el servidor exactamente el mismo precio que vio el vendedor.
//
// Regla: una materialización registra en el historial vigente_desde = la vigencia
// programada (no la hora en que corrió el job), así el historial y los programados
// nunca se contradicen.

export interface CambioProgramado {
  id: string
  tabla: string
  registro_id: string
  /** columna → nuevo valor */
  cambios: Record<string, unknown>
  /** ISO timestamp */
  vigencia_desde: string
  estado: "pendiente" | "aplicado" | "cancelado"
}

export interface VersionHistorial<T = Record<string, unknown>> {
  tabla: string
  registro_id: string
  /** Fila completa en esa versión; null = fila borrada a partir de vigente_desde */
  datos: T | null
  vigente_desde: string
  vigente_hasta: string | null
}

const ms = (iso: string) => new Date(iso).getTime()

/**
 * Aplica sobre las filas actuales los cambios programados PENDIENTES cuya
 * vigencia ya llegó a `fecha`, en orden cronológico (el último gana).
 * Devuelve filas nuevas (no muta la entrada). Filas sin id conocido se ignoran.
 */
export function aplicarProgramados<T extends { id: string }>(
  filas: T[],
  programados: CambioProgramado[],
  tabla: string,
  fecha: Date | string,
): T[] {
  const t = typeof fecha === "string" ? ms(fecha) : fecha.getTime()
  const vigentes = programados
    .filter((p) => p.tabla === tabla && p.estado === "pendiente" && ms(p.vigencia_desde) <= t)
    .sort((a, b) => ms(a.vigencia_desde) - ms(b.vigencia_desde) || a.id.localeCompare(b.id))
  if (!vigentes.length) return filas
  const porId = new Map<string, CambioProgramado[]>()
  for (const p of vigentes) {
    const l = porId.get(p.registro_id) || []
    l.push(p)
    porId.set(p.registro_id, l)
  }
  return filas.map((f) => {
    const cambios = porId.get(f.id)
    if (!cambios) return f
    let r: T = { ...f }
    for (const c of cambios) r = { ...r, ...(c.cambios as Partial<T>) }
    return r
  })
}

/** Próxima vigencia programada (pendiente) posterior a `desde`, para agendar un re-render. */
export function proximaVigencia(programados: CambioProgramado[], desde: Date = new Date()): Date | null {
  let min: number | null = null
  const t = desde.getTime()
  for (const p of programados) {
    if (p.estado !== "pendiente") continue
    const v = ms(p.vigencia_desde)
    if (v > t && (min === null || v < min)) min = v
  }
  return min === null ? null : new Date(min)
}

/**
 * Reconstruye las filas de una tabla tal como estaban vigentes en `fecha`.
 * - `actuales`: estado actual de la tabla (o del subconjunto de interés).
 * - `historial`: versiones de esa tabla con vigente_hasta > fecha o null
 *   (alcanza con las que cambiaron DESPUÉS de fecha; las demás están igual que hoy).
 * Filas creadas después de `fecha` desaparecen; filas borradas después reaparecen.
 * Los joins (rubros, proveedor) NO se versionan: se toman de la fila actual.
 */
export function reconstruirAFecha<T extends { id: string }>(
  actuales: T[],
  historial: VersionHistorial<T>[],
  fecha: Date | string,
): T[] {
  const t = typeof fecha === "string" ? ms(fecha) : fecha.getTime()
  const porId = new Map<string, VersionHistorial<T>[]>()
  for (const v of historial) {
    const l = porId.get(v.registro_id) || []
    l.push(v)
    porId.set(v.registro_id, l)
  }
  const out = new Map<string, T>()
  const actualesPorId = new Map<string, T>()
  for (const f of actuales) {
    out.set(f.id, f)
    actualesPorId.set(f.id, f)
  }
  for (const [id, versiones] of porId) {
    const vigente = versiones.find(
      (v) => ms(v.vigente_desde) <= t && (v.vigente_hasta === null || ms(v.vigente_hasta) > t),
    )
    if (vigente) {
      // Se funde sobre la fila actual para conservar campos derivados que el
      // historial no versiona (joins como rubros/proveedor).
      if (vigente.datos) out.set(id, { ...(actualesPorId.get(id) || ({} as T)), ...(vigente.datos as T), id })
      else out.delete(id)
    } else if (versiones.every((v) => ms(v.vigente_desde) > t)) {
      // Toda la historia conocida empieza después de `fecha`: la fila no existía.
      out.delete(id)
    }
  }
  return [...out.values()]
}
