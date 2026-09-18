// Contrato HTTP entre las apps móviles (mobile/packages/core) y el ERP.
// Tipos puros: los importan ambos lados. Cambiar un campo acá es un cambio de
// protocolo — versionarlo en MOBILE.md → "Contratos del motor de sync".

export const MOBILE_PROTOCOLO = 1

export type AppMovil = "vendedor" | "chofer" | "deposito"

/** Roles que habilitan cada app (admin entra a todas). */
export const ROLES_APP: Record<AppMovil, string[]> = {
  vendedor: ["vendedor", "admin"],
  chofer: ["chofer", "admin"],
  deposito: ["deposito", "admin"],
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface SesionMovil {
  access_token: string
  refresh_token: string
  /** epoch segundos */
  expires_at: number
  /** nombre: tabla usuarios (lo muestran las apps; opcional por compatibilidad) */
  user: { id: string; email: string | null; nombre?: string | null }
  roles: string[]
}

// ─── Sync (lecturas) ─────────────────────────────────────────────────────────

export interface FilaReplica {
  id: string
  [k: string]: unknown
}

export interface RespuestaSync {
  dataset: string
  /** snapshot = reemplazar todo el dataset; delta = aplicar upserts/deletes */
  modo: "snapshot" | "delta"
  /** Opaco para el cliente: lo devuelve tal cual en el próximo pedido */
  cursor: string
  /** Hora del servidor (ISO) en que se generó: base del indicador de frescura */
  generado_at: string
  /** true si no cambió nada desde `cursor` (upserts/deletes vacíos) */
  sin_cambios: boolean
  upserts: FilaReplica[]
  deletes: string[]
}

export interface EstadoSync {
  server_time: string
  /** Último seq del log de cambios (null si el log no existe todavía) */
  cambios_seq: string | null
  protocolo: number
}

// ─── Outbox (escrituras) ────────────────────────────────────────────────────

export interface MutacionOutbox<P = unknown> {
  /** UUID v4 generado en el dispositivo; misma clave ⇒ misma operación */
  idempotency_key: string
  tipo: string
  payload: P
  /** ISO, reloj del dispositivo al capturar (ej. precios vigentes a esa hora) */
  capturado_at: string
  device_id: string
  app: AppMovil
  app_version: string
}

export type ResultadoOutbox =
  | { estado: "aplicado"; resultado: unknown }
  /** La clave ya se había procesado: devuelve el resultado original */
  | { estado: "duplicado"; resultado: unknown }
  /** Regla de negocio: no se va a aplicar nunca; el usuario tiene que ver el motivo */
  | { estado: "rechazado"; error: string; codigo?: string }
