// Lista y método de facturación de la FICHA desde la app/web del vendedor: general o
// POR SEGMENTO (Limpieza/Bazar · Perfumería 0 · Perfumería plus), igual que la ficha
// del ERP (decisión del dueño, 09/10/2026). Una sola validación para el alta
// (POST /api/vendedor/clientes) y la edición (PATCH /api/vendedor/cliente/[id]).

/** Columnas de lista de la ficha (general + por segmento) */
export const CAMPOS_LISTA = ["lista_precio_id", "lista_limpieza_id", "lista_perf0_id", "lista_perf_plus_id"] as const
/** Columnas de método de la ficha (general + por segmento) */
export const CAMPOS_METODO = ["metodo_facturacion", "metodo_limpieza", "metodo_perf0", "metodo_perf_plus"] as const
export const METODOS_VALIDOS = ["Factura", "Final", "Presupuesto"] as const

interface SesionListas {
  puedeCambiarLista: boolean
  listasPermitidas: string[]
}

/**
 * Valida lo que viene en `body` para las 8 columnas. Devuelve el mensaje de error o null.
 * - Lista: solo quien tiene permiso (vendedores.puede_cambiar_lista) y solo las listas
 *   habilitadas para el vendedor (Neco + las de sus viajantes; la Especial nunca).
 * - Método: Factura / Final / Presupuesto, o vacío (= hereda de lo general).
 */
export function validarListasMetodos(body: Record<string, unknown>, session: SesionListas): string | null {
  for (const campo of CAMPOS_LISTA) {
    const v = body[campo]
    if (v === undefined) continue
    if (!session.puedeCambiarLista) return "No tenés permiso para cambiar la lista de precios."
    if (v && (typeof v !== "string" || !session.listasPermitidas.includes(v))) {
      return "Esa lista no está habilitada para vos: se asigna desde el ERP."
    }
  }
  for (const campo of CAMPOS_METODO) {
    const v = body[campo]
    if (v === undefined || v === null || v === "") continue
    if (!(METODOS_VALIDOS as readonly string[]).includes(String(v))) return `Método de facturación inválido: ${String(v)}`
  }
  return null
}

/** Patch de las columnas presentes en `body` ("" → null). */
export function patchListasMetodos(body: Record<string, unknown>, campos: readonly string[] = [...CAMPOS_LISTA, ...CAMPOS_METODO]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const c of campos) {
    if (body[c] === undefined) continue
    const v = typeof body[c] === "string" ? (body[c] as string).trim() : body[c]
    out[c] = v ? String(v) : null
  }
  return out
}
