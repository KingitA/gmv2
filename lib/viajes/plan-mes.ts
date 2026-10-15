import type { SupabaseClient } from "@supabase/supabase-js"
import { sumarDiasISO } from "@/lib/formato"
import { ausenciasEntre, diasEspeciales, diasHabiles, type Ausencia, type DiaEspecial } from "./calendario-laboral"

/**
 * PLAN MENSUAL DE VIAJES — qué zonas ya tienen viaje en un mes, cuáles faltan
 * y la propuesta armada con el mes anterior.
 *
 * Lo usa la pantalla /viajes/planificar y está pensado para que Jarvis lo
 * consulte para el recordatorio de fin de mes ("faltan programar N zonas de
 * noviembre"): `zonasSinProgramar(db, "2026-11")`.
 *
 * Un viaje "cubre" una zona en el mes si la zona está en sus viaje_zonas y
 * alguno de sus días cae dentro del mes (los de varios días que arrancan el
 * mes anterior también cuentan). Cancelados no cuentan.
 *
 * Frecuencia de cada zona (zonas.frecuencia_dias):
 *   1    = todos los días hábiles (BAHIA): falta cada día hábil sin viaje.
 *   N    = cada N días (30 = mensual, 45 = 1,5 meses…): falta si le toca este
 *          mes (última visita + N cae antes de fin de mes) y no tiene viaje.
 *   NULL = cuando haga falta: nunca falta.
 * Días hábiles = lunes a viernes, sin los feriados que se decidió no trabajar
 * (lib/viajes/calendario-laboral.ts).
 */

export interface ZonaPlan {
  id: string
  nombre: string
  dias_viaje: number
  en_calendario: boolean
  /** 1 = todos los días hábiles · N = cada N días · null = cuando haga falta */
  frecuencia_dias: number | null
  /** última visita ANTES de este mes */
  ultima_visita: string | null
  /** desde cuándo le toca (última visita + frecuencia); null si nunca se visitó o es diaria/ocasional */
  le_toca_desde: string | null
  /** ¿le toca un viaje en este mes? */
  toca_este_mes: boolean
  /** Viajes del mes que la cubren */
  viajes: Array<{ id: string; fecha: string; dias: number }>
  /** solo para las diarias: días hábiles del mes sin viaje */
  dias_faltantes?: string[]
}

export interface ViajePlan {
  id: string
  nombre: string
  fecha: string
  dias: number
  estado: string
  zonas: Array<{ id: string; nombre: string }>
}

export interface PropuestaViaje {
  fecha: string
  dias: number
  zona_ids: string[]
  /** De dónde salió: viaje del mes anterior */
  origen: { fecha: string; nombre: string }
}

export interface EstadoPlanMes {
  mes: string
  desde: string
  hasta: string
  zonas: ZonaPlan[]
  viajes: ViajePlan[]
  faltantes: Array<{ id: string; nombre: string; dias_viaje: number; dias_faltantes?: string[] }>
  /** feriados y días especiales del mes */
  especiales: DiaEspecial[]
  /** vacaciones / licencias que tocan el mes */
  ausencias: Ausencia[]
  /** días hábiles del mes y feriados sin decidir */
  habiles: string[]
  sin_decidir: string[]
}

const MES_RE = /^\d{4}-\d{2}$/

export function rangoMes(mes: string): { desde: string; hasta: string } {
  if (!MES_RE.test(mes)) throw new Error("mes inválido (AAAA-MM)")
  const [a, m] = mes.split("-").map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate() // formato-ok: último día del mes (cálculo)
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` }
}

export function mesSiguiente(mes: string, delta = 1): string {
  const [a, m] = mes.split("-").map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1)) // formato-ok: aritmética de meses (cálculo)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Viajes de reparto (no cancelados) que tocan el rango, con sus zonas. */
async function viajesDelRango(db: SupabaseClient, desde: string, hasta: string): Promise<ViajePlan[]> {
  const { data, error } = await db
    .from("viajes")
    .select("id, nombre, fecha, dias, estado, viaje_zonas(zona_id, zonas(nombre))")
    .eq("tipo", "reparto")
    .neq("estado", "cancelado")
    .gte("fecha", sumarDiasISO(desde, -15))
    .lte("fecha", hasta)
    .order("fecha", { ascending: true })
  if (error) throw error
  return ((data || []) as any[])
    .map((v) => ({
      id: v.id as string,
      nombre: v.nombre as string,
      fecha: String(v.fecha).slice(0, 10),
      dias: Math.max(1, Number(v.dias) || 1),
      estado: v.estado as string,
      zonas: (v.viaje_zonas || []).map((z: any) => ({ id: z.zona_id as string, nombre: z.zonas?.nombre || "" })),
    }))
    .filter((v) => sumarDiasISO(v.fecha, v.dias - 1) >= desde)
}

export async function estadoPlanMes(db: SupabaseClient, mes: string, opciones: { desdeDia?: string } = {}): Promise<EstadoPlanMes> {
  const { desde, hasta } = rangoMes(mes)
  const [zonasRes, viajes, anteriores, especiales, ausencias] = await Promise.all([
    db.from("zonas").select("id, nombre, dias_viaje, en_calendario, frecuencia_dias").order("nombre"),
    viajesDelRango(db, desde, hasta),
    viajesDelRango(db, sumarDiasISO(desde, -400), sumarDiasISO(desde, -1)),
    diasEspeciales(db, desde, hasta),
    ausenciasEntre(db, desde, hasta),
  ])
  // si la columna frecuencia_dias todavía no existe (migración sin aplicar), se sigue como antes
  let zonasRaw: any[] = (zonasRes.data || []) as any[]
  if (zonasRes.error) {
    const viejo = await db.from("zonas").select("id, nombre, dias_viaje, en_calendario").order("nombre")
    if (viejo.error) throw viejo.error
    zonasRaw = ((viejo.data || []) as any[]).map((z) => ({ ...z, frecuencia_dias: z.en_calendario === false ? null : 30 }))
  }

  const mapaEsp = new Map(especiales.map((e) => [e.fecha, e]))
  const { habiles, sinDecidir } = diasHabiles(desde, hasta, mapaEsp)
  // para el mes en curso, los días que ya pasaron no se reclaman
  const desdeDia = opciones.desdeDia && opciones.desdeDia > desde ? opciones.desdeDia : desde

  const zonas: ZonaPlan[] = zonasRaw.map((z) => {
    const frecuencia = z.frecuencia_dias == null ? null : Math.max(1, Number(z.frecuencia_dias) || 30)
    const delMes = viajes.filter((v) => v.zonas.some((x) => x.id === z.id))
    const previos = anteriores.filter((v) => v.zonas.some((x) => x.id === z.id))
    const ultima = previos.length ? previos.map((v) => sumarDiasISO(v.fecha, v.dias - 1)).sort().at(-1)! : null
    const leTocaDesde = frecuencia && frecuencia > 1 && ultima ? sumarDiasISO(ultima, frecuencia) : null
    const tocaEsteMes = frecuencia === null ? false : frecuencia === 1 ? true : !leTocaDesde || leTocaDesde <= hasta
    let diasFaltantes: string[] | undefined
    if (frecuencia === 1) {
      const cubiertos = new Set<string>()
      for (const v of delMes) for (let i = 0; i < v.dias; i++) cubiertos.add(sumarDiasISO(v.fecha, i))
      diasFaltantes = habiles.filter((d) => d >= desdeDia && !cubiertos.has(d))
    }
    return {
      id: z.id,
      nombre: z.nombre,
      dias_viaje: Math.max(1, Number(z.dias_viaje) || 1),
      en_calendario: frecuencia !== null,
      frecuencia_dias: frecuencia,
      ultima_visita: ultima,
      le_toca_desde: leTocaDesde,
      toca_este_mes: tocaEsteMes,
      viajes: delMes.map((v) => ({ id: v.id, fecha: v.fecha, dias: v.dias })),
      ...(diasFaltantes ? { dias_faltantes: diasFaltantes } : {}),
    }
  })

  return {
    mes,
    desde,
    hasta,
    zonas,
    viajes,
    faltantes: zonas
      .filter((z) => z.toca_este_mes && (z.frecuencia_dias === 1 ? (z.dias_faltantes?.length ?? 0) > 0 : z.viajes.length === 0))
      .map((z) => ({ id: z.id, nombre: z.nombre, dias_viaje: z.dias_viaje, ...(z.dias_faltantes ? { dias_faltantes: z.dias_faltantes } : {}) })),
    especiales,
    ausencias,
    habiles,
    sin_decidir: sinDecidir,
  }
}

/** Para Jarvis / recordatorios: zonas que deberían tener viaje en el mes y no lo tienen. */
export async function zonasSinProgramar(db: SupabaseClient, mes: string, desdeDia?: string) {
  return (await estadoPlanMes(db, mes, { desdeDia })).faltantes
}

/**
 * Mismo día de la semana y misma semana del mes: un viaje del 2.º martes del
 * mes anterior se propone el 2.º martes de este (si no hay 5.º, el último).
 */
export function mismaSemanaYDia(fechaAnterior: string, mesDestino: string): string {
  const d = new Date(fechaAnterior + "T00:00:00Z") // formato-ok: día de semana en UTC (cálculo)
  const diaSemana = d.getUTCDay()
  const n = Math.ceil(d.getUTCDate() / 7)
  const { desde, hasta } = rangoMes(mesDestino)
  const primero = new Date(desde + "T00:00:00Z") // formato-ok: cálculo
  const corrimiento = (diaSemana - primero.getUTCDay() + 7) % 7
  let candidato = sumarDiasISO(desde, corrimiento + (n - 1) * 7)
  while (candidato > hasta) candidato = sumarDiasISO(candidato, -7)
  return candidato
}

/** Propuesta del mes a partir de los viajes del mes anterior (no se guarda nada). */
export async function propuestaDesdeMesAnterior(db: SupabaseClient, mes: string): Promise<PropuestaViaje[]> {
  const anterior = mesSiguiente(mes, -1)
  const { desde, hasta } = rangoMes(anterior)
  const viajes = (await viajesDelRango(db, desde, hasta)).filter((v) => v.fecha >= desde && v.zonas.length > 0)
  return viajes.map((v) => ({
    fecha: mismaSemanaYDia(v.fecha, mes),
    dias: v.dias,
    zona_ids: v.zonas.map((z) => z.id),
    origen: { fecha: v.fecha, nombre: v.nombre },
  }))
}
