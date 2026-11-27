import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"

export interface MovImport {
  fecha: string // YYYY-MM-DD
  descripcion: string
  monto: number // signado
  referencia_externa?: string | null
  // Tanda 1 de bancos (migración 20261127a): todo opcional
  hora?: string | null
  contraparte_nombre?: string | null
  contraparte_cuit?: string | null
  contraparte_cbu?: string | null
  concepto_banco?: string | null
  saldo_banco?: number | null
}

export type FuenteDetalle = "captura" | "archivo" | "pdf" | "api"

/** Familia de la fuente del extracto (columna fuente_detalle del movimiento). */
export function fuenteDetalleDe(fuente: string): FuenteDetalle {
  if (fuente === "captura") return "captura"
  if (fuente === "pdf") return "pdf"
  if (fuente.startsWith("api")) return "api"
  return "archivo"
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
  const fuenteDetalle = fuenteDetalleDe(params.fuente)
  const limpias = params.movimientos
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) && Number(m.monto))
    .map((m) => ({ ...m, descripcion: (m.descripcion || "").trim(), monto: Number(m.monto) }))
  if (!limpias.length) throw new Error("Sin movimientos válidos para importar")

  // Referencia determinística cuando la fuente no da una: misma fila del
  // mismo período → mismo hash → el UNIQUE dedupe re-importaciones.
  const vistos = new Map<string, number>()
  for (const m of limpias) {
    if (!m.referencia_externa) {
      const base = `${m.fecha}|${m.monto.toFixed(2)}|${m.descripcion.toLowerCase()}` // formato-ok: clave de dedup (máquina)
      const n = (vistos.get(base) ?? 0) + 1
      vistos.set(base, n)
      m.referencia_externa = "h:" + createHash("md5").update(`${base}|${n}`).digest("hex").slice(0, 20)
    }
  }

  const fechas = limpias.map((m) => m.fecha).sort()

  const cabecera = (fuente: string) =>
    supabase
      .from("banco_extractos")
      .insert({
        cuenta_bancaria_id: params.cuenta_bancaria_id,
        fuente,
        periodo_desde: params.periodo_desde || fechas[0],
        periodo_hasta: params.periodo_hasta || fechas[fechas.length - 1],
        saldo_inicial: params.saldo_inicial ?? null,
        saldo_final: params.saldo_final ?? null,
        importado_por: params.importado_por ?? null,
      })
      .select("id")
      .single()
  let { data: extracto, error: extErr } = await cabecera(params.fuente)
  // Sin la migración 20261127a la fuente 'captura' no pasa el CHECK: se guarda como 'excel'
  if (extErr && (extErr as { code?: string }).code === "23514" && params.fuente === "captura") ({ data: extracto, error: extErr } = await cabecera("excel"))
  if (extErr || !extracto) throw extErr ?? new Error("No se pudo crear el extracto")

  const basicas = limpias.map((m) => ({
    extracto_id: extracto.id,
    cuenta_bancaria_id: params.cuenta_bancaria_id,
    fecha: m.fecha,
    descripcion: m.descripcion || null,
    referencia_externa: m.referencia_externa,
    monto: m.monto,
  }))
  const completas = limpias.map((m, i) => ({
    ...basicas[i],
    hora: m.hora ?? null,
    contraparte_nombre: m.contraparte_nombre ?? null,
    contraparte_cuit: m.contraparte_cuit ?? null,
    contraparte_cbu: m.contraparte_cbu ?? null,
    concepto_banco: m.concepto_banco ?? null,
    saldo_banco: m.saldo_banco ?? null,
    fuente_detalle: fuenteDetalle,
  }))
  const subir = (filas: Record<string, unknown>[]) =>
    supabase
      .from("banco_extractos_movimientos")
      .upsert(filas, { onConflict: "cuenta_bancaria_id,referencia_externa", ignoreDuplicates: true })
      .select("id")
  let { data: insertados, error: movErr } = await subir(completas)
  // Sin la migración 20261127a todavía: se guarda como antes (sin hora / contraparte / saldo)
  if (movErr && faltaLaColumna(movErr)) ({ data: insertados, error: movErr } = await subir(basicas))
  if (movErr) {
    await supabase.from("banco_extractos").delete().eq("id", extracto.id)
    throw movErr
  }

  const nuevos = insertados?.length ?? 0

  const { data: match, error: matchErr } = await supabase.rpc("extracto_matchear", {
    p_extracto_id: extracto.id,
  })
  if (matchErr) throw matchErr

  // ── Bancos tanda 3 (transferencias de clientes): cruza los créditos que quedaron PENDIENTE con
  // las transferencias informadas. La lógica está en lib/bancos/transferencias/; en modo propuesta
  // no confirma nada. Nunca lanza ni frena la importación.
  const transferencias = await import("@/lib/bancos/transferencias/servidor").then((m) => m.revisarTransferencias()).catch(() => null)

  // Extracto sin filas nuevas: borrarlo para no ensuciar el historial
  if (nuevos === 0) {
    await supabase.from("banco_extractos").delete().eq("id", extracto.id)
  }

  return {
    extracto_id: nuevos ? extracto.id : null,
    importados: nuevos,
    duplicados: limpias.length - nuevos,
    matching: match,
    transferencias,
  }
}
