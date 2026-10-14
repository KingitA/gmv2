import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { buscarHerramienta, contextoNuevo, ErrorHerramienta, HERRAMIENTAS_QUE_ESCRIBEN } from "@/lib/jarvis/herramientas"

// Recalcular una tarjeta fijada desde el chat: corre la misma herramienta con los
// mismos parámetros y devuelve UN bloque con los datos de hoy. Sin IA: solo la consulta.
// Contrato: docs/rediseno-frontend/PEDIDO-agente-cerebro-playroom.md §4.3
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error

  let body: { herramienta?: unknown; parametros?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const h = typeof body.herramienta === "string" ? buscarHerramienta(body.herramienta) : undefined
  if (!h || HERRAMIENTAS_QUE_ESCRIBEN.has(h.nombre)) return NextResponse.json({ error: "Este dato ya no se puede actualizar." }, { status: 404 })

  const parametros = (body.parametros && typeof body.parametros === "object" ? body.parametros : {}) as Record<string, unknown>
  const indice = Number(parametros._bloque) || 0
  try {
    const r = await h.ejecutar(contextoNuevo(createAdminClient()), parametros)
    const bloque = r.bloques[indice] ?? r.bloques[0]
    if (!bloque) return NextResponse.json({ error: "Sin datos." }, { status: 404 })
    return NextResponse.json(bloque)
  } catch (e) {
    if (e instanceof ErrorHerramienta) return NextResponse.json({ error: e.message }, { status: 422 })
    console.error("[jarvis] recalcular", h.nombre, e)
    return NextResponse.json({ error: "No se pudo actualizar." }, { status: 500 })
  }
}
