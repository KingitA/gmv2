/**
 * Modelos de Claude fuera de Jarvis — ÚNICO lugar donde se nombran (E-82).
 * (Jarvis tiene los suyos en lib/jarvis/modelos.ts, que además se cambian desde la pantalla;
 *  Gemini, en lib/ai/gemini-model.ts.)
 *
 * Quién usa cada uno:
 *   extraccion → clasificar mails y extraer datos (lib/ai/claude.ts), leer Excel de pedidos,
 *                listas de precios y facturas (lib/ai/claude-xlsx-analyzer.ts), identificar el
 *                cliente de un pedido por mail (lib/ai/email-order-processor.ts)
 *   liviano    → pasar a renglones el texto de un pedido (lib/actions/ai-order-import.ts)
 *   vision     → buscar un artículo por foto desde la app del vendedor
 *                (app/api/vendedor/buscar-foto/route.ts)
 *
 * Se cambian sin tocar código con las variables de entorno CLAUDE_MODELO_EXTRACCION,
 * CLAUDE_MODELO_LIVIANO y CLAUDE_MODELO_VISION.
 *
 * Qué hay que saber de estos modelos (18/11/2026) para no romper una llamada:
 *  - Piensan antes de contestar y ese pensamiento CUENTA dentro de max_tokens: un tope
 *    chico (100, 256) puede gastarse entero pensando y la respuesta llega vacía. Por eso
 *    los topes de acá son holgados y el esfuerzo es bajo en las tareas simples.
 *  - La respuesta puede EMPEZAR con un bloque de pensamiento: el texto se lee con
 *    textoDeRespuesta(), nunca con content[0].
 *  - No aceptan temperature / top_p / top_k, ni que el último mensaje sea del asistente
 *    (prefill), ni obligar a usar una herramienta (tool_choice any / tool): devuelven error 400.
 *  - Pueden negarse a contestar (stop_reason "refusal"): hay que mirarlo antes de leer el texto.
 */

export const MODELO_CLAUDE = {
  extraccion: process.env.CLAUDE_MODELO_EXTRACCION || "claude-sonnet-5-5",
  liviano: process.env.CLAUDE_MODELO_LIVIANO || "claude-haiku-5-5",
  vision: process.env.CLAUDE_MODELO_VISION || "claude-opus-5-5",
} as const

/**
 * Esfuerzo para clasificar / extraer / contestar corto: "low" es el punto de partida que
 * recomienda Anthropic para clasificación y extracción (piensa poco o nada en lo simple).
 */
export const ESFUERZO_SIMPLE = "low" as const

/** Tope de respuesta para una contestación CORTA (un id, un resumen): deja lugar para pensar. */
export const TOPE_RESPUESTA_CORTA = 4096

interface RespuestaClaude {
  content: ReadonlyArray<{ type: string; text?: string | null }>
  stop_reason?: string | null
}

/** ¿El modelo se negó a contestar? (no hay texto útil) */
export const seNego = (r: RespuestaClaude): boolean => r.stop_reason === "refusal"

/**
 * Texto de la respuesta: une los bloques de texto y saltea los de pensamiento.
 * Devuelve "" si el modelo se negó o no escribió texto.
 */
export function textoDeRespuesta(r: RespuestaClaude): string {
  if (seNego(r)) return ""
  return r.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
}
