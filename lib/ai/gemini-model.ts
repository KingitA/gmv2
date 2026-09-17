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
