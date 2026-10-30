// FRENO DE LA SINCRONIZACIÓN (P2-49, 29/10/2026; vale para las 3 apps).
//
// Con la base de producción cargada, el servidor de sync contesta 503 con "esperá X s"
// (header Retry-After y `reintentar_en_s`). Las apps no le vuelven a pegar antes, esperan
// a que los cambios se calmen antes de re-sincronizar, y espacian los reintentos cuando
// la sincronización falla seguido. Reglas puras (las prueban los tests).

/** Rutas que frena: lecturas de la réplica (el outbox de escrituras tiene su propio backoff). */
export const esRutaSync = (path: string) => path.startsWith("/api/mobile/sync/")

/** Segundos que pide el servidor: header Retry-After (segundos) o `reintentar_en_s`. null = no dijo. */
export function esperaPedida(retryAfter: string | null | undefined, body: unknown): number | null {
  const h = Number(retryAfter)
  if (retryAfter != null && retryAfter !== "" && Number.isFinite(h) && h > 0) return h
  const b = Number((body as { reintentar_en_s?: unknown } | null)?.reintentar_en_s)
  return Number.isFinite(b) && b > 0 ? b : null
}

/** Espera tras `fallos` fallos seguidos de sync: 30 s, 60 s, 2 min, 4 min… tope 10 min, ±20 % al azar. */
export function esperaPorFallos(fallos: number, azar = Math.random()): number {
  if (fallos <= 0) return 0
  const base = Math.min(10 * 60_000, 30_000 * 2 ** (fallos - 1))
  return Math.round(base * (0.8 + 0.4 * azar))
}

/**
 * Cuándo re-sincronizar tras ver cambios en el servidor: 60 s + 0-30 s al azar después del
 * ÚLTIMO cambio visto (si siguen llegando cambios, se corre), pero nunca más de 5 min después
 * del primero (si no, con cambios todo el tiempo no se actualizaría nunca).
 */
export function momentoResync(primerCambio: number, ultimoCambio: number, azar = Math.random()): number {
  const calma = ultimoCambio + 60_000 + Math.round(30_000 * azar)
  return Math.min(calma, primerCambio + 5 * 60_000)
}
