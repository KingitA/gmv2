// Actualización de las apps con un botón (17/11/2026). Ver MOBILE.md → "Actualización desde la app".
// Regla pura (la usan la ruta GET /api/mobile/actualizacion y los tests).

import type { RespuestaActualizacion } from "./contrato"

export interface FilaVersion {
  version_name: string
  version_code: number
  archivo: string
  tamano_bytes: number
  sha256: string
  notas: string | null
  obligatoria: boolean
}

/**
 * La última publicada de la app, si es más nueva que la del equipo. Es obligatoria si
 * CUALQUIERA de las que le faltan al equipo lo es (saltear una obligatoria no vale).
 * `codeEquipo` null (APK sin el header) = se le ofrece la última.
 */
export function elegirActualizacion(filas: FilaVersion[], codeEquipo: number | null): { ultima: FilaVersion; obligatoria: boolean } | null {
  const nuevas = filas.filter((f) => codeEquipo == null || f.version_code > codeEquipo)
  if (!nuevas.length) return null
  const ultima = nuevas.reduce((a, b) => (b.version_code > a.version_code ? b : a))
  return { ultima, obligatoria: nuevas.some((f) => f.obligatoria) }
}

/** Header x-app-version-code → número (null si no vino o no es válido). */
export function codeDelHeader(v: string | null): number | null {
  const n = Number(v)
  return v && Number.isInteger(n) && n > 0 ? n : null
}

export const SIN_ACTUALIZACION: RespuestaActualizacion = {
  hay: false, version_name: null, version_code: null, notas: null, obligatoria: false, tamano_bytes: null, sha256: null, url: null,
}
