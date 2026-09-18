import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMobile } from "@/lib/mobile/sesion"
import { HANDLERS, puedeEjecutar, RechazoNegocio } from "@/lib/mobile/outbox/handlers"
import { completar, hashPayload, liberar, reservar } from "@/lib/mobile/outbox/idempotencia"
import type { MutacionOutbox, ResultadoOutbox } from "@/lib/mobile/contrato"

// POST /api/mobile/outbox — aplica UNA mutación encolada en el dispositivo.
//   200 { estado: "aplicado" | "duplicado" }     → el dispositivo la marca enviada
//   422 { estado: "rechazado", error }           → rechazo definitivo (no reintentar)
//   409 reintentable=false                       → misma clave, otro payload (bug)
//   409 reintentable=true / 5xx / red            → reintentar con backoff
export const dynamic = "force-dynamic"
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const sesion = await requireMobile(request)
  if (sesion.error) return sesion.error

  const m = (await request.json().catch(() => null)) as MutacionOutbox | null
  if (!m || !UUID.test(m.idempotency_key || "") || typeof m.tipo !== "string") {
    return NextResponse.json({ estado: "rechazado", error: "Mutación mal formada." }, { status: 422 })
  }
  const h = HANDLERS.get(m.tipo)
  if (!h) return NextResponse.json({ estado: "rechazado", error: `Operación desconocida: ${m.tipo}` }, { status: 422 })
  if (!puedeEjecutar(h, sesion.roles)) {
    return NextResponse.json({ estado: "rechazado", error: "Tu usuario no puede realizar esta operación." }, { status: 422 })
  }
  const invalida = h.validar?.(m.payload)
  if (invalida) return NextResponse.json({ estado: "rechazado", error: invalida }, { status: 422 })
  const capturado = m.capturado_at && !isNaN(Date.parse(m.capturado_at)) ? m.capturado_at : null

  const admin = createAdminClient()
  let reserva
  try {
    reserva = await reservar(admin, {
      key: m.idempotency_key,
      userId: sesion.user.id,
      tipo: m.tipo,
      hash: hashPayload(m.tipo, m.payload),
      deviceId: sesion.deviceId,
      capturadoAt: capturado,
    })
  } catch (e: any) {
    console.error("[mobile/outbox] reservar:", e)
    return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 })
  }

  if (reserva.tipo === "duplicado") {
    const body: ResultadoOutbox =
      reserva.estado === "rechazado"
        ? { estado: "rechazado", error: String((reserva.resultado as any)?.error || "Rechazada") }
        : { estado: "duplicado", resultado: reserva.resultado }
    return NextResponse.json(body, { status: reserva.estado === "rechazado" ? 422 : 200 })
  }
  if (reserva.tipo === "conflicto") {
    return NextResponse.json({ error: reserva.motivo, reintentable: reserva.reintentable }, { status: 409 })
  }

  try {
    const resultado = await h.aplicar(
      { request, supabase: await createClient(), admin, sesion },
      { ...m, capturado_at: capturado || new Date().toISOString(), device_id: sesion.deviceId || m.device_id },
    )
    await completar(admin, m.idempotency_key, "aplicado", resultado ?? null)
    return NextResponse.json({ estado: "aplicado", resultado } satisfies ResultadoOutbox)
  } catch (e: any) {
    if (e instanceof RechazoNegocio) {
      await completar(admin, m.idempotency_key, "rechazado", { error: e.message, codigo: e.codigo }).catch(() => {})
      return NextResponse.json({ estado: "rechazado", error: e.message, codigo: e.codigo } satisfies ResultadoOutbox, { status: 422 })
    }
    console.error(`[mobile/outbox] ${m.tipo}:`, e)
    await liberar(admin, m.idempotency_key).catch(() => {})
    return NextResponse.json({ error: "Error transitorio, se reintentará." }, { status: 503 })
  }
}
