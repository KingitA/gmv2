/**
 * Gasto de IA: se anota cada llamada (tabla ai_uso) y se controla el tope
 * mensual. Si el mes ya pasó el tope, Jarvis sigue andando pero con el modelo
 * rápido (barato) y avisa.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { costoUsd, leerAjustes, type Esfuerzo, type RolModelo, type UsoTokens } from "./modelos"
import { hoyISO } from "@/lib/formato"

export interface RegistroUso {
  usuarioId: string | null
  origen: string
  conversacionId?: string | null
  modelo: string
  uso: UsoTokens
}

/** Anota el uso. No frena nada si falla (el gasto se puede reconstruir desde Anthropic). */
export async function registrarUso(db: SupabaseClient, r: RegistroUso): Promise<number> {
  const costo = costoUsd(r.modelo, r.uso)
  try {
    await db.from("ai_uso").insert({
      usuario_id: r.usuarioId,
      origen: r.origen,
      conversacion_id: r.conversacionId ?? null,
      modelo: r.modelo,
      tokens_entrada: r.uso.input_tokens ?? 0,
      tokens_cache_escritura: r.uso.cache_creation_input_tokens ?? 0,
      tokens_cache_lectura: r.uso.cache_read_input_tokens ?? 0,
      tokens_salida: r.uso.output_tokens ?? 0,
      busquedas_web: r.uso.server_tool_use?.web_search_requests ?? 0,
      costo_usd: Math.round(costo * 1e5) / 1e5,
    })
  } catch (e) {
    console.error("[jarvis] no se pudo registrar el uso", e)
  }
  return costo
}

/** Gasto del mes calendario en curso (hora Argentina), en USD. */
export async function gastoDelMes(db: SupabaseClient): Promise<number> {
  const desde = `${hoyISO().slice(0, 7)}-01T00:00:00-03:00`
  const { data, error } = await db.from("ai_uso").select("costo_usd").gte("created_at", desde)
  if (error || !data) return 0
  return (data as { costo_usd: number | string }[]).reduce((s, f) => s + Number(f.costo_usd || 0), 0)
}

export interface ModeloElegido {
  modelo: string
  respaldo: string
  rol: RolModelo
  /** true si se bajó al rápido por pasar el tope */
  porTope: boolean
  gastoMes: number
  topeMes: number
  esfuerzoChat: Esfuerzo
}

/** Elige el modelo para una tarea respetando el tope mensual. */
export async function elegirModelo(db: SupabaseClient, rol: RolModelo): Promise<ModeloElegido> {
  const ajustes = await leerAjustes(db)
  const gastoMes = await gastoDelMes(db)
  const porTope = rol === "pensador" && gastoMes >= ajustes.topeMensualUsd
  const rolFinal: RolModelo = porTope ? "rapido" : rol
  return {
    modelo: ajustes.modelos[rolFinal],
    respaldo: ajustes.modelos.respaldo,
    rol: rolFinal,
    porTope,
    gastoMes,
    topeMes: ajustes.topeMensualUsd,
    esfuerzoChat: ajustes.esfuerzoChat,
  }
}
