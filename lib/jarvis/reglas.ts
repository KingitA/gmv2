/**
 * Reglas de Jarvis (PLAN.md §10.3): las POLÍTICAS que define una persona.
 * Se guardan en ai_ajustes (cada cambio queda en la bitácora con quién y cuándo).
 *
 * - umbrales: a partir de cuánto avisa cada vigía
 * - notas del negocio: cosas que Jarvis tiene que saber ("Lanín = plásticos",
 *   "a Grondona no se le retiene sin hablar con Juan"). Claves "nota:…".
 *   Una nota borrada queda con valor null (así el borrado también se registra).
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export const REGLAS_POR_DEFECTO = {
  regla_deuda_vencida_minima: 100_000,
  regla_dias_compra_reciente: 3,
  regla_atraso_habitual: 1.5,
  regla_cobertura_max_dias: 7,
  regla_venta_diaria_minima: 2,
  regla_dias_cobro_sin_verificar: 2,
  regla_avisos: "todo" as "todo" | "urgentes",
  regla_suba_insumo_pct: 10,
  regla_dias_sin_aumento: 45,
  regla_participacion_insumo: 50,
  regla_dia_aviso_calendario: 20,
}
export type Reglas = typeof REGLAS_POR_DEFECTO

export interface Nota { clave: string; texto: string; actualizado_por: string | null; actualizado_at: string }

export async function leerReglas(db: SupabaseClient): Promise<{ reglas: Reglas; notas: Nota[] }> {
  const reglas: Reglas = { ...REGLAS_POR_DEFECTO }
  const notas: Nota[] = []
  const { data } = await db.from("ai_ajustes").select("clave, valor, actualizado_por, actualizado_at")
  for (const f of (data ?? []) as { clave: string; valor: unknown; actualizado_por: string | null; actualizado_at: string }[]) {
    if (f.clave.startsWith("nota:")) {
      if (typeof f.valor === "string" && f.valor.trim()) notas.push({ clave: f.clave, texto: f.valor, actualizado_por: f.actualizado_por, actualizado_at: f.actualizado_at })
      continue
    }
    if (!(f.clave in reglas)) continue
    const k = f.clave as keyof Reglas
    if (k === "regla_avisos") { if (f.valor === "todo" || f.valor === "urgentes") reglas.regla_avisos = f.valor; continue }
    if (typeof f.valor === "number" && isFinite(f.valor)) (reglas[k] as number) = f.valor
  }
  notas.sort((a, b) => a.actualizado_at.localeCompare(b.actualizado_at))
  return { reglas, notas }
}

/** Las notas del negocio, como texto para las instrucciones de Jarvis. */
export function notasComoTexto(notas: Nota[]): string {
  if (!notas.length) return ""
  return `# Lo que el negocio te pidió que sepas (lo cargaron personas de la empresa)\n${notas.map((n) => `- ${n.texto}`).join("\n")}`
}
