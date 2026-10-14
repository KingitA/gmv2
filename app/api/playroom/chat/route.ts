import { NextRequest, NextResponse } from "next/server"
import type Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { preguntar } from "@/lib/jarvis/cerebro"
import { cargarHistorial, guardarIntercambio, repasoCorto } from "@/lib/jarvis/conversaciones"

// Chat de Jarvis (Playroom). Contrato: docs/rediseno-frontend/PEDIDO-agente-cerebro-playroom.md §4.1
// Recibe { mensaje, conversacion_id? } y devuelve { respuesta, bloques, consultado, sugerencias, conversacion_id }.
// El historial vive SOLO en la base (ai_conversations/ai_messages) y es de quien preguntó:
// la pantalla no lo manda (no se puede falsificar) y no viaja en cada pregunta.
// Solo lee: las únicas herramientas que escriben son las de la agenda de Jarvis.

/** Charla tan larga que conviene seguir en una nueva (cuesta más y se acerca al límite del modelo). */
const MAX_CHARS_HISTORIAL = 500_000
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error

  let body: { mensaje?: unknown; conversacion_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const mensaje = typeof body.mensaje === "string" ? body.mensaje.trim() : ""
  if (!mensaje) return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 })
  if (mensaje.length > 4000) return NextResponse.json({ error: "El mensaje es demasiado largo" }, { status: 400 })

  const db = createAdminClient()
  let conversacionId = typeof body.conversacion_id === "string" ? body.conversacion_id : null
  let historial: Anthropic.MessageParam[] = []
  let mensajeParaJarvis = mensaje
  let aviso: string | undefined

  if (conversacionId) {
    const cargado = await cargarHistorial(db, conversacionId, auth.user.id)
    if (!cargado) return NextResponse.json({ error: "No encontré esa conversación. Empezá una nueva." , conversacion_nueva: true }, { status: 404 })
    historial = cargado
    if (JSON.stringify(historial).length > MAX_CHARS_HISTORIAL) {
      // Charla muy larga: se sigue en una nueva con un repaso de lo último (en texto, sin razonamientos)
      const repaso = await repasoCorto(db, conversacionId)
      conversacionId = null
      historial = []
      mensajeParaJarvis = `[Venimos de una charla larga. Lo último que se habló:\n${repaso}]\n\n${mensaje}`
      aviso = "La charla venía muy larga: sigo en una nueva (me acuerdo de lo último)."
    }
  }

  try {
    const r = await preguntar({ db, usuarioId: auth.user.id, mensaje: mensajeParaJarvis, historial, conversacionId })
    const id = await guardarIntercambio(db, { conversacionId, usuarioId: auth.user.id, mensaje, desdeIndice: historial.length, r })
    return NextResponse.json({
      respuesta: r.respuesta,
      bloques: r.bloques,
      consultado: r.consultado,
      sugerencias: r.sugerencias,
      conversacion_id: id,
      aviso: [aviso, r.aviso].filter(Boolean).join(" ") || undefined,
    })
  } catch (e) {
    console.error("[jarvis] chat", e)
    return NextResponse.json({ error: "Jarvis no pudo responder. Probá de nuevo en un momento." }, { status: 500 })
  }
}
