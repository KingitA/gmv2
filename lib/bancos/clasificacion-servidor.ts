/**
 * Clasificación de los movimientos del banco en la base (Tanda 2 del plan de bancos).
 * Las reglas están en lib/bancos/clasificacion (puras, probadas); acá solo se leen los movimientos
 * y se guarda concepto_id + clasificacion_version (migración 20261127b_bancos_clasificacion.sql).
 *
 * SOLO clasifica: no crea asientos, no concilia, no toca saldos ni cuentas corrientes.
 * Nunca hace fallar a quien la llama: sin la migración, devuelve { ok: false } y sigue todo igual.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { bancoDeCuenta, type BancoLectura } from "./lectura"
import { clasificarMovimiento, textoAClasificar, VERSION_CLASIFICACION, type ConceptoId } from "./clasificacion"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"

interface MovAClasificar {
  id: string
  cuenta_bancaria_id: string
  concepto_banco: string | null
  descripcion: string | null
  monto: number | string
}

export interface ResultadoClasificacion {
  ok: boolean
  clasificados: number
  /** Motivo si no se pudo (p. ej. falta la migración) */
  aviso?: string
}

const SIN_MIGRACION = "Falta aplicar la migración 20261127b_bancos_clasificacion.sql"

async function bancosDeCuentas(db: SupabaseClient): Promise<Map<string, BancoLectura>> {
  const { data } = await db.from("cuentas_bancarias").select("id, nombre, banco, api_banco")
  return new Map(((data ?? []) as { id: string; nombre: string | null; banco: string | null; api_banco: string | null }[]).map((c) => [c.id, bancoDeCuenta(c)]))
}

/** Guarda la clasificación de esas filas, agrupadas por concepto (pocas consultas). */
async function guardar(db: SupabaseClient, filas: MovAClasificar[], bancos: Map<string, BancoLectura>): Promise<number> {
  const porConcepto = new Map<ConceptoId, string[]>()
  for (const f of filas) {
    const c = clasificarMovimiento(bancos.get(f.cuenta_bancaria_id) ?? "otro", textoAClasificar(f), Number(f.monto))
    const ids = porConcepto.get(c) ?? []
    ids.push(f.id)
    porConcepto.set(c, ids)
  }
  let n = 0
  for (const [concepto_id, ids] of porConcepto) {
    for (let i = 0; i < ids.length; i += 200) {
      const parte = ids.slice(i, i + 200)
      const { error } = await db.from("banco_extractos_movimientos")
        .update({ concepto_id, clasificacion_version: VERSION_CLASIFICACION }).in("id", parte)
      if (error) throw error
      n += parte.length
    }
  }
  return n
}

const COLUMNAS = "id, cuenta_bancaria_id, concepto_banco, descripcion, monto"

/** Clasifica los movimientos de un extracto recién importado. */
export async function clasificarExtracto(db: SupabaseClient, extractoId: string): Promise<ResultadoClasificacion> {
  try {
    const { data, error } = await db.from("banco_extractos_movimientos").select(COLUMNAS).eq("extracto_id", extractoId).limit(5000)
    if (error) throw error
    if (!data?.length) return { ok: true, clasificados: 0 }
    return { ok: true, clasificados: await guardar(db, data as MovAClasificar[], await bancosDeCuentas(db)) }
  } catch (e) {
    if (faltaLaColumna(e) || /concepto_id|clasificacion_version|bancos_conceptos/.test(String((e as { message?: string })?.message))) return { ok: false, clasificados: 0, aviso: SIN_MIGRACION }
    console.error("[bancos/clasificacion] extracto", extractoId, e)
    return { ok: false, clasificados: 0, aviso: (e as { message?: string })?.message ?? String(e) }
  }
}

/**
 * Clasifica lo que falta: movimientos sin concepto o clasificados con reglas viejas.
 * Lo llaman el reporte de gastos bancarios y las herramientas de Jarvis antes de consultar, así lo
 * que ya estaba en la base (y lo que entró por otro camino) queda clasificado sin hacer nada.
 */
export async function clasificarPendientes(db: SupabaseClient, max = 20_000): Promise<ResultadoClasificacion> {
  let total = 0
  try {
    let bancos: Map<string, BancoLectura> | null = null
    while (total < max) {
      const { data, error } = await db.from("banco_extractos_movimientos").select(COLUMNAS)
        .or(`concepto_id.is.null,clasificacion_version.is.null,clasificacion_version.lt.${VERSION_CLASIFICACION}`)
        .order("id").limit(1000)
      if (error) throw error
      if (!data?.length) break
      bancos ??= await bancosDeCuentas(db)
      const n = await guardar(db, data as MovAClasificar[], bancos)
      total += n
      if (n === 0 || data.length < 1000) break
    }
    return { ok: true, clasificados: total }
  } catch (e) {
    if (faltaLaColumna(e) || /concepto_id|clasificacion_version|bancos_conceptos/.test(String((e as { message?: string })?.message))) return { ok: false, clasificados: total, aviso: SIN_MIGRACION }
    console.error("[bancos/clasificacion] pendientes", e)
    return { ok: false, clasificados: total, aviso: (e as { message?: string })?.message ?? String(e) }
  }
}
