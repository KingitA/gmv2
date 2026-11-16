/**
 * Modelo Gemini — ÚNICO lugar donde se nombra.
 *
 * Google retira modelos sin aviso (el 17/09/2026 `gemini-2.0-flash` y
 * `gemini-2.0-flash-001` empezaron a responder 404 "no longer available").
 * Con el nombre repartido en 9 archivos, cada baja rompía importaciones de
 * pedidos, lectura de adjuntos y facturas de proveedor a la vez. Ahora se cambia
 * acá (o por env GEMINI_MODEL, sin deploy).
 *
 * Default `gemini-2.5-flash`: es el que ya usa el OCR de cheques en producción
 * (lib/services/ocr.ts) y está verificado funcionando. El mensaje de baja de
 * Google recomendaba `gemini-3.6-flash`; para probarlo alcanza con la env.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"

/** Alias estable de Google: siempre apunta al Flash vigente. Se usa si el principal falla. */
export const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || "gemini-flash-latest"

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
    if (!GEMINI_MODEL_FALLBACK || GEMINI_MODEL_FALLBACK === GEMINI_MODEL || !esErrorDeModeloGemini(e)) throw e
    console.warn(`[${etiqueta}] ${GEMINI_MODEL} falló, se reintenta con ${GEMINI_MODEL_FALLBACK}:`, (e as Error)?.message)
    return fn(GEMINI_MODEL_FALLBACK)
  }
}
