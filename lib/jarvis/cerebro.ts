/**
 * El circuito de una pregunta a Jarvis:
 *   pregunta → la IA pide datos a las herramientas (solo lectura) → arma la
 *   respuesta → llama a "responder" con el texto y qué bloques mostrar.
 *
 * - El modelo sale de ajustes (lib/jarvis/modelos.ts); si el principal falla,
 *   se reintenta con el de respaldo.
 * - Cada llamada a la IA se anota con su costo (ai_uso).
 * - El historial es "solo agregar": nunca se edita lo ya dicho (los modelos
 *   nuevos lo exigen para conservar su razonamiento).
 */
import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Bloque } from "@/lib/playroom/bloques"
import { fecha, hoyISO } from "@/lib/formato"
import { HERRAMIENTAS, buscarHerramienta, ErrorHerramienta, type Contexto } from "./herramientas"
import { INSTRUCCIONES_JARVIS } from "./instrucciones"
import { leerReglas, notasComoTexto } from "./reglas"
import { elegirModelo, registrarUso } from "./uso"
import { costoUsd, type Esfuerzo, type UsoTokens } from "./modelos"

const MAX_VUELTAS = 10
const MAX_CHARS_RESULTADO = 40_000

let cliente: Anthropic | null = null
const anthropic = () => (cliente ??= new Anthropic())

const RESPONDER: Anthropic.Tool = {
  name: "responder",
  description:
    "Entrega la respuesta final al usuario. Llamala SIEMPRE una vez, al final, cuando ya tengas los datos. Es la única forma de responder.",
  input_schema: {
    type: "object",
    properties: {
      respuesta: { type: "string", description: "Texto en Markdown simple (negritas, listas). Sin tablas." },
      mostrar: { type: "array", items: { type: "string" }, description: "Ids de los bloques a mostrar (ej. [\"b2\"]). Normalmente uno; máximo tres. Vacío si no hace falta." },
      seguir: { type: "string", description: "Vacío salvo que encontraste algo concreto en estos datos que cambia lo que el usuario está viendo. Una pregunta corta." },
    },
    required: ["respuesta", "mostrar"],
  },
}

const HERRAMIENTAS_API: Anthropic.ToolUnion[] = [
  ...HERRAMIENTAS.map((h): Anthropic.Tool => ({ name: h.nombre, description: h.descripcion, input_schema: h.esquema })),
  { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
  RESPONDER,
]

export interface PreguntaJarvis {
  db: SupabaseClient
  /** null = proceso automático (examen, vigías) */
  usuarioId: string | null
  mensaje: string
  historial: Anthropic.MessageParam[]
  conversacionId?: string | null
  /** para el examen: probar un modelo sin cambiar los ajustes */
  modeloForzado?: string
  esfuerzoForzado?: Esfuerzo
  origen?: string
}

export interface RespuestaJarvis {
  respuesta: string
  bloques: Bloque[]
  consultado: string[]
  sugerencias: string[]
  historial: Anthropic.MessageParam[]
  modelo: string
  costoUsd: number
  aviso?: string
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

function esErrorDeModelo(e: unknown) {
  return e instanceof Anthropic.NotFoundError || e instanceof Anthropic.InternalServerError ||
    (e instanceof Anthropic.APIError && (e.status === 529 || e.status === 503))
}

async function llamar(modelo: string, messages: Anthropic.MessageParam[], notas: string, esfuerzo: Esfuerzo) {
  // Instrucciones fijas + notas del negocio (cambian poco): las dos van a memoria rápida (cache)
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: INSTRUCCIONES_JARVIS, cache_control: { type: "ephemeral" } }]
  if (notas) system.push({ type: "text", text: notas, cache_control: { type: "ephemeral" } })
  const stream = anthropic().messages.stream({
    model: modelo,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: esfuerzo },
    system,
    tools: HERRAMIENTAS_API,
    messages,
  })
  return stream.finalMessage()
}

/** Marca el último bloque del historial para que la IA lo reutilice en la próxima vuelta (más barato). */
function conCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (!messages.length) return messages
  const ultimo = messages[messages.length - 1]
  if (typeof ultimo.content === "string" || !ultimo.content.length) return messages
  const contenido = ultimo.content.map((b, i) =>
    i === ultimo.content.length - 1 && (b.type === "text" || b.type === "tool_result") ? { ...b, cache_control: { type: "ephemeral" as const } } : b,
  )
  return [...messages.slice(0, -1), { ...ultimo, content: contenido as typeof ultimo.content }]
}

export async function preguntar(q: PreguntaJarvis): Promise<RespuestaJarvis> {
  const hoy = hoyISO()
  const ctx: Contexto = { db: q.db, hoy, usuarioId: q.origen === "examen" ? null : q.usuarioId, conversacionId: q.conversacionId }
  const { notas } = await leerReglas(q.db)
  const notasTexto = notasComoTexto(notas)
  const elegido = await elegirModelo(q.db, "pensador")
  let modelo = q.modeloForzado ?? elegido.modelo
  // si se pasó el tope y bajó al modelo rápido, también baja el esfuerzo
  const esfuerzo: Esfuerzo = q.esfuerzoForzado ?? (elegido.porTope ? "low" : elegido.esfuerzoChat)

  const messages: Anthropic.MessageParam[] = [
    ...q.historial,
    { role: "user", content: `[Hoy: ${DIAS[new Date(hoy + "T12:00:00Z").getUTCDay()]} ${fecha(hoy)}]\n${q.mensaje}` },
  ]

  const bloques = new Map<string, Bloque>()
  const consultado: string[] = []
  let costo = 0
  let final: { respuesta: string; mostrar: string[]; seguir?: string } | null = null

  for (let vuelta = 0; vuelta < MAX_VUELTAS && !final; vuelta++) {
    let resp: Anthropic.Message
    try {
      resp = await llamar(modelo, conCache(messages), notasTexto, esfuerzo)
    } catch (e) {
      if (!esErrorDeModelo(e) || modelo === elegido.respaldo) throw e
      console.error(`[jarvis] ${modelo} falló, sigo con ${elegido.respaldo}`, e)
      modelo = elegido.respaldo
      resp = await llamar(modelo, conCache(messages), notasTexto, esfuerzo)
    }
    // El examen no escribe en la base (se corre desde una PC contra producción): solo suma el costo.
    costo += q.origen === "examen"
      ? costoUsd(modelo, resp.usage as UsoTokens)
      : await registrarUso(q.db, { usuarioId: q.usuarioId, origen: q.origen ?? "chat", conversacionId: q.conversacionId, modelo, uso: resp.usage as UsoTokens })
    messages.push({ role: "assistant", content: resp.content })

    for (const b of resp.content) {
      if (b.type === "server_tool_use" && b.name === "web_search") {
        const consulta = (b.input as { query?: string })?.query
        if (consulta) consultado.push(`Internet: "${consulta}"`)
      }
    }

    if (resp.stop_reason === "refusal") {
      final = { respuesta: "Eso no lo puedo responder.", mostrar: [] }
      break
    }
    if (resp.stop_reason === "pause_turn") continue // la búsqueda web pidió seguir

    const usos = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    if (!usos.length) {
      // respondió sin "responder": se toma el texto tal cual
      const texto = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim()
      final = { respuesta: texto || "No tengo una respuesta para eso.", mostrar: [...bloques.keys()].slice(0, 2) }
      break
    }

    const resultados: Anthropic.ToolResultBlockParam[] = await Promise.all(
      usos.map(async (u): Promise<Anthropic.ToolResultBlockParam> => {
        if (u.name === "responder") {
          const inp = (u.input ?? {}) as { respuesta?: unknown; mostrar?: unknown; seguir?: unknown }
          final = {
            respuesta: String(inp.respuesta ?? ""),
            mostrar: Array.isArray(inp.mostrar) ? inp.mostrar.map(String) : [],
            seguir: typeof inp.seguir === "string" ? inp.seguir.trim() : undefined,
          }
          return { type: "tool_result", tool_use_id: u.id, content: "Entregado." }
        }
        const h = buscarHerramienta(u.name)
        if (!h) return { type: "tool_result", tool_use_id: u.id, content: `No existe la herramienta ${u.name}.`, is_error: true }
        try {
          const r = await h.ejecutar(ctx, (u.input ?? {}) as Record<string, unknown>)
          consultado.push(r.consultado)
          const ids = r.bloques.map((bl) => {
            const id = `b${bloques.size + 1}`
            bloques.set(id, bl)
            return { id, titulo: bl.titulo, tipo: bl.tipo }
          })
          let texto = JSON.stringify({ bloques_disponibles: ids, datos: r.datos })
          if (texto.length > MAX_CHARS_RESULTADO) texto = texto.slice(0, MAX_CHARS_RESULTADO) + "…(recortado)"
          return { type: "tool_result", tool_use_id: u.id, content: texto }
        } catch (e) {
          const msg = e instanceof ErrorHerramienta ? e.message : "La consulta falló. Avisale al usuario que ese dato no se pudo leer."
          if (!(e instanceof ErrorHerramienta)) console.error(`[jarvis] herramienta ${u.name}`, e)
          return { type: "tool_result", tool_use_id: u.id, content: msg, is_error: true }
        }
      }),
    )
    // Siempre se devuelven los resultados (también el de "responder"), así el historial queda válido para la próxima pregunta.
    messages.push({ role: "user", content: resultados })
  }

  if (!final) final = { respuesta: "Me llevó demasiados pasos y corté. ¿Lo podés acotar un poco?", mostrar: [] }

  const elegidos = final.mostrar.map((id) => bloques.get(id)).filter((b): b is Bloque => !!b).slice(0, 3)
  return {
    respuesta: final.respuesta,
    bloques: elegidos,
    consultado: [...new Set(consultado)],
    sugerencias: final.seguir ? [final.seguir] : [],
    historial: messages,
    modelo,
    costoUsd: costo,
    aviso: elegido.porTope ? `Se pasó el tope de gasto del mes (USD ${elegido.topeMes}); estoy usando el modelo económico.` : undefined,
  }
}
