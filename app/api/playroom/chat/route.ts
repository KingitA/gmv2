import { NextRequest, NextResponse } from "next/server"
import type Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { preguntar } from "@/lib/jarvis/cerebro"
import { cargarHistorial, guardarIntercambio } from "@/lib/jarvis/conversaciones"

// Chat de Jarvis (Playroom). Contrato: docs/rediseno-frontend/PEDIDO-agente-cerebro-playroom.md §4.1
// Recibe { mensaje, conversacion_id?, historial? } y devuelve
// { respuesta, bloques, consultado, sugerencias, historial, conversacion_id }.
// Solo lee: ninguna herramienta del chat modifica datos.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error

  let body: { mensaje?: unknown; conversacion_id?: unknown; historial?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const mensaje = typeof body.mensaje === "string" ? body.mensaje.trim() : ""
  if (!mensaje) return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 })
  if (mensaje.length > 4000) return NextResponse.json({ error: "El mensaje es demasiado largo" }, { status: 400 })

  const db = createAdminClient()
  const conversacionId = typeof body.conversacion_id === "string" ? body.conversacion_id : null

  // El historial guardado en la base manda; el que manda la pantalla es el respaldo.
  let historial: Anthropic.MessageParam[] | null = conversacionId ? await cargarHistorial(db, conversacionId, auth.user.id) : null
  if (!historial) historial = Array.isArray(body.historial) ? (body.historial as Anthropic.MessageParam[]) : []

  try {
    const r = await preguntar({ db, usuarioId: auth.user.id, mensaje, historial, conversacionId })
    const id = await guardarIntercambio(db, { conversacionId, usuarioId: auth.user.id, mensaje, desdeIndice: historial.length, r })
    return NextResponse.json({
      respuesta: r.respuesta,
      bloques: r.bloques,
      consultado: r.consultado,
      sugerencias: r.sugerencias,
      historial: r.historial,
      conversacion_id: id,
      aviso: r.aviso,
    })
  } catch (e) {
    console.error("[jarvis] chat", e)
    return NextResponse.json({ error: "Jarvis no pudo responder. Probá de nuevo en un momento." }, { status: 500 })
  }
}
