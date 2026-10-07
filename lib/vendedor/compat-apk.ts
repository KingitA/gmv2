// Compatibilidad con la APK vendedor instalada (≤ 0.2.3). PURO: sin imports.
//
// Su motor resuelve lista/método con la regla vieja: la ficha del cliente POR
// SEGMENTO le gana al método/lista "solo este pedido". El servidor cambió la regla
// (06/10/2026: lo del pedido gana siempre). Para los pedidos de esas versiones se
// fija en el pedido, por segmento, el valor de la ficha: el resultado es idéntico a
// lo que el vendedor vio en el equipo y no salta ninguna alerta de integridad.
// Retirar cuando todos los equipos tengan la APK nueva.

const CENTINELAS = new Set(["PorSegmento", "porsegmento", "__por_segmento__", "por_segmento"])
const lc = (v: unknown): string | undefined => (typeof v === "string" && v && !CENTINELAS.has(v) ? v : undefined)

/** true = APK vendedor con la regla vieja (≤ 0.2.3, o versión desconocida). */
export function esApkVendedorVieja(appVersion: string | null | undefined): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(appVersion || ""))
  if (!m) return true
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return maj === 0 && (min < 2 || (min === 2 && pat <= 3))
}

/** [col ficha lista, col ficha método, col pedido lista, col pedido método] por segmento */
export const SEGS_COMPAT = [
  ["lista_limpieza_id", "metodo_limpieza", "lista_limpieza_pedido_id", "metodo_limpieza_pedido"],
  ["lista_perf0_id", "metodo_perf0", "lista_perf0_pedido_id", "metodo_perf0_pedido"],
  ["lista_perf_plus_id", "metodo_perf_plus", "lista_perf_plus_pedido_id", "metodo_perf_plus_pedido"],
] as const

/**
 * Si el pedido trae método/lista general "solo este pedido", agrega por segmento
 * el valor de la ficha donde la ficha lo define (la regla vieja: la ficha por
 * segmento gana). Sin override general no hace falta nada.
 */
export function compatOverridesApkVieja<T extends Record<string, any>>(overrides: T, cliente: Record<string, any> | null | undefined): T {
  const out: Record<string, any> = { ...overrides }
  for (const [listaCli, metodoCli, listaPed, metodoPed] of SEGS_COMPAT) {
    if (overrides.metodo_facturacion_pedido && lc(cliente?.[metodoCli])) out[metodoPed] = lc(cliente?.[metodoCli])
    if (overrides.lista_precio_pedido_id && lc(cliente?.[listaCli])) out[listaPed] = lc(cliente?.[listaCli])
  }
  return out as T
}
