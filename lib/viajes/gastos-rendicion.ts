import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * #43 — Los gastos del viaje se aprueban AL ACEPTAR LA RENDICIÓN (regla de Juan,
 * 26/10): en /caja → "Controlar rendición", la oficina revisa cada gasto que
 * declaró el chofer, le pone el concepto (nafta, camión, peón, hotel u otro) y
 * el vehículo, y lo aprueba o lo rechaza. Queda quién y cuándo (revisado_por /
 * revisado_at, viaje_gasto_resolver).
 *
 * No cambia la cuenta de la rendición: los gastos se congelaron al declararla
 * (migración 20260929); un rechazo se compensa con su propio movimiento.
 */

export const CATEGORIAS_GASTO = ["nafta", "camion", "peon", "hotel", "peaje", "comida", "cubierta", "otro"] as const
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  nafta: "Nafta",
  camion: "Camión",
  peon: "Peón",
  hotel: "Hotel",
  peaje: "Peaje",
  comida: "Comida",
  cubierta: "Cubierta",
  otro: "Otro",
}

export interface DecisionGasto {
  id: string
  aprobar: boolean
  categoria?: string
  vehiculo_id?: string | null
  motivo?: string | null
}

/** Normaliza lo que manda la pantalla. null = no vino nada (pantalla vieja). */
export function normalizarDecisiones(v: unknown): DecisionGasto[] | null {
  if (!Array.isArray(v)) return null
  return v
    .filter((d: any) => d && typeof d.id === "string" && typeof d.aprobar === "boolean")
    .map((d: any) => ({
      id: d.id,
      aprobar: d.aprobar,
      categoria: CATEGORIAS_GASTO.includes(d.categoria) ? d.categoria : undefined,
      vehiculo_id: typeof d.vehiculo_id === "string" && d.vehiculo_id ? d.vehiculo_id : null,
      motivo: typeof d.motivo === "string" ? d.motivo.trim() : null,
    }))
}

/** Gastos del viaje de la rendición que todavía nadie aprobó ni rechazó. */
export async function gastosSinResolver(supabase: SupabaseClient, rendicionId: string): Promise<{ viajeId: string | null; ids: string[] }> {
  const { data: rend } = await supabase.from("rendiciones").select("viaje_id").eq("id", rendicionId).maybeSingle()
  const viajeId = (rend?.viaje_id as string | null) ?? null
  if (!viajeId) return { viajeId: null, ids: [] }
  const { data } = await supabase.from("viajes_gastos").select("id").eq("viaje_id", viajeId).eq("estado", "declarado")
  return { viajeId, ids: (data || []).map((g: any) => g.id as string) }
}

/**
 * Antes de confirmar: cada gasto declarado tiene que tener una decisión, y los
 * rechazados un motivo. Devuelve el texto del error o null.
 */
export function validarDecisiones(sinResolver: string[], decisiones: DecisionGasto[]): string | null {
  const porId = new Map(decisiones.map((d) => [d.id, d]))
  const faltan = sinResolver.filter((id) => !porId.has(id))
  if (faltan.length) return `Falta aprobar o rechazar ${faltan.length} gasto(s) del viaje`
  const sinMotivo = sinResolver.filter((id) => porId.get(id)!.aprobar === false && !porId.get(id)!.motivo)
  if (sinMotivo.length) return "Para rechazar un gasto hace falta el motivo"
  return null
}

/**
 * Aplica las decisiones (después de confirmar la rendición). Concepto y vehículo
 * se guardan antes de aprobar. Devuelve los errores para avisar (no deshace la
 * rendición: lo que falle se resuelve desde el arqueo del viaje).
 */
export async function aplicarDecisiones(
  supabase: SupabaseClient,
  viajeId: string,
  decisiones: DecisionGasto[],
  usuarioId: string,
): Promise<string[]> {
  const errores: string[] = []
  for (const d of decisiones) {
    const cambios: Record<string, unknown> = {}
    if (d.categoria) cambios.categoria = d.categoria
    if (d.vehiculo_id !== undefined) cambios.vehiculo_id = d.vehiculo_id
    if (Object.keys(cambios).length) {
      let { error } = await supabase.from("viajes_gastos").update(cambios).eq("id", d.id).eq("viaje_id", viajeId).eq("estado", "declarado")
      // Sin la migración 20261026b (no hay vehiculo_id ni 'camion'): se guarda lo que se pueda
      if (error && /vehiculo_id|categoria_check/i.test(error.message)) {
        const { vehiculo_id: _v, ...resto } = cambios
        if (resto.categoria === "camion") resto.categoria = "otro"
        error = Object.keys(resto).length
          ? (await supabase.from("viajes_gastos").update(resto).eq("id", d.id).eq("viaje_id", viajeId).eq("estado", "declarado")).error
          : null
      }
      if (error) errores.push(`gasto ${d.id.slice(0, 8)}: ${error.message}`)
    }
    const { error: rErr } = await supabase.rpc("viaje_gasto_resolver", {
      p_gasto_id: d.id,
      p_aprobar: d.aprobar,
      p_usuario_id: usuarioId,
      p_motivo: d.aprobar ? null : d.motivo || null,
    })
    // "ya está aprobado/rechazado" = reintento: no es error
    if (rErr && !/ya est/i.test(rErr.message)) errores.push(rErr.message.replace(/^viaje_gasto_resolver:\s*/, ""))
  }
  return errores
}
