/**
 * Consultas fijas de bancos (Tanda 2 del plan de bancos): las usan la pantalla de Gastos bancarios
 * (/api/finanzas/gastos-bancarios) y las herramientas de Jarvis (lib/jarvis/herramientas-bancos.ts).
 * Todas de SOLO LECTURA (la única escritura es clasificar lo pendiente: concepto_id).
 * Las sumas grandes se hacen en la base (bancos_gastos / bancos_resumen, migración 20261127b).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizarCuit, cuitDigitos, redondear } from "@/lib/formato"
import { bancoDeCuenta, type BancoLectura } from "./lectura"
import { CONCEPTOS_BANCO, type ConceptoId, type TipoConcepto } from "./clasificacion"
import { clasificarPendientes } from "./clasificacion-servidor"
import { faltaLaColumna, faltaLaFuncion } from "@/lib/utils/migracion-pendiente"

export class FaltaMigracionBancos extends Error {
  name = "FaltaMigracionBancos"
  constructor() { super("Falta aplicar la migración 20261127b_bancos_clasificacion.sql (clasificación de gastos bancarios).") }
}

export interface CuentaBanco { id: string; nombre: string; banco: BancoLectura }

export async function cuentasBanco(db: SupabaseClient): Promise<CuentaBanco[]> {
  const { data, error } = await db.from("cuentas_bancarias").select("id, nombre, banco, api_banco").eq("activo", true).order("nombre")
  if (error) throw new Error(error.message)
  return ((data ?? []) as { id: string; nombre: string; banco: string | null; api_banco: string | null }[])
    .map((c) => ({ id: c.id, nombre: c.nombre, banco: bancoDeCuenta(c) }))
}

/** "Credicoop", "el Nación", "MP", o el nombre de la cuenta → las cuentas que corresponden. */
export function filtrarCuentas(cuentas: CuentaBanco[], texto: string | null | undefined): CuentaBanco[] | null {
  const t = (texto ?? "").trim()
  if (!t) return null
  const banco = bancoDeCuenta({ banco: t })
  const porBanco = banco !== "otro" ? cuentas.filter((c) => c.banco === banco) : []
  if (porBanco.length) return porBanco
  const n = t.toLowerCase()
  return cuentas.filter((c) => c.nombre.toLowerCase().includes(n))
}

// ─── Conceptos: grupos con nombre (para Jarvis y filtros) ─────────────────────
export const GRUPOS_CONCEPTO: Record<string, readonly ConceptoId[]> = {
  ley_25413: ["ley25413_debitos", "ley25413_creditos", "ley25413_reverso"],
  sircreb: ["sircreb", "sircreb_reverso"],
  percepciones: ["percepcion_iibb", "percepcion_iva", "percepcion_reverso"],
  iva: ["iva_comisiones", "percepcion_iva"],
  comisiones: ["comision_transferencias", "comision_cheques", "comision_mantenimiento", "honorarios_informes", "comision_otros"],
}
const DE_TIPO = (t: TipoConcepto) => CONCEPTOS_BANCO.filter((c) => c.tipo === t).map((c) => c.id)
const POR_TIPO: Record<string, TipoConcepto> = { impuestos: "impuesto", gastos: "gasto", pagos: "pago", financieros: "financiero", sin_reconocer: "otro", operativos: "operativo" }
export const FILTROS_CONCEPTO = [...CONCEPTOS_BANCO.map((c) => c.id), ...Object.keys(GRUPOS_CONCEPTO), ...Object.keys(POR_TIPO)]

/** Id de concepto, grupo (ley_25413, sircreb…) o tipo (impuestos, gastos…) → ids. null = todos. */
export function conceptosDe(filtro: string | null | undefined): ConceptoId[] | null {
  const f = (filtro ?? "").trim()
  if (!f) return null
  if (CONCEPTOS_BANCO.some((c) => c.id === f)) return [f as ConceptoId]
  if (GRUPOS_CONCEPTO[f]) return [...GRUPOS_CONCEPTO[f]]
  if (POR_TIPO[f]) return DE_TIPO(POR_TIPO[f])
  return []
}

// ─── Gastos por mes × banco × concepto ────────────────────────────────────────
export interface FilaGasto {
  mes: string
  cuenta_bancaria_id: string
  cuenta: string
  concepto_id: ConceptoId
  concepto: string
  tipo: TipoConcepto
  orden: number
  cantidad: number
  /** Con el signo del banco: un impuesto da negativo; su reversa o un rendimiento, positivo */
  neto: number
}

export async function gastosBancarios(
  db: SupabaseClient,
  p: { desde: string; hasta: string; cuentaIds?: string[] | null; conceptoIds?: string[] | null },
): Promise<{ filas: FilaGasto[]; aviso?: string }> {
  const cl = await clasificarPendientes(db)
  const { data, error } = await db.rpc("bancos_gastos", {
    p_desde: p.desde, p_hasta: p.hasta,
    p_cuenta_id: p.cuentaIds?.length === 1 ? p.cuentaIds[0] : null,
    p_concepto_id: p.conceptoIds?.length === 1 ? p.conceptoIds[0] : null,
  })
  if (error) {
    if (faltaLaFuncion(error, "bancos_gastos")) throw new FaltaMigracionBancos()
    throw new Error(error.message)
  }
  const cuentas = p.cuentaIds?.length ? new Set(p.cuentaIds) : null
  const conceptos = p.conceptoIds ? new Set(p.conceptoIds) : null
  const filas = ((data ?? []) as FilaGasto[])
    .map((f) => ({ ...f, cantidad: Number(f.cantidad), neto: Number(f.neto), orden: Number(f.orden) }))
    .filter((f) => (!cuentas || cuentas.has(f.cuenta_bancaria_id)) && (!conceptos || conceptos.has(f.concepto_id)))
  return { filas, aviso: cl.ok ? undefined : cl.aviso }
}

// ─── Resumen por banco ────────────────────────────────────────────────────────
export interface ResumenBanco {
  cuenta_bancaria_id: string
  cuenta: string
  banco: string | null
  movimientos: number
  creditos: number
  debitos: number
  impuestos: number
  gastos: number
  pagos: number
  financieros: number
  sin_clasificar: number
  desde_mov: string | null
  hasta_mov: string | null
  saldo_inicial: number | null
  saldo_final: number | null
  saldo_referencia: number | null
  saldo_referencia_al: string | null
  saldo_fuente: string | null
}

export async function resumenBancos(db: SupabaseClient, desde: string, hasta: string): Promise<ResumenBanco[]> {
  await clasificarPendientes(db)
  const { data, error } = await db.rpc("bancos_resumen", { p_desde: desde, p_hasta: hasta })
  if (error) {
    if (faltaLaFuncion(error, "bancos_resumen")) throw new FaltaMigracionBancos()
    throw new Error(error.message)
  }
  const n = (v: unknown) => (v == null ? null : Number(v))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    cuenta_bancaria_id: String(r.cuenta_bancaria_id), cuenta: String(r.cuenta ?? ""), banco: (r.banco as string) ?? null,
    movimientos: Number(r.movimientos) || 0,
    creditos: Number(r.creditos) || 0, debitos: Number(r.debitos) || 0, impuestos: Number(r.impuestos) || 0,
    gastos: Number(r.gastos) || 0, pagos: Number(r.pagos) || 0, financieros: Number(r.financieros) || 0,
    sin_clasificar: Number(r.sin_clasificar) || 0,
    desde_mov: (r.desde_mov as string) ?? null, hasta_mov: (r.hasta_mov as string) ?? null,
    saldo_inicial: n(r.saldo_inicial), saldo_final: n(r.saldo_final), saldo_referencia: n(r.saldo_referencia),
    saldo_referencia_al: (r.saldo_referencia_al as string) ?? null, saldo_fuente: (r.saldo_fuente as string) ?? null,
  }))
}

// ─── Saldo del banco contra el del sistema ────────────────────────────────────
export interface SaldoBanco {
  cuenta_bancaria_id: string
  cuenta: string
  banco: BancoLectura
  saldo_banco: number | null
  saldo_banco_al: string | null
  saldo_banco_fuente: string | null
  saldo_sistema: number
  saldo_sistema_actualizado: string | null
  diferencia: number | null
  ultimo_movimiento_cargado: string | null
}

export async function saldosBancos(db: SupabaseClient): Promise<SaldoBanco[]> {
  const cuentas = await cuentasBanco(db)
  const ids = cuentas.map((c) => c.id)
  if (!ids.length) return []
  const [banco, sistema, ultimos] = await Promise.all([
    db.from("banco_saldo_actual").select("cuenta_bancaria_id, saldo, al, fuente").in("cuenta_bancaria_id", ids),
    db.from("saldos_financieros").select("cuenta_id, saldo, updated_at").eq("cuenta_tipo", "BANCO").in("cuenta_id", ids),
    Promise.all(ids.map((id) => db.from("banco_extractos_movimientos").select("fecha").eq("cuenta_bancaria_id", id).order("fecha", { ascending: false }).limit(1))),
  ])
  const bMap = new Map(((banco.error ? [] : banco.data) ?? []).map((b: Record<string, unknown>) => [String(b.cuenta_bancaria_id), b]))
  return cuentas.map((c, i) => {
    const b = bMap.get(c.id)
    const sis = ((sistema.data ?? []) as { cuenta_id: string; saldo: number; updated_at: string | null }[]).filter((s) => s.cuenta_id === c.id)
    const saldoSistema = redondear(sis.reduce((t, s) => t + Number(s.saldo || 0), 0))
    const act = sis.map((s) => s.updated_at).filter(Boolean).sort().pop() ?? null
    const saldoBanco = b ? Number(b.saldo) : null
    return {
      cuenta_bancaria_id: c.id, cuenta: c.nombre, banco: c.banco,
      saldo_banco: saldoBanco, saldo_banco_al: (b?.al as string) ?? null, saldo_banco_fuente: (b?.fuente as string) ?? null,
      saldo_sistema: saldoSistema, saldo_sistema_actualizado: act,
      diferencia: saldoBanco == null ? null : redondear(saldoBanco - saldoSistema),
      ultimo_movimiento_cargado: ((ultimos[i].data ?? [])[0] as { fecha?: string } | undefined)?.fecha ?? null,
    }
  })
}

// ─── Movimientos con filtros ──────────────────────────────────────────────────
export interface FiltroMovimientos {
  cuentaIds?: string[] | null
  desde: string
  hasta: string
  tipo?: "credito" | "debito" | null
  conceptoIds?: string[] | null
  /** Nombre de quien transfirió / a quien se transfirió (cada palabra tiene que estar) */
  contraparte?: string | null
  cuit?: string | null
  /** Importe (sin signo): exacto (±$0,99) o entre mínimo y máximo */
  monto?: number | null
  montoMin?: number | null
  montoMax?: number | null
  /** Texto libre sobre la descripción del banco */
  texto?: string | null
  limite?: number
}

export interface MovimientoBanco {
  id: string
  cuenta_bancaria_id: string
  fecha: string
  hora: string | null
  descripcion: string | null
  concepto_banco: string | null
  concepto_id: string | null
  monto: number
  contraparte_nombre: string | null
  contraparte_cuit: string | null
  contraparte_cbu: string | null
  saldo_banco: number | null
  estado_matching: string | null
}

const limpiar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[%_,()*\\"']/g, " ").replace(/\s+/g, " ").trim()

const TOPE_MOVS = 3000

export async function movimientosBancarios(
  db: SupabaseClient, f: FiltroMovimientos,
): Promise<{ filas: MovimientoBanco[]; cantidad: number; creditos: number; debitos: number; truncado: boolean }> {
  const BASE = "id, cuenta_bancaria_id, fecha, hora, descripcion, concepto_banco, monto, contraparte_nombre, contraparte_cuit, contraparte_cbu, saldo_banco, estado_matching"
  let columnas = BASE + ", concepto_id"
  if (f.conceptoIds) await clasificarPendientes(db)
  const armar = () => {
    let q = db.from("banco_extractos_movimientos").select(columnas).gte("fecha", f.desde).lte("fecha", f.hasta)
    if (f.cuentaIds?.length) q = q.in("cuenta_bancaria_id", f.cuentaIds)
    if (f.conceptoIds) q = q.in("concepto_id", f.conceptoIds.length ? f.conceptoIds : ["__ninguno__"])
    if (f.tipo === "credito") q = q.gt("monto", 0)
    if (f.tipo === "debito") q = q.lt("monto", 0)
    // Importe sin signo: [lo, hi]
    let lo: number | null = null, hi: number | null = null
    if (f.monto != null && Number.isFinite(f.monto)) { lo = Math.abs(f.monto) - 0.99; hi = Math.abs(f.monto) + 0.99 }
    else if (f.montoMin != null || f.montoMax != null) { lo = Math.abs(f.montoMin ?? 0); hi = Math.abs(f.montoMax ?? 1e15) }
    if (lo != null && hi != null) {
      if (f.tipo === "credito") q = q.gte("monto", lo).lte("monto", hi)
      else if (f.tipo === "debito") q = q.gte("monto", -hi).lte("monto", -lo)
      else q = q.or(`and(monto.gte.${lo},monto.lte.${hi}),and(monto.gte.${-hi},monto.lte.${-lo})`)
    }
    if (f.cuit) {
      const cuit = normalizarCuit(f.cuit), dig = cuitDigitos(f.cuit)
      q = q.or([cuit ? `contraparte_cuit.eq.${cuit}` : null, dig.length === 11 ? `descripcion.ilike.%${dig}%` : null].filter(Boolean).join(",") || "id.is.null")
    }
    // Cada palabra del nombre, en el nombre de la contraparte o (movimientos viejos) en la descripción
    const palabras = limpiar(f.contraparte ?? "").split(" ").filter((x) => x.length >= 2)
    if (palabras.length) {
      const todas = (col: string) => `and(${palabras.map((w) => `${col}.ilike.%${w}%`).join(",")})`
      q = q.or(`${todas("contraparte_nombre")},${todas("descripcion")}`)
    }
    for (const w of limpiar(f.texto ?? "").split(" ").filter((x) => x.length >= 2)) q = q.ilike("descripcion", `%${w}%`)
    return q.order("fecha", { ascending: false }).order("hora", { ascending: false, nullsFirst: false }).order("id")
  }
  const filas: MovimientoBanco[] = []
  for (let desde = 0; desde < TOPE_MOVS; desde += 1000) {
    let { data, error } = await armar().range(desde, desde + 999)
    // Sin la migración 20261127b no hay concepto_id: se sigue sin él (salvo que se filtre por concepto)
    if (error && faltaLaColumna(error) && !f.conceptoIds && columnas !== BASE) { columnas = BASE; ({ data, error } = await armar().range(desde, desde + 999)) }
    if (error) { if (faltaLaColumna(error)) throw new FaltaMigracionBancos(); throw new Error(error.message) }
    filas.push(...((data ?? []) as unknown as MovimientoBanco[]).map((m) => ({ ...m, monto: Number(m.monto), saldo_banco: m.saldo_banco == null ? null : Number(m.saldo_banco) })))
    if (!data || data.length < 1000) break
  }
  const creditos = redondear(filas.filter((m) => m.monto > 0).reduce((t, m) => t + m.monto, 0))
  const debitos = redondear(-filas.filter((m) => m.monto < 0).reduce((t, m) => t + m.monto, 0))
  return { filas: filas.slice(0, f.limite ?? 500), cantidad: filas.length, creditos, debitos, truncado: filas.length >= TOPE_MOVS }
}
