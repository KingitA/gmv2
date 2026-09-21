// Motor de sync del lado servidor: arma RespuestaSync (snapshot o delta) para
// un dataset. Ver MOBILE.md → "Contratos del motor de sync".
//
// - snapshot: carga el dataset completo; cursor = "s:<hash>". Si el cliente ya
//   tiene ese hash ⇒ sin_cambios (no viaja nada).
// - delta: lee public.mobile_cambios (log alimentado por triggers) desde el
//   cursor "d:<seq>", recarga SOLO las filas afectadas y marca como borradas las
//   que ya no existen o salieron del alcance del usuario. Si el log no existe
//   (migración sin aplicar), el cursor es inválido o hay demasiados cambios,
//   cae a snapshot: el cliente siempre queda consistente.

import { createHash } from "node:crypto"
import type { FilaReplica, RespuestaParcial, RespuestaSync } from "../contrato"
import type { SesionMobile } from "../sesion"

export interface CtxSync {
  request: Request
  /** Cliente con la sesión del usuario (bearer): las cargas respetan su alcance */
  supabase: any
  /** Service role: SOLO para el log de cambios (metadatos, sin datos de negocio) */
  admin: any
  sesion: SesionMobile
}

export interface DatasetDef {
  nombre: string
  /** Roles que pueden leerlo (admin siempre) */
  roles: string[]
  /**
   * Tablas cuyo log de cambios afecta al dataset. mobile_cambios.ref_id debe
   * ser el id de la fila del dataset (el trigger de cada tabla lo configura).
   * Sin tablas ⇒ solo snapshot.
   */
  tablas?: string[]
  /**
   * Tablas cuyo trigger de log llegó en una migración POSTERIOR a la fundación.
   * Si el log no tiene ninguna entrada de estas tablas (migración sin aplicar, o
   * 30 días sin movimiento) no se puede confiar en el delta ⇒ snapshot. Sin esto,
   * un dataset delta sin trigger respondería "sin cambios" para siempre.
   */
  requiereLogDe?: string[]
  /** Carga filas del dataset. ids undefined ⇒ todas las del alcance del usuario. */
  cargar(ctx: CtxSync, ids?: string[]): Promise<FilaReplica[]>
  /**
   * Refresco PARCIAL a pedido del dispositivo (GET …/sync/<ds>?ids=a,b): recarga solo
   * esas filas, sin mover el cursor. Para datasets caros por fila (cuenta corriente
   * de un cliente): al abrir la ficha con señal se re-lee ese cliente y nada más.
   * Las filas pedidas que no vuelven se informan como borradas (salieron del alcance).
   */
  porIds?(ctx: CtxSync, ids: string[]): Promise<FilaReplica[]>
}

/** Máximo de filas por refresco parcial */
export const MAX_IDS_PARCIAL = 25

export async function responderParcial(ctx: CtxSync, def: DatasetDef, ids: string[]): Promise<RespuestaParcial> {
  const pedidos = [...new Set(ids)].slice(0, MAX_IDS_PARCIAL)
  const filas = await def.porIds!(ctx, pedidos)
  const presentes = new Set(filas.map((f) => f.id))
  return { dataset: def.nombre, generado_at: new Date().toISOString(), upserts: filas, deletes: pedidos.filter((id) => !presentes.has(id)) }
}

/** Máximo de cambios a procesar en delta antes de preferir un snapshot */
const MAX_CAMBIOS_DELTA = 4000
/**
 * Re-lectura de seguridad: un seq se reserva al hacer INSERT pero se hace
 * visible al COMMIT, así que un seq menor puede aparecer después de uno mayor.
 * Re-leemos los cambios de los últimos minutos aunque sean < cursor; los
 * upserts son idempotentes, repetir no rompe nada.
 */
const VENTANA_RELECTURA_MS = 3 * 60_000

function hashFilas(filas: FilaReplica[]): string {
  const h = createHash("sha1")
  for (const f of [...filas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) h.update(JSON.stringify(f))
  return h.digest("base64url").slice(0, 27)
}

async function snapshot(ctx: CtxSync, def: DatasetDef, cursorCliente: string | null, seqActual: string | null): Promise<RespuestaSync> {
  const filas = await def.cargar(ctx)
  const hash = hashFilas(filas)
  // Si el dataset admite delta y conocemos el seq, el próximo pedido ya puede ser delta
  const cursor = seqActual !== null && def.tablas?.length ? `d:${seqActual}:${hash}` : `s:${hash}`
  const mismo = !!cursorCliente && cursorCliente.endsWith(hash)
  return {
    dataset: def.nombre,
    modo: "snapshot",
    cursor,
    generado_at: new Date().toISOString(),
    sin_cambios: mismo,
    upserts: mismo ? [] : filas,
    deletes: [],
  }
}

/** Último seq del log, o null si la tabla no existe / no hay permisos. */
export async function seqActual(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from("mobile_cambios")
    .select("seq")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data ? String(data.seq) : "0"
}

export async function responderSync(ctx: CtxSync, def: DatasetDef, cursorCliente: string | null): Promise<RespuestaSync> {
  const admin = ctx.admin
  const seq = def.tablas?.length ? await seqActual(admin) : null

  const m = cursorCliente ? /^d:(\d+):(.*)$/.exec(cursorCliente) : null
  if (!def.tablas?.length || seq === null || !m) return snapshot(ctx, def, cursorCliente, seq)

  if (def.requiereLogDe?.length) {
    const { data: hay, error: errLog } = await admin.from("mobile_cambios").select("seq").in("tabla", def.requiereLogDe).limit(1)
    if (errLog || !hay?.length) return snapshot(ctx, def, cursorCliente, seq)
  }

  const desde = m[1]
  // El log se purga (30 días): si el cursor quedó antes del seq más viejo
  // retenido, faltan cambios ⇒ snapshot.
  const { data: masViejo } = await admin.from("mobile_cambios").select("seq").order("seq", { ascending: true }).limit(1).maybeSingle()
  if (masViejo && BigInt(masViejo.seq) > BigInt(desde) + BigInt(1)) return snapshot(ctx, def, null, seq)

  const { data: cambios, error } = await admin
    .from("mobile_cambios")
    .select("seq, ref_id")
    .in("tabla", def.tablas)
    .or(`seq.gt.${desde},at.gt.${new Date(Date.now() - VENTANA_RELECTURA_MS).toISOString()}`)
    .order("seq", { ascending: true })
    .limit(MAX_CAMBIOS_DELTA + 1)
  if (error || !cambios || cambios.length > MAX_CAMBIOS_DELTA) return snapshot(ctx, def, null, seq)

  const ids = [...new Set<string>(cambios.map((c: any) => String(c.ref_id)).filter(Boolean))]
  const maxSeq = cambios.reduce((mx: bigint, c: any) => (BigInt(c.seq) > mx ? BigInt(c.seq) : mx), BigInt(desde))
  const cursor = `d:${(BigInt(seq) > maxSeq ? BigInt(seq) : maxSeq).toString()}:`
  if (!ids.length) {
    return { dataset: def.nombre, modo: "delta", cursor, generado_at: new Date().toISOString(), sin_cambios: true, upserts: [], deletes: [] }
  }
  const filas = await def.cargar(ctx, ids)
  const presentes = new Set(filas.map((f) => f.id))
  return {
    dataset: def.nombre,
    modo: "delta",
    cursor,
    generado_at: new Date().toISOString(),
    sin_cambios: false,
    upserts: filas,
    deletes: ids.filter((id) => !presentes.has(id)),
  }
}

