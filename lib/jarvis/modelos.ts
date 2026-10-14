/**
 * Modelos de Jarvis — ÚNICO lugar donde se nombran (mismo criterio que
 * lib/ai/gemini-model.ts).
 *
 * Orden de prioridad para elegir el modelo:
 *   1. tabla ai_ajustes (se cambia desde la pantalla, queda en la bitácora)
 *   2. variable de entorno JARVIS_MODELO_PENSADOR / _RAPIDO / _RESPALDO
 *   3. los valores por defecto de abajo
 *
 * Cambiar de modelo NO requiere tocar código. Antes de cambiar el pensador,
 * correr el examen (scripts/jarvis-examen) y comparar la nota.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export type RolModelo = "pensador" | "rapido" | "respaldo"

const POR_DEFECTO: Record<RolModelo, string> = {
  pensador: process.env.JARVIS_MODELO_PENSADOR || "claude-opus-5-5",
  rapido: process.env.JARVIS_MODELO_RAPIDO || "claude-haiku-5-5",
  respaldo: process.env.JARVIS_MODELO_RESPALDO || "claude-sonnet-5-5",
}

const TOPE_POR_DEFECTO_USD = 150

export type Esfuerzo = "low" | "medium" | "high" | "max"
export const ESFUERZOS: Esfuerzo[] = ["low", "medium", "high", "max"]

export interface AjustesJarvis {
  modelos: Record<RolModelo, string>
  topeMensualUsd: number
  /** cuánto piensa Jarvis antes de responder en el chat (más = mejor y más caro/lento) */
  esfuerzoChat: Esfuerzo
}

let cache: { valor: AjustesJarvis; vence: number } | null = null
const CACHE_MS = 60_000

/** Lee los ajustes (con 1 minuto de memoria). Si la tabla no existe todavía, usa los valores por defecto. */
export async function leerAjustes(db: SupabaseClient): Promise<AjustesJarvis> {
  if (cache && cache.vence > Date.now()) return cache.valor

  const valor: AjustesJarvis = { modelos: { ...POR_DEFECTO }, topeMensualUsd: TOPE_POR_DEFECTO_USD, esfuerzoChat: "medium" }
  try {
    const { data, error } = await db.from("ai_ajustes").select("clave, valor")
    if (!error && data) {
      for (const fila of data as { clave: string; valor: unknown }[]) {
        if (fila.clave === "modelo_pensador" && typeof fila.valor === "string") valor.modelos.pensador = fila.valor
        if (fila.clave === "modelo_rapido" && typeof fila.valor === "string") valor.modelos.rapido = fila.valor
        if (fila.clave === "modelo_respaldo" && typeof fila.valor === "string") valor.modelos.respaldo = fila.valor
        if (fila.clave === "tope_mensual_usd" && typeof fila.valor === "number") valor.topeMensualUsd = fila.valor
        if (fila.clave === "esfuerzo_chat" && ESFUERZOS.includes(fila.valor as Esfuerzo)) valor.esfuerzoChat = fila.valor as Esfuerzo
      }
    }
  } catch {
    // tabla todavía no creada: quedan los valores por defecto
  }
  cache = { valor, vence: Date.now() + CACHE_MS }
  return valor
}

/** Para tests / después de guardar un ajuste. */
export function olvidarAjustes() {
  cache = null
}

/**
 * Precio por millón de tokens (USD). Fuente: precios públicos de Anthropic al
 * 06/10/2026. Si aparece un modelo que no está acá, se cobra como el más caro
 * conocido (mejor sobreestimar el gasto que subestimarlo).
 */
const PRECIOS: Record<string, { entrada: number; salida: number }> = {
  "claude-fable-5-1": { entrada: 10, salida: 50 },
  "claude-opus-5-5": { entrada: 4, salida: 20 },
  "claude-opus-5": { entrada: 5, salida: 25 },
  "claude-opus-4-8": { entrada: 5, salida: 25 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10 },
  "claude-sonnet-5": { entrada: 2, salida: 10 },
  "claude-sonnet-4-6": { entrada: 3, salida: 15 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5 },
  "claude-haiku-4-5": { entrada: 1, salida: 5 },
}
const PRECIO_DESCONOCIDO = { entrada: 10, salida: 50 }
/** Búsqueda web: USD 10 cada 1.000 búsquedas. */
const PRECIO_BUSQUEDA_WEB = 0.01

export interface UsoTokens {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number | null } | null
}

export function costoUsd(modelo: string, uso: UsoTokens): number {
  const p = PRECIOS[modelo] ?? PRECIO_DESCONOCIDO
  const porToken = (precio: number) => precio / 1_000_000
  return (
    (uso.input_tokens ?? 0) * porToken(p.entrada) +
    (uso.cache_creation_input_tokens ?? 0) * porToken(p.entrada) * 1.25 +
    (uso.cache_read_input_tokens ?? 0) * porToken(p.entrada) * 0.1 +
    (uso.output_tokens ?? 0) * porToken(p.salida) +
    (uso.server_tool_use?.web_search_requests ?? 0) * PRECIO_BUSQUEDA_WEB
  )
}
