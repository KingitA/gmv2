/**
 * CALENDARIO LABORAL — qué días se trabaja.
 *
 * - Se trabaja de lunes a viernes (decisión de Juan, 15/10/2026).
 * - Feriados: los trae Jarvis de la fuente oficial (api.argentinadatos.com).
 *   Nunca se asume que un feriado NO se trabaja: queda "sin decidir" hasta que
 *   una persona elige Trabajamos / No trabajamos. Se puede cambiar después
 *   (ej. un feriado que se está debatiendo). Cada cambio queda en la bitácora.
 * - Cualquier día se puede marcar como "no trabajamos" (empresa) o un sábado
 *   como "trabajamos".
 * - Ausencias (vacaciones, licencias) del personal: personal_ausencias.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { sumarDiasISO } from "@/lib/formato"

export interface DiaEspecial {
  fecha: string
  nombre: string
  tipo: "feriado" | "puente" | "local" | "empresa"
  origen: "api" | "persona"
  en_fuente: boolean
  trabajamos: boolean | null
  decidido_por: string | null
  decidido_por_nombre?: string | null
  decidido_at: string | null
  nota: string | null
}

export interface Ausencia {
  id: string
  usuario_id: string
  nombre: string
  roles: string[]
  desde: string
  hasta: string
  tipo: "vacaciones" | "licencia" | "otro"
  nota: string | null
}

/** 0 = domingo … 6 = sábado (la fecha es un día calendario, sin hora). */
export function diaSemana(iso: string): number {
  return new Date(iso + "T12:00:00Z").getUTCDay() // formato-ok: día de la semana de una fecha (cálculo)
}

/** ¿Se trabaja ese día? true / false / null (feriado sin decidir). */
export function esHabil(fecha: string, especiales: Map<string, DiaEspecial>): boolean | null {
  const e = especiales.get(fecha)
  if (e && e.trabajamos !== null) return e.trabajamos
  const finDeSemana = [0, 6].includes(diaSemana(fecha))
  if (finDeSemana) return false
  if (e && e.tipo !== "empresa" && e.en_fuente) return null // feriado que nadie decidió todavía
  return true
}

export async function diasEspeciales(db: SupabaseClient, desde: string, hasta: string): Promise<DiaEspecial[]> {
  const { data, error } = await db.from("calendario_dias")
    .select("fecha, nombre, tipo, origen, en_fuente, trabajamos, decidido_por, decidido_at, nota")
    .gte("fecha", desde).lte("fecha", hasta).order("fecha")
  if (error) {
    if (["42P01", "42501", "PGRST205"].includes(error.code)) { console.error("[calendario] días especiales:", error.message); return [] } // sin tabla (migración) o sin permiso
    throw error
  }
  const filas = (data ?? []) as DiaEspecial[]
  const ids = [...new Set(filas.map((f) => f.decidido_por).filter((x): x is string => !!x))]
  if (ids.length) {
    const { data: us } = await db.from("usuarios").select("id, nombre, email").in("id", ids)
    const nom = new Map(((us ?? []) as { id: string; nombre: string | null; email: string | null }[]).map((u) => [u.id, u.nombre || u.email || "alguien"]))
    for (const f of filas) f.decidido_por_nombre = f.decidido_por ? nom.get(f.decidido_por) ?? null : null
  }
  return filas.map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10) }))
}

export async function ausenciasEntre(db: SupabaseClient, desde: string, hasta: string): Promise<Ausencia[]> {
  const { data, error } = await db.from("personal_ausencias")
    .select("id, usuario_id, desde, hasta, tipo, nota")
    .is("anulado_at", null).lte("desde", hasta).gte("hasta", desde).order("desde")
  if (error) {
    if (["42P01", "42501", "PGRST205"].includes(error.code)) { console.error("[calendario] ausencias:", error.message); return [] }
    throw error
  }
  const filas = (data ?? []) as Omit<Ausencia, "nombre" | "roles">[]
  const ids = [...new Set(filas.map((f) => f.usuario_id))]
  const [{ data: us }, { data: rs }] = ids.length
    ? await Promise.all([
        db.from("usuarios").select("id, nombre, email").in("id", ids),
        db.from("usuarios_roles").select("usuario_id, roles(nombre)").in("usuario_id", ids),
      ])
    : [{ data: [] }, { data: [] }]
  const nom = new Map(((us ?? []) as { id: string; nombre: string | null; email: string | null }[]).map((u) => [u.id, u.nombre || u.email || "?"]))
  const roles = new Map<string, string[]>()
  for (const r of (rs ?? []) as unknown as { usuario_id: string; roles: { nombre: string } | null }[]) {
    if (!r.roles?.nombre) continue
    roles.set(r.usuario_id, [...(roles.get(r.usuario_id) ?? []), r.roles.nombre])
  }
  return filas.map((f) => ({ ...f, desde: String(f.desde).slice(0, 10), hasta: String(f.hasta).slice(0, 10), nombre: nom.get(f.usuario_id) ?? "?", roles: roles.get(f.usuario_id) ?? [] }))
}

/** Días hábiles (lunes a viernes, sin los feriados que no se trabajan) entre dos fechas. */
export function diasHabiles(desde: string, hasta: string, especiales: Map<string, DiaEspecial>) {
  const habiles: string[] = []
  const sinDecidir: string[] = []
  for (let d = desde; d <= hasta; d = sumarDiasISO(d, 1)) {
    const h = esHabil(d, especiales)
    if (h === true) habiles.push(d)
    else if (h === null) sinDecidir.push(d)
  }
  return { habiles, sinDecidir }
}

const TIPO_API: Record<string, DiaEspecial["tipo"]> = { inamovible: "feriado", trasladable: "feriado", puente: "puente" }

/**
 * Trae los feriados nacionales del año de la fuente oficial y los guarda.
 * Lo que ya decidió una persona (trabajamos) NO se toca. Si un feriado que se
 * había traído ya no aparece en la fuente, queda marcado en_fuente = false.
 */
export async function sincronizarFeriados(db: SupabaseClient, anio: number) {
  const r = await fetch(`https://api.argentinadatos.com/v1/feriados/${anio}`, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } })
  if (!r.ok) throw new Error(`Feriados ${anio}: la fuente respondió ${r.status}`)
  const lista = (await r.json()) as { fecha: string; tipo: string; nombre: string }[]
  const ahora = new Date().toISOString()
  const filas = lista
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.fecha))
    .map((f) => ({ fecha: f.fecha, nombre: String(f.nombre).slice(0, 200), tipo: TIPO_API[f.tipo] ?? "feriado", origen: "api", en_fuente: true, actualizado_at: ahora }))
  if (filas.length) {
    // upsert sin "trabajamos": lo decidido por una persona queda como está
    const { error } = await db.from("calendario_dias").upsert(filas, { onConflict: "fecha" })
    if (error) throw new Error(error.message)
  }
  const { data: guardados } = await db.from("calendario_dias").select("fecha").eq("origen", "api").eq("en_fuente", true)
    .gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`)
  const vigentes = new Set(filas.map((f) => f.fecha))
  const caidos = ((guardados ?? []) as { fecha: string }[]).map((g) => String(g.fecha).slice(0, 10)).filter((f) => !vigentes.has(f))
  if (caidos.length) await db.from("calendario_dias").update({ en_fuente: false, actualizado_at: ahora }).in("fecha", caidos)
  return { feriados: filas.length, yaNoFiguran: caidos }
}

/** Una persona decide si ese día se trabaja (queda en la bitácora por trigger). */
export async function decidirDia(db: SupabaseClient, a: { fecha: string; trabajamos: boolean | null; nombre?: string | null; nota?: string | null; usuarioId: string }) {
  const ahora = new Date().toISOString()
  const { data: existe } = await db.from("calendario_dias").select("fecha").eq("fecha", a.fecha).maybeSingle()
  const cambios = { trabajamos: a.trabajamos, decidido_por: a.usuarioId, decidido_at: ahora, nota: a.nota?.trim() ? a.nota.trim().slice(0, 300) : null, actualizado_at: ahora }
  if (existe) {
    const { error } = await db.from("calendario_dias").update(cambios).eq("fecha", a.fecha)
    if (error) throw new Error(error.message)
    return
  }
  // día común (no feriado): queda como día especial de la empresa
  const finDeSemana = [0, 6].includes(diaSemana(a.fecha))
  const nombre = a.nombre?.trim() || (a.trabajamos ? (finDeSemana ? "Se trabaja (fin de semana)" : "Se trabaja") : "No se trabaja")
  const { error } = await db.from("calendario_dias").insert({ fecha: a.fecha, nombre: nombre.slice(0, 200), tipo: "empresa", origen: "persona", en_fuente: true, ...cambios })
  if (error) throw new Error(error.message)
}
