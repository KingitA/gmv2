// Registro de mutaciones que aceptan las apps vía outbox (POST /api/mobile/outbox).
//
// Contrato de un handler (ver MOBILE.md → "Outbox" y "Políticas de conflicto"):
// - Recibe la mutación ya autenticada y con la idempotencia reservada.
// - Devuelve { estado: "aplicado", resultado } o lanza RechazoNegocio para un
//   rechazo definitivo (el dispositivo lo muestra y NO reintenta).
// - Cualquier otra excepción = transitoria ⇒ 503 y el dispositivo reintenta.
// - DEBE ser idempotente por sí mismo (segunda línea de defensa): guardar la
//   idempotency_key en la fila de negocio con índice UNIQUE y, ante 23505,
//   devolver la fila existente. Así un crash entre "aplicar" y "completar la
//   reserva" no duplica nada.

import type { MutacionOutbox } from "../contrato"
import type { SesionMobile } from "../sesion"

export class RechazoNegocio extends Error {
  constructor(message: string, public codigo?: string) {
    super(message)
  }
}

export interface CtxOutbox {
  request: Request
  supabase: any
  admin: any
  sesion: SesionMobile
}

export interface HandlerDef<P = any> {
  tipo: string
  /** Roles que pueden ejecutarla (admin siempre) */
  roles: string[]
  /** Validación de forma; devolver string = rechazo definitivo */
  validar?(payload: P): string | null
  aplicar(ctx: CtxOutbox, m: MutacionOutbox<P>): Promise<unknown>
}

// ─── Mutación de prueba de la fundación ──────────────────────────────────────
// Escritura inocua que usa el APK esqueleto para probar el circuito offline
// completo (encolar → reintentar → aplicar una sola vez). Tabla mobile_pruebas_sync.

const pruebaRegistrar: HandlerDef<{ texto: string }> = {
  tipo: "prueba.registrar",
  roles: ["chofer", "vendedor", "deposito"],
  validar: (p) => (typeof p?.texto === "string" && p.texto.trim().length > 0 && p.texto.length <= 500 ? null : "Texto inválido"),
  async aplicar(ctx, m) {
    const fila = {
      idempotency_key: m.idempotency_key,
      usuario_id: ctx.sesion.user.id,
      device_id: m.device_id,
      app: m.app,
      texto: m.payload.texto.trim(),
      capturado_at: m.capturado_at,
    }
    const { data, error } = await ctx.admin.from("mobile_pruebas_sync").insert(fila).select("id, recibido_at").single()
    if (error?.code === "23505") {
      const { data: prev } = await ctx.admin
        .from("mobile_pruebas_sync")
        .select("id, recibido_at")
        .eq("idempotency_key", m.idempotency_key)
        .single()
      return prev
    }
    if (error) throw error
    return data
  },
}

const REGISTRO: HandlerDef[] = [pruebaRegistrar]

export const HANDLERS = new Map(REGISTRO.map((h) => [h.tipo, h]))

export function puedeEjecutar(h: HandlerDef, roles: string[]) {
  return roles.includes("admin") || h.roles.some((r) => roles.includes(r))
}
