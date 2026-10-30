// Reglas del campo de cantidad (pantalla PanelCantidad). Puras: tests en
// packages/core/test/deposito-p2.test.ts.

import { parseMonto } from "@gm/formato"

/**
 * Texto tipeado → cantidad. "vacia" = el operario todavía no escribió nada (con
 * `exigir`, P2-16, no se confirma; sin `exigir` vale 0, como siempre). "invalida" =
 * negativa, ilegible o de 7+ cifras (un código que el lector tipeó en el campo).
 * Formato argentino: "1.500" = mil quinientos, "1,5" = uno y medio.
 */
export function leerCantidad(txt: string, exigir: boolean): number | "vacia" | "invalida" {
  if (!txt.trim()) return exigir ? "vacia" : 0
  const n = parseMonto(txt)
  return n === null || n < 0 || n >= 1_000_000 ? "invalida" : n
}

/** Picking: escribir 0 es decir "no hay" ⇒ faltante (0 sin faltante devolvería el renglón a pendiente). */
export const marcaPicking = (cantidad: number, faltante: boolean) => ({
  cantidad: faltante ? 0 : cantidad,
  esFaltante: faltante || cantidad === 0,
})
