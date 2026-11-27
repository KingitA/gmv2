/**
 * Control diario de bancos (Tanda 5) — SOLO SERVIDOR. Las reglas son puras (./reglas, con pruebas).
 *
 *  - Cargos del banco al libro de fondos: impuestos, comisiones, débitos automáticos, servicios,
 *    ARCA (egreso) y reversas / rendimientos (ingreso), por bancos_registrar_cargo (migración
 *    20261127e), que usa extracto_registrar_egreso / extracto_registrar_ingreso de siempre.
 *    Modo propuesta (por defecto): solo se listan; "Registrar todo" los registra.
 *  - Panel del control diario y datos del vigía de Jarvis (solo lectura).
 * Sin la migración no registra nada y el panel dice que falta.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { ahoraISO, hoyISO, sumarDiasISO } from "@/lib/formato"
import { clasificarPendientes } from "@/lib/bancos/clasificacion-servidor"
import { saldosBancos } from "@/lib/bancos/consultas"
import {
  armarControl, proponerCargos, totalesControl,
  type ControlCuenta, type MovControl, type PropuestaCargo,
} from "./reglas"

type Fila = Record<string, any>

export const VENTANA_DIAS = 60
/** Tope por llamada (cada registro es una transacción; Vercel corta a los 60 s) */
const MAX_POR_VEZ = 250

export interface AjustesCargos {
  modo_propuesta: boolean
  desde: string | null
  confirma_usuario_id: string | null
  cambiado_at: string | null
}

const faltaTabla = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(String(e.message ?? "")))

export async function leerAjustesCargos(db: SupabaseClient): Promise<AjustesCargos | null> {
  const { data, error } = await db.from("bancos_cargos_ajustes").select("modo_propuesta, desde, confirma_usuario_id, cambiado_at").eq("id", true).maybeSingle()
  if (error) { if (!faltaTabla(error)) console.warn("[bancos/control] ajustes:", error.message); return null }
  return {
    modo_propuesta: data?.modo_propuesta !== false, desde: data?.desde ?? null,
    confirma_usuario_id: data?.confirma_usuario_id ?? null, cambiado_at: data?.cambiado_at ?? null,
  }
}

export async function cambiarAjustesCargos(db: SupabaseClient, usuarioId: string, cambio: { propuesta?: boolean; desde?: string | null }) {
  const actual = await leerAjustesCargos(db)
  if (!actual) throw new Error("Falta aplicar la migración 20261127e_bancos_control_diario.sql")
  const propuesta = cambio.propuesta ?? actual.modo_propuesta
  const { error } = await db.from("bancos_cargos_ajustes").upsert({
    id: true, modo_propuesta: propuesta, desde: cambio.desde !== undefined ? cambio.desde : actual.desde,
    confirma_usuario_id: propuesta ? null : (cambio.propuesta === false ? usuarioId : actual.confirma_usuario_id),
    cambiado_por: usuarioId, cambiado_at: ahoraISO(),
  })
  if (error) throw new Error(error.message)
}

/** Primer día que se registra: el de los ajustes, o los últimos 60 días. */
const desdeDe = (a: AjustesCargos, hoy: string) => a.desde ?? sumarDiasISO(hoy, -VENTANA_DIAS)

// ─── Lectura ──────────────────────────────────────────────────────────────────

const COLS = "id, cuenta_bancaria_id, fecha, monto, descripcion, concepto_banco, concepto_id, estado_matching, kardex_id"
const COLS_VIEJAS = "id, cuenta_bancaria_id, fecha, monto, descripcion, estado_matching, kardex_id"

/** PENDIENTES (y SUGERIDOS si se piden) desde ese día. */
async function movimientos(db: SupabaseClient, desde: string, conSugeridos: boolean): Promise<MovControl[]> {
  const estados = conSugeridos ? ["PENDIENTE", "SUGERIDO"] : ["PENDIENTE"]
  const q = (cols: string) => () => db.from("banco_extractos_movimientos").select(cols).in("estado_matching", estados).gte("fecha", desde)
  let filas: Fila[]
  try {
    filas = await fetchAllRows<Fila>(q(COLS), "id")
  } catch (e) {
    if (!faltaLaColumna(e)) throw e
    filas = await fetchAllRows<Fila>(q(COLS_VIEJAS), "id") // sin las migraciones 20261127a/b: sin concepto (no hay cargos)
  }
  return filas.map((m) => ({
    id: m.id, cuenta_bancaria_id: m.cuenta_bancaria_id, fecha: String(m.fecha).slice(0, 10), monto: Number(m.monto),
    descripcion: m.descripcion ?? null, concepto_banco: m.concepto_banco ?? null, concepto_id: m.concepto_id ?? null,
    estado_matching: m.estado_matching, kardex_id: m.kardex_id ?? null,
  }))
}

/** Avisos abiertos de cheques (tanda 4). Sin la migración: ninguno. */
async function avisosCheques(db: SupabaseClient): Promise<{ movimiento_id: string; tipo: string; comision_movimiento_id: string | null }[]> {
  const { data, error } = await db.from("cheques_banco_avisos").select("movimiento_id, tipo, comision_movimiento_id").eq("estado", "pendiente").limit(2000)
  if (error) { if (!faltaTabla(error)) throw new Error(error.message); return [] }
  return (data ?? []) as any[]
}

/** De estos movimientos, los que ya tomó alguna tanda (vínculos 3/4, ya registrados). */
async function tomadosDe(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!ids.length) return out
  for (const tabla of ["banco_transferencias_vinculos", "cheques_banco_vinculos", "bancos_cargos_registrados"]) {
    try {
      const filas = await fetchByIds<Fila>((c) => db.from(tabla).select("movimiento_id").in("movimiento_id", c), ids)
      for (const f of filas) out.add(String(f.movimiento_id))
    } catch (e) {
      if (!faltaTabla(e as { code?: string })) throw e
    }
  }
  return out
}

async function propuestas(db: SupabaseClient, ajustes: AjustesCargos, hoy: string, movs?: MovControl[], avisos?: Awaited<ReturnType<typeof avisosCheques>>): Promise<PropuestaCargo[]> {
  const desde = desdeDe(ajustes, hoy)
  const lista = (movs ?? await movimientos(db, desde, false)).filter((m) => m.fecha >= desde)
  const avs = avisos ?? await avisosCheques(db)
  const candidatos = proponerCargos(lista, { desde, tomados: new Set() }).map((p) => p.movimiento_id)
  const tomados = await tomadosDe(db, candidatos)
  for (const a of avs) { tomados.add(a.movimiento_id); if (a.comision_movimiento_id) tomados.add(a.comision_movimiento_id) }
  return proponerCargos(lista, { desde, tomados })
}

// ─── Registrar ────────────────────────────────────────────────────────────────

export interface ResultadoCargos {
  modo_propuesta: boolean
  propuestas: number
  registrados: number
  monto: number
  omitidos: number
  quedan: number
  errores: string[]
}

/**
 * Registra los cargos propuestos (todos, o los `ids` pedidos). Cada uno vuelve a controlarse en la
 * base (bancos_registrar_cargo): nunca dos veces, nunca uno que tomó otra tanda.
 */
export async function registrarCargos(db: SupabaseClient, p: { usuarioId: string | null; automatico: boolean; ids?: string[] | null }): Promise<ResultadoCargos> {
  const out: ResultadoCargos = { modo_propuesta: false, propuestas: 0, registrados: 0, monto: 0, omitidos: 0, quedan: 0, errores: [] }
  const ajustes = await leerAjustesCargos(db)
  if (!ajustes) { out.errores.push("Falta aplicar la migración 20261127e_bancos_control_diario.sql"); return out }
  out.modo_propuesta = ajustes.modo_propuesta
  let lista = await propuestas(db, ajustes, hoyISO())
  if (p.ids?.length) { const pedidos = new Set(p.ids); lista = lista.filter((x) => pedidos.has(x.movimiento_id)) }
  out.propuestas = lista.length
  out.quedan = Math.max(0, lista.length - MAX_POR_VEZ)
  for (const c of lista.slice(0, MAX_POR_VEZ)) {
    const { data, error } = await db.rpc("bancos_registrar_cargo", {
      p_mov_id: c.movimiento_id, p_categoria: c.cargo.tipo === "egreso" ? c.cargo.categoria : null, p_concepto: c.texto,
      p_concepto_id: c.concepto_id, p_usuario_id: p.usuarioId, p_automatico: p.automatico,
    })
    if (error) { out.errores.push(`${c.concepto} ${c.fecha}: ${error.message}`); continue }
    if ((data as Fila | null)?.success) { out.registrados++; out.monto += c.monto } else out.omitidos++
  }
  return out
}

/**
 * Después de importar / clasificar: en modo propuesta solo cuenta; en automático registra en nombre
 * del admin que lo apagó. Nunca lanza.
 */
export async function revisarCargos(db: SupabaseClient): Promise<ResultadoCargos | null> {
  try {
    const ajustes = await leerAjustesCargos(db)
    if (!ajustes) return null
    if (ajustes.modo_propuesta || !ajustes.confirma_usuario_id) {
      const lista = await propuestas(db, ajustes, hoyISO())
      return { modo_propuesta: true, propuestas: lista.length, registrados: 0, monto: 0, omitidos: 0, quedan: lista.length, errores: [] }
    }
    return await registrarCargos(db, { usuarioId: ajustes.confirma_usuario_id, automatico: true })
  } catch (e) {
    console.warn("[bancos/control] revisar cargos:", e)
    return null
  }
}

// ─── Panel del control diario ─────────────────────────────────────────────────

export interface PanelControl {
  instalado: boolean
  hoy: string
  ajustes: AjustesCargos & { desde_efectivo: string }
  cuentas: ControlCuenta[]
  totales: ReturnType<typeof totalesControl>
  cargos: (PropuestaCargo & { cuenta: string })[]
  /** Lo que no se pudo leer (migración de otra tanda sin aplicar, etc.) */
  avisos: string[]
}

/** Última vez que entró algo de cada cuenta: extracto / captura importado o saldo leído. */
async function actualizaciones(db: SupabaseClient, ids: string[], saldoAl: Map<string, string | null>): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  await Promise.all(ids.map(async (id) => {
    const { data } = await db.from("banco_extractos").select("created_at").eq("cuenta_bancaria_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    const xs = [data?.created_at as string | undefined, saldoAl.get(id) ?? undefined].filter((x): x is string => !!x)
    out[id] = xs.length ? xs.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null
  }))
  return out
}

export async function panelControl(db: SupabaseClient): Promise<PanelControl> {
  const hoy = hoyISO()
  const avisos: string[] = []
  await clasificarPendientes(db).catch(() => null)
  const ajustesLeidos = await leerAjustesCargos(db)
  if (!ajustesLeidos) avisos.push("Falta aplicar la migración 20261127e: los cargos del banco no se registran.")
  const ajustes = ajustesLeidos ?? { modo_propuesta: true, desde: null, confirma_usuario_id: null, cambiado_at: null }
  const desdeCargos = desdeDe(ajustes, hoy)
  const ventana = [desdeCargos, sumarDiasISO(hoy, -VENTANA_DIAS)].sort()[0]

  const [saldos, movs, avs] = await Promise.all([saldosBancos(db), movimientos(db, ventana, true), avisosCheques(db)])
  const cargos = ajustesLeidos ? await propuestas(db, ajustes, hoy, movs.filter((m) => m.estado_matching === "PENDIENTE"), avs) : []

  // Tandas 3 y 4: créditos sin identificar / propuestas / no aparecieron, y cheques demorados
  const [transf, cheques] = await Promise.all([
    import("@/lib/bancos/transferencias/servidor").then((m) => m.panelTransferencias(db)).catch((e) => { avisos.push(`Transferencias: ${e?.message ?? e}`); return null }),
    import("@/lib/bancos/cheques/servidor").then((m) => m.panelChequesBanco(db)).catch((e) => { avisos.push(`Cheques: ${e?.message ?? e}`); return null }),
  ])

  const idsCargos = new Set(cargos.map((c) => c.movimiento_id))
  const limiteVentana = sumarDiasISO(hoy, -VENTANA_DIAS)
  const cuentasCtl = saldos.map((s) => ({ id: s.cuenta_bancaria_id, nombre: s.cuenta }))
  const actualizado = await actualizaciones(db, cuentasCtl.map((c) => c.id), new Map(saldos.map((s) => [s.cuenta_bancaria_id, s.saldo_banco_al])))
  const cuentas = armarControl({
    hoy, cuentas: cuentasCtl,
    saldos: saldos.map((s) => ({ cuenta_bancaria_id: s.cuenta_bancaria_id, saldo_banco: s.saldo_banco, saldo_banco_al: s.saldo_banco_al, saldo_sistema: s.saldo_sistema })),
    actualizado,
    movs: movs.filter((m) => m.fecha >= limiteVentana || idsCargos.has(m.id)),
    cargos,
    sinIdentificar: (transf?.sin_identificar ?? []).map((s) => ({ movimiento_id: s.movimiento_id, con_propuesta: !!s.propuesta })),
    avisosCheques: avs,
    demorados: (cheques?.demorados ?? []).map((d) => ({ cuenta_bancaria_id: d.cuenta_banco_id ?? null, monto: d.monto })),
    noAparecieron: (transf?.no_aparecieron ?? []).map((t) => ({ cuenta_bancaria_id: t.cuenta_bancaria_id ?? null, monto: t.monto })),
  })
  const nombre = new Map(cuentasCtl.map((c) => [c.id, c.nombre]))
  return {
    instalado: !!ajustesLeidos, hoy, ajustes: { ...ajustes, desde_efectivo: desdeCargos },
    cuentas, totales: totalesControl(cuentas),
    cargos: cargos.map((c) => ({ ...c, cuenta: nombre.get(c.cuenta_bancaria_id) ?? "" })),
    avisos,
  }
}
