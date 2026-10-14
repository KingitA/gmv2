/**
 * Agenda de Jarvis: propuestas para decidir y recordatorios.
 * Vive en ai_agenda_events (la bandeja de Jarvis). Cada alta y cada decisión
 * queda en la bitácora inborrable por trigger (QUIÉN, CUÁNDO, POR QUÉ).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { hoyISO, sumarDiasISO } from "@/lib/formato"
import { buscarAccion } from "./acciones"
import { puedeConfirmar } from "./acceso"

export class ErrorAgenda extends Error {
  constructor(msg: string, public status = 422) { super(msg) }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export interface NuevoRecordatorio {
  titulo: string
  detalle?: string | null
  fecha: string
  usuarioId: string | null
  conversacionId?: string | null
  entidad?: { tipo: string; id: string } | null
  origenId?: string | null
}

export async function crearRecordatorio(db: SupabaseClient, r: NuevoRecordatorio) {
  if (!r.titulo.trim()) throw new ErrorAgenda("Falta qué hay que recordar.")
  if (!ISO.test(r.fecha)) throw new ErrorAgenda("La fecha tiene que ser AAAA-MM-DD.")
  if (r.fecha < hoyISO()) throw new ErrorAgenda("La fecha ya pasó.")
  const { data, error } = await db.from("ai_agenda_events").insert({
    event_type: "recordatorio", source: r.conversacionId ? "chat" : "sistema", status: "pendiente", priority: "media",
    title: r.titulo.trim().slice(0, 200), description: r.detalle ?? null, due_date: r.fecha,
    creado_por: r.usuarioId, conversacion_id: r.conversacionId ?? null, origen_id: r.origenId ?? null,
    related_entity_type: r.entidad?.tipo ?? null, related_entity_id: r.entidad?.id ?? null,
  }).select("id").single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export interface NuevaPropuesta {
  titulo: string
  detalle?: string | null
  accion: { tipo: string; parametros?: Record<string, unknown>; descripcion?: string }
  impactoEstimado?: number | null
  tono?: "alerta" | "atencion" | "oportunidad"
  /** null = la propuso Jarvis solo */
  usuarioId: string | null
  conversacionId?: string | null
  entidad?: { tipo: string; id: string } | null
  origenId?: string | null
  clave?: string | null
}

export async function crearPropuesta(db: SupabaseClient, p: NuevaPropuesta) {
  const accion = buscarAccion(p.accion.tipo)
  if (accion.tipo !== p.accion.tipo) throw new ErrorAgenda(`No existe la acción "${p.accion.tipo}".`)
  // misma propuesta ya pendiente → no se duplica
  if (p.clave) {
    const { data: ya } = await db.from("ai_agenda_events").select("id").eq("clave", p.clave).eq("event_type", "propuesta").eq("status", "pendiente").maybeSingle()
    if (ya) return (ya as { id: string }).id
  }
  const { data, error } = await db.from("ai_agenda_events").insert({
    event_type: "propuesta", source: p.conversacionId ? "chat" : "jarvis", status: "pendiente",
    priority: p.tono === "alerta" ? "alta" : "media", tono: p.tono ?? "atencion",
    title: p.titulo.trim().slice(0, 200), description: p.detalle ?? null, due_date: hoyISO(),
    accion: { tipo: accion.tipo, parametros: p.accion.parametros ?? {}, descripcion: p.accion.descripcion ?? accion.descripcion },
    impacto_estimado: p.impactoEstimado ?? null, clave: p.clave ?? null,
    creado_por: p.usuarioId, conversacion_id: p.conversacionId ?? null, origen_id: p.origenId ?? null,
    related_entity_type: p.entidad?.tipo ?? null, related_entity_id: p.entidad?.id ?? null,
  }).select("id").single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export interface Decision {
  id: string
  usuarioId: string
  roles: string[]
  decision: "si" | "no" | "posponer"
  nota?: string | null
  /** para posponer */
  fecha?: string | null
}

/** Una persona decide. Devuelve qué pasó (y, si corresponde, adónde ir a terminar). */
export async function decidir(db: SupabaseClient, d: Decision) {
  const { data, error } = await db.from("ai_agenda_events").select("id, event_type, status, priority, title, accion, due_date")
    .eq("id", d.id).maybeSingle()
  if (error) throw new Error(error.message)
  const item = data as { id: string; event_type: string; status: string; priority: string; title: string; accion: { tipo?: string; parametros?: Record<string, unknown> } | null; due_date: string | null } | null
  if (!item || !["propuesta", "recordatorio"].includes(item.event_type)) throw new ErrorAgenda("No encontré eso en la agenda.", 404)
  if (item.status !== "pendiente") throw new ErrorAgenda("Eso ya se decidió.", 409)

  const accion = buscarAccion(item.accion?.tipo)
  if (!puedeConfirmar(d.roles, accion.mueveDinero)) throw new ErrorAgenda("Las decisiones que mueven plata las confirma solo un admin.", 403)
  const nota = d.nota?.trim() ? d.nota.trim().slice(0, 1000) : null
  if (d.decision === "no" && ["alta", "urgente"].includes(item.priority) && !nota) throw new ErrorAgenda("Es un tema urgente: anotá por qué no (una línea alcanza).")

  const ahora = new Date().toISOString()
  const base = { decision: d.decision, decidido_por: d.usuarioId, decidido_at: ahora, decision_nota: nota, updated_at: ahora }

  if (d.decision === "posponer") {
    const fecha = d.fecha && ISO.test(d.fecha) ? d.fecha : sumarDiasISO(hoyISO(), 1)
    if (fecha <= hoyISO()) throw new ErrorAgenda("Elegí una fecha a partir de mañana.")
    await actualizar(db, item.id, { ...base, due_date: fecha })
    return { estado: "pospuesto", fecha }
  }
  if (d.decision === "no") {
    await actualizar(db, item.id, { ...base, status: "cancelada", cerrado_por: d.usuarioId, cerrado_at: ahora, cierre_nota: nota ?? "Decidió que no" })
    return { estado: "rechazado" }
  }

  // Sí: primero se anota la decisión (si no se puede anotar, no se ejecuta nada)
  await actualizar(db, item.id, { ...base, status: "en_progreso" })
  let resultado
  try {
    resultado = item.event_type === "recordatorio"
      ? { estado: "no_aplica" as const, detalle: "Hecho." }
      : await accion.ejecutar(db, item.accion?.parametros ?? {}, d.usuarioId)
  } catch (e) {
    resultado = { estado: "error" as const, detalle: e instanceof Error ? e.message : String(e) }
  }
  const terminado = resultado.estado !== "error"
  await actualizar(db, item.id, {
    ejecucion: { ...resultado, at: new Date().toISOString() },
    status: terminado ? "completada" : "pendiente", // si falló, vuelve a la agenda
    ...(terminado ? { cerrado_por: d.usuarioId, cerrado_at: new Date().toISOString(), cierre_nota: resultado.detalle } : {}),
    updated_at: new Date().toISOString(),
  })
  return { estado: terminado ? "hecho" : "error", detalle: resultado.detalle, abrir: "abrir" in resultado ? resultado.abrir : undefined }
}

async function actualizar(db: SupabaseClient, id: string, cambios: Record<string, unknown>) {
  const { error } = await db.from("ai_agenda_events").update(cambios).eq("id", id)
  if (error) throw new Error(`No se pudo anotar la decisión: ${error.message}`)
}

export interface ItemAgenda {
  id: string; tipo: "propuesta" | "recordatorio"; tono: string | null; titulo: string; detalle: string | null
  fecha: string | null; accion: { tipo?: string; descripcion?: string } | null; impacto_estimado: number | null
  creado_por: string | null; creado_por_nombre: string; creado_at: string
  pospuesto_por_nombre?: string | null; vencido: boolean; mueve_dinero: boolean
}

/** Lo pendiente de la agenda: propuestas y recordatorios (vencidos, de hoy y de los próximos 7 días). */
export async function agendaPendiente(db: SupabaseClient): Promise<ItemAgenda[]> {
  const hasta = sumarDiasISO(hoyISO(), 7)
  const { data, error } = await db.from("ai_agenda_events")
    .select("id, event_type, tono, title, description, due_date, accion, impacto_estimado, creado_por, created_at, decision, decidido_por")
    .in("event_type", ["propuesta", "recordatorio"]).eq("status", "pendiente")
    .or(`due_date.is.null,due_date.lte.${hasta}`)
    .order("due_date", { ascending: true, nullsFirst: true }).limit(100)
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as any[]
  const nombres = await nombresDeUsuarios(db, filas.flatMap((f) => [f.creado_por, f.decidido_por]))
  const hoy = hoyISO()
  return filas.map((f) => ({
    id: f.id, tipo: f.event_type, tono: f.tono, titulo: f.title, detalle: f.description, fecha: f.due_date,
    accion: f.accion, impacto_estimado: f.impacto_estimado == null ? null : Number(f.impacto_estimado),
    creado_por: f.creado_por, creado_por_nombre: f.creado_por ? nombres.get(f.creado_por) ?? "alguien" : "Jarvis", creado_at: f.created_at,
    pospuesto_por_nombre: f.decision === "posponer" && f.decidido_por ? nombres.get(f.decidido_por) ?? null : null,
    vencido: !!f.due_date && f.due_date < hoy,
    mueve_dinero: buscarAccion(f.accion?.tipo).mueveDinero,
  }))
}

export async function nombresDeUsuarios(db: SupabaseClient, ids: (string | null | undefined)[]) {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))]
  if (!unicos.length) return new Map<string, string>()
  const { data } = await db.from("usuarios").select("id, nombre, email").in("id", unicos)
  return new Map(((data ?? []) as { id: string; nombre: string | null; email: string | null }[]).map((u) => [u.id, u.nombre || u.email || "alguien"]))
}

const ACCIONES_HISTORIAL = ["decision_si", "decision_no", "decision_posponer", "ejecucion_ok", "ejecucion_error", "ejecucion_no_aplica",
  "propuesta_creado", "recordatorio_creado", "agenda_cancelada", "ajuste_modificado", "ajuste_creado"]

/** Historial de decisiones (de la bitácora inborrable), con nombres. */
export async function historialDecisiones(db: SupabaseClient, f: { texto?: string | null; entidadId?: string | null; desde?: string | null; limite?: number }) {
  let q = db.from("ai_registro").select("id, created_at, usuario_id, accion, entidad_tipo, entidad_id, detalle")
    .in("accion", ACCIONES_HISTORIAL).order("created_at", { ascending: false }).limit(Math.min(f.limite ?? 50, 200))
  if (f.desde && ISO.test(f.desde)) q = q.gte("created_at", `${f.desde}T00:00:00-03:00`)
  if (f.entidadId) q = q.or(`entidad_id.eq.${f.entidadId},detalle->entidad->>id.eq.${f.entidadId}`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  let filas = (data ?? []) as { id: number; created_at: string; usuario_id: string | null; accion: string; entidad_tipo: string | null; entidad_id: string | null; detalle: Record<string, any> }[]
  if (f.texto) {
    const t = f.texto.toLowerCase()
    filas = filas.filter((x) => JSON.stringify(x.detalle).toLowerCase().includes(t))
  }
  const nombres = await nombresDeUsuarios(db, filas.map((x) => x.usuario_id))
  return filas.map((x) => ({
    cuando: x.created_at, quien: x.usuario_id ? nombres.get(x.usuario_id) ?? "alguien" : "Jarvis (automático)",
    que: describirAccion(x.accion), sobre: x.detalle?.titulo ?? x.entidad_id ?? "", nota: x.detalle?.nota ?? x.detalle?.ejecucion?.detalle ?? null,
    detalle: x.detalle,
  }))
}

function describirAccion(a: string) {
  const m: Record<string, string> = {
    decision_si: "Dijo que sí", decision_no: "Dijo que no", decision_posponer: "Lo pospuso",
    ejecucion_ok: "El sistema lo hizo", ejecucion_error: "Falló al hacerlo", ejecucion_no_aplica: "Quedó anotado",
    propuesta_creado: "Propuesta nueva", recordatorio_creado: "Recordatorio nuevo", agenda_cancelada: "Descartó un aviso",
    ajuste_modificado: "Cambió un ajuste", ajuste_creado: "Creó un ajuste",
  }
  return m[a] ?? a
}
