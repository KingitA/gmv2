import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface MovImport {
  fecha: string // YYYY-MM-DD
  descripcion: string
  monto: number // signado
  referencia_externa?: string | null
}

/**
 * Importa un extracto bancario (cualquier fuente) y corre el matching.
 * Compartido por el import manual (Excel/CSV/PDF) y las fuentes API (MP).
 * Idempotente: UNIQUE (cuenta, referencia_externa) — filas repetidas se ignoran.
 */
export async function importarExtracto(
  supabase: SupabaseClient,
  params: {
    cuenta_bancaria_id: string
    fuente: string
    movimientos: MovImport[]
    periodo_desde?: string | null
    periodo_hasta?: string | null
    saldo_inicial?: number | null
    saldo_final?: number | null
    importado_por?: string | null
  }
) {
  const limpias = params.movimientos
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) && Number(m.monto))
    .map((m) => ({ ...m, descripcion: (m.descripcion || "").trim(), monto: Number(m.monto) }))
  if (!limpias.length) throw new Error("Sin movimientos válidos para importar")

  // Referencia determinística cuando la fuente no da una: misma fila del
  // mismo período → mismo hash → el UNIQUE dedupe re-importaciones.
  const vistos = new Map<string, number>()
  for (const m of limpias) {
    if (!m.referencia_externa) {
      const base = `${m.fecha}|${m.monto.toFixed(2)}|${m.descripcion.toLowerCase()}`
      const n = (vistos.get(base) ?? 0) + 1
      vistos.set(base, n)
      m.referencia_externa = "h:" + createHash("md5").update(`${base}|${n}`).digest("hex").slice(0, 20)
    }
  }

  const fechas = limpias.map((m) => m.fecha).sort()

  const { data: extracto, error: extErr } = await supabase
    .from("banco_extractos")
    .insert({
      cuenta_bancaria_id: params.cuenta_bancaria_id,
      fuente: params.fuente,
      periodo_desde: params.periodo_desde || fechas[0],
      periodo_hasta: params.periodo_hasta || fechas[fechas.length - 1],
      saldo_inicial: params.saldo_inicial ?? null,
      saldo_final: params.saldo_final ?? null,
      importado_por: params.importado_por ?? null,
    })
    .select("id")
    .single()
  if (extErr) throw extErr

  const { data: insertados, error: movErr } = await supabase
    .from("banco_extractos_movimientos")
    .upsert(
      limpias.map((m) => ({
        extracto_id: extracto.id,
        cuenta_bancaria_id: params.cuenta_bancaria_id,
        fecha: m.fecha,
        descripcion: m.descripcion || null,
        referencia_externa: m.referencia_externa,
        monto: m.monto,
      })),
      { onConflict: "cuenta_bancaria_id,referencia_externa", ignoreDuplicates: true }
    )
    .select("id")
  if (movErr) throw movErr

  const nuevos = insertados?.length ?? 0

  const { data: match, error: matchErr } = await supabase.rpc("extracto_matchear", {
    p_extracto_id: extracto.id,
  })
  if (matchErr) throw matchErr

  // Extracto sin filas nuevas: borrarlo para no ensuciar el historial
  if (nuevos === 0) {
    await supabase.from("banco_extractos").delete().eq("id", extracto.id)
  }

  return {
    extracto_id: nuevos ? extracto.id : null,
    importados: nuevos,
    duplicados: limpias.length - nuevos,
    matching: match,
  }
}
