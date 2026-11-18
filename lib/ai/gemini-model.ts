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
    // E-101: sin saldo o sin cuota no se falla en silencio: queda anotado y con aviso para admin
    await avisarFallaGemini(e, etiqueta)
    if (!GEMINI_MODEL_FALLBACK || GEMINI_MODEL_FALLBACK === GEMINI_MODEL || !esErrorDeModeloGemini(e)) throw e
    console.warn(`[${etiqueta}] ${GEMINI_MODEL} falló, se reintenta con ${GEMINI_MODEL_FALLBACK}:`, (e as Error)?.message)
    try {
      return await fn(GEMINI_MODEL_FALLBACK)
    } catch (e2) {
      await avisarFallaGemini(e2, etiqueta)
      throw e2
    }
  }
}

/**
 * E-101: anota una falla de Gemini por saldo o cuota (402 / 429) y deja el aviso en la bandeja
 * de Jarvis. No lanza nunca. Se importa a demanda para no cargar el cliente de la base en los
 * lugares que solo necesitan el nombre del modelo.
 */
export async function avisarFallaGemini(e: unknown, origen: string): Promise<void> {
  try {
    const { registrarFallaIA } = await import("./fallas-ia")
    await registrarFallaIA("gemini", e, origen)
  } catch { /* nunca rompe la lectura */ }
}
