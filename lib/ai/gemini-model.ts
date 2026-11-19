/**
 * Modelo Gemini — ÚNICO lugar donde se nombra.
 *
 * Google retira modelos sin aviso (el 17/09/2026 `gemini-2.0-flash` y
 * `gemini-2.0-flash-001` empezaron a responder 404 "no longer available").
 * Con el nombre repartido en 9 archivos, cada baja rompía importaciones de
 * pedidos, lectura de adjuntos y facturas de proveedor a la vez. Ahora se cambia
 * acá (o por env GEMINI_MODEL, sin deploy).
 *
 * Principal `gemini-3.8-flash` (E-82, 18/11/2026). Según la documentación oficial de Google
 * (páginas "Models" y "Deprecations" de la API de Gemini, leídas el 18/11/2026):
 *   - `gemini-3.8-flash` es el Flash estable más nuevo (publicado el 02/09/2026), sin fecha de baja.
 *   - `gemini-2.5-flash` (el que se usaba) está DEPRECADO: desde el 01/12/2026 Google manda sus
 *     pedidos a `gemini-3.5-flash-lite`, un modelo más chico. Sin este cambio, la lectura de
 *     facturas, remitos y cheques pasaba sola a un modelo peor, sin ningún aviso.
 *   - `gemini-3.6-flash` también es estable y sin fecha de baja.
 *
 * Respaldo `gemini-3.6-flash` (estable, sin fecha de baja): `gemini-2.5-flash` está deprecado y desde el 01/12/2026 Google
 * lo redirige a un modelo "lite", peor para leer comprobantes.
 * principal falla (dado de baja, cuota, caído). OJO: desde el 01/12/2026 ese nombre responde
 * con el modelo "lite"; a partir de ahí conviene poner GEMINI_MODEL_FALLBACK=gemini-3.6-flash.
 *
 * NO se pudo probar en vivo al hacer el cambio (sin clave en el equipo de desarrollo): si el
 * OCR empieza a avisar "se leyó con el modelo de respaldo", el principal no está respondiendo
 * → poner GEMINI_MODEL=gemini-2.5-flash en Vercel (sin deploy de código) y avisar a sistemas.
 *
 * Estos modelos PIENSAN antes de contestar y ese pensamiento cuenta dentro de maxOutputTokens:
 * no usar topes chicos (64, 128) aunque la respuesta sea un JSON de una línea.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash"

/** Se usa UNA vez si el principal falla (ver arriba por qué es este). */
export const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || "gemini-3.6-flash"

/**
 * ¿El error es del MODELO o del servicio (dado de baja, cuota, caído) y vale la pena
 * probar con el de respaldo? Un corte por tiempo o una respuesta mal formada NO: el
 * respaldo tardaría lo mismo y duplicaría la espera.
 */
export function esErrorDeModeloGemini(e: unknown): boolean {
  const err = e as { status?: number; name?: string; message?: string } | null
  const msg = String(err?.message || "")
  if (err?.name === "AbortError" || /timed? ?out|aborted/i.test(msg)) return false
  const status = Number(err?.status) || Number(/\[(\d{3})\b/.exec(msg)?.[1]) || Number(/Gemini API (\d{3})/.exec(msg)?.[1]) || 0
  if ([404, 429, 500, 502, 503, 504].includes(status)) return true
  return /not found|no longer available|not supported|unavailable|overloaded|deprecated/i.test(msg)
}

/**
 * Corre `fn` con el modelo principal y, si el modelo o el servicio fallan, UNA vez más
 * con el de respaldo (E-37). Para todo lo que lee documentos con Gemini por el SDK.
 */
export async function conRespaldoGemini<T>(fn: (modelo: string) => Promise<T>, etiqueta = "gemini"): Promise<T> {
  try {
    return await fn(GEMINI_MODEL)
  } catch (e) {
    // E-101: no se falla en silencio, pero tampoco se alarma por un 429 pasajero o de un solo modelo.
    //  - sin crédito / facturación (402): se avisa ya, el respaldo es de la misma cuenta;
    //  - cuota o demasiados pedidos (429): se avisa solo si no hay respaldo o si el respaldo también falla.
    const hayRespaldo = !!GEMINI_MODEL_FALLBACK && GEMINI_MODEL_FALLBACK !== GEMINI_MODEL && esErrorDeModeloGemini(e)
    await avisarFallaGemini(e, etiqueta, { soloSaldo: hayRespaldo })
    if (!hayRespaldo) throw e
    console.warn(`[${etiqueta}] ${GEMINI_MODEL} falló, se reintenta con ${GEMINI_MODEL_FALLBACK}:`, (e as Error)?.message)
    try {
      return await fn(GEMINI_MODEL_FALLBACK)
    } catch (e2) {
      // Fallaron los dos: ahora sí cuenta también la cuota (la del principal o la del respaldo),
      // pero UNA sola anotación por lectura
      await avisarFallaDoble(e, e2, etiqueta)
      throw e2
    }
  }
}

// Marca en el error que la falla ya se anotó: quien lo vuelva a atrapar más arriba (p. ej. el
// catch general de lib/services/ocr.ts) no la anota otra vez.
const AVISADA = Symbol.for("gm.falla_ia_avisada")
const marcarAvisada = (e: unknown) => {
  if (e && typeof e === "object") { try { (e as Record<symbol, unknown>)[AVISADA] = true } catch { /* objeto congelado */ } }
}
export const fallaYaAvisada = (e: unknown): boolean => !!e && typeof e === "object" && (e as Record<symbol, unknown>)[AVISADA] === true

/**
 * Fallaron el modelo principal y el de respaldo en la MISMA lectura: se anota una sola vez.
 * Si el principal ya se anotó (sin crédito), no se repite; si no, se anota el del respaldo si es
 * por saldo o cuota, y si no el del principal. Los dos errores quedan marcados como avisados.
 */
export async function avisarFallaDoble(principal: unknown, respaldo: unknown, origen: string): Promise<void> {
  try {
    if (!fallaYaAvisada(principal)) {
      const { esFallaDeSaldoOCuota } = await import("./fallas-ia")
      await avisarFallaGemini(esFallaDeSaldoOCuota(respaldo) ? respaldo : principal, origen)
    }
  } catch { /* nunca rompe la lectura */ }
  marcarAvisada(principal)
  marcarAvisada(respaldo)
}

/**
 * E-101: anota una falla de Gemini por saldo o cuota y deja el aviso en la bandeja de Jarvis.
 * No lanza nunca. Se importa a demanda para no cargar el cliente de la base en los lugares que
 * solo necesitan el nombre del modelo.
 * `soloSaldo`: avisar solo si es por plata (402 / facturación). Por defecto avisa también por
 * cuota (429): usarlo así solo cuando ya no queda otro intento.
 */
export async function avisarFallaGemini(e: unknown, origen: string, opciones: { soloSaldo?: boolean } = {}): Promise<void> {
  if (fallaYaAvisada(e)) return // ya anotada más abajo: una falla, una anotación
  try {
    const { registrarFallaIA, esFallaDeSaldo, esFallaDeSaldoOCuota } = await import("./fallas-ia")
    const corresponde = opciones.soloSaldo === true ? esFallaDeSaldo(e) : esFallaDeSaldoOCuota(e)
    await registrarFallaIA("gemini", e, origen, opciones.soloSaldo === true)
    if (corresponde) marcarAvisada(e)
  } catch { /* nunca rompe la lectura */ }
}
