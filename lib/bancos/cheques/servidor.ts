/**
 * Cheques contra el banco (Tanda 4) — SOLO SERVIDOR. Las decisiones son las reglas puras de
 * ./reglas; acá se leen los datos, se anotan avisos y se aplica por la base
 * (cheque_banco_aplicar, migración 20261127d) que vuelve a controlar todo en una transacción.
 *
 * - Acreditación de depositados y débito de cheques propios: solo con UNA coincidencia. En modo
 *   propuesta (por defecto) NO se aplica: queda la propuesta para que el dueño la mire.
 * - Rechazos: siempre un aviso; la ND al cliente la confirma el dueño (nunca sale sola).
 * - Sin la migración aplicada no hace nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { hoyISO, sumarDiasISO } from "@/lib/formato"
import {
  clasificarLinea, comisionDe, decidirAcreditacion, decidirDebitoPropio, DIAS_ACREDITACION, DIAS_ALERTA, estaDemorado,
  numeroDeLinea, posiblesRechazados, sumarDiasHabiles,
  type ChequeDepositado, type ChequePropio, type ChequeTercero, type LineaBanco,
} from "./reglas"

type Fila = Record<string, any>

export interface AjustesChequesBanco { modo_propuesta: boolean; dias_alerta: number }

export interface ResultadoRevision {
  acreditados: number
  debitados: number
  propuestas: number
  rechazos: number
  sin_decidir: number
  errores: string[]
}

const VACIO: ResultadoRevision = { acreditados: 0, debitados: 0, propuestas: 0, rechazos: 0, sin_decidir: 0, errores: [] }

const faltaTabla = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(String(e.message ?? "")))

export async function leerAjustes(db: SupabaseClient): Promise<AjustesChequesBanco | null> {
  const { data, error } = await db.from("cheques_banco_ajustes").select("modo_propuesta, dias_alerta").eq("id", true).maybeSingle()
  if (error) { if (!faltaTabla(error)) console.warn("[cheques-banco] ajustes:", error.message); return null }
  // Sin fila: el modo seguro
  return { modo_propuesta: data?.modo_propuesta ?? true, dias_alerta: Number(data?.dias_alerta ?? DIAS_ALERTA) }
}

const aLinea = (m: Fila): LineaBanco => ({
  id: m.id, cuenta_bancaria_id: m.cuenta_bancaria_id, fecha: m.fecha, monto: Number(m.monto),
  descripcion: m.descripcion ?? null, concepto_banco: m.concepto_banco ?? null,
  referencia_externa: m.referencia_externa ?? null, saldo_banco: m.saldo_banco == null ? null : Number(m.saldo_banco),
})

/**
 * Revisa renglones del banco contra los cheques. `extractoId`: los de ese extracto (después de
 * importarlo); si no, los PENDIENTES de los últimos `dias` días (botón "Revisar").
 */
export async function revisarChequesContraBanco(
  db: SupabaseClient,
  p: { extractoId?: string | null; dias?: number; usuarioId?: string | null },
): Promise<ResultadoRevision> {
  const res: ResultadoRevision = { ...VACIO, errores: [] }
  const ajustes = await leerAjustes(db)
  if (!ajustes) return res

  // 1) Renglones a mirar
  let q = db.from("banco_extractos_movimientos")
    .select("id, cuenta_bancaria_id, fecha, monto, descripcion, concepto_banco, referencia_externa, saldo_banco, estado_matching")
    .eq("estado_matching", "PENDIENTE")
  q = p.extractoId ? q.eq("extracto_id", p.extractoId) : q.gte("fecha", sumarDiasISO(hoyISO(), -(p.dias ?? 30)))
  const { data: movs, error: movErr } = await q.limit(5000)
  if (movErr) { res.errores.push(movErr.message); return res }
  const lineas = ((movs ?? []) as Fila[]).map(aLinea)
  const deCheques = lineas.map((l) => ({ l, clase: clasificarLinea(l) })).filter((x) => x.clase && x.clase !== "comision")
  if (!deCheques.length) return res

  const cuentas = [...new Set(deCheques.map((x) => x.l.cuenta_bancaria_id))]
  const fechas = deCheques.map((x) => x.l.fecha).sort()
  const desde = fechas[0], hasta = fechas[fechas.length - 1]

  // 2) Contexto: todos los renglones de cheques de esos días (comisiones y otras acreditaciones),
  //    lo ya usado, los avisos que ya están y los cheques candidatos
  const [diaRes, vincRes, avRes, depRes, propRes, terRes] = await Promise.all([
    db.from("banco_extractos_movimientos")
      .select("id, cuenta_bancaria_id, fecha, monto, descripcion, concepto_banco, referencia_externa, saldo_banco, estado_matching")
      .in("cuenta_bancaria_id", cuentas).gte("fecha", desde).lte("fecha", hasta).limit(10000),
    db.from("cheques_banco_vinculos").select("movimiento_id, cheque_id, rol").in("movimiento_id", lineas.map((l) => l.id)),
    db.from("cheques_banco_avisos").select("movimiento_id, tipo, estado, cheque_ids").in("movimiento_id", lineas.map((l) => l.id)),
    db.from("cheques").select("id, numero, monto, fecha_deposito, cuenta_banco_id").eq("estado", "DEPOSITADO").in("cuenta_banco_id", cuentas),
    db.from("cheques").select("id, numero, monto, cuenta_banco_id").eq("tipo", "PROPIO").eq("estado", "ENTREGADO_A_PROVEEDOR"),
    db.from("cheques").select("id, numero, monto, fecha_deposito, cuenta_banco_id, estado").eq("tipo", "TERCERO")
      .in("estado", ["DEPOSITADO", "COBRADO"]).in("cuenta_banco_id", cuentas).gte("fecha_deposito", sumarDiasISO(desde, -120)),
  ])
  for (const r of [diaRes, vincRes, avRes, depRes, propRes, terRes]) {
    if (r.error) { if (!faltaTabla(r.error)) res.errores.push(r.error.message); return res }
  }
  const delDia = ((diaRes.data ?? []) as Fila[]).map((m) => ({ ...aLinea(m), estado: m.estado_matching as string }))
  const usados = new Set(((vincRes.data ?? []) as Fila[]).filter((v) => v.rol !== "rechazo").map((v) => v.movimiento_id as string))
  const avisos = new Set(((avRes.data ?? []) as Fila[]).map((a) => `${a.movimiento_id}|${a.tipo}`))
  // Cheques ya propuestos en una propuesta abierta: no se ofrecen para otro renglón
  const chequesPropuestos = new Set<string>()
  const { data: abiertas } = await db.from("cheques_banco_avisos").select("cheque_ids").eq("estado", "pendiente").in("tipo", ["acreditar", "debitar"])
  for (const a of (abiertas ?? []) as Fila[]) for (const id of (a.cheque_ids ?? []) as string[]) chequesPropuestos.add(id)

  const num = (c: Fila): Fila => ({ ...c, monto: Number(c.monto) })
  let depositados = ((depRes.data ?? []) as Fila[]).map(num).filter((c) => !chequesPropuestos.has(c.id)) as ChequeDepositado[]
  let propios = ((propRes.data ?? []) as Fila[]).map(num).filter((c) => !chequesPropuestos.has(c.id)) as ChequePropio[]
  const terceros = ((terRes.data ?? []) as Fila[]).map(num) as ChequeTercero[]

  const comisionesLibres = delDia.filter((m) => m.estado === "PENDIENTE" && !usados.has(m.id) && clasificarLinea(m) === "comision")
  const acreditacionesDelDia = (l: LineaBanco) => delDia.filter((m) => m.fecha === l.fecha && m.cuenta_bancaria_id === l.cuenta_bancaria_id && clasificarLinea(m) === "acreditacion")
  const comisionesTomadas = new Set<string>()

  const proponer = async (tipo: "acreditar" | "debitar" | "rechazo", l: LineaBanco, chequeIds: string[], comisionId: string | null) => {
    const { error } = await db.from("cheques_banco_avisos").insert({
      tipo, movimiento_id: l.id, cuenta_bancaria_id: l.cuenta_bancaria_id, fecha: l.fecha, monto: l.monto,
      descripcion: l.descripcion, cheque_ids: chequeIds, comision_movimiento_id: comisionId,
    })
    if (error && error.code !== "23505") { res.errores.push(error.message); return false }
    return !error
  }
  const aplicar = async (accion: "acreditar" | "debitar", l: LineaBanco, chequeIds: string[], comisionId: string | null) => {
    const { data, error } = await db.rpc("cheque_banco_aplicar", {
      p_movimiento_id: l.id, p_accion: accion, p_cheque_ids: chequeIds, p_comision_movimiento_id: comisionId,
      p_usuario_id: p.usuarioId ?? null, p_automatico: true,
    })
    if (error) { res.errores.push(error.message); return false }
    if (!(data as Fila | null)?.success) { res.sin_decidir++; return false }
    return true
  }

  // 3) Primero los renglones con número (más seguros), después el resto, por fecha
  const orden = [...deCheques].sort((a, b) => Number(!numeroDeLinea(a.l)) - Number(!numeroDeLinea(b.l)) || a.l.fecha.localeCompare(b.l.fecha))
  for (const { l, clase } of orden) {
    if (usados.has(l.id)) continue
    try {
      if (clase === "acreditacion") {
        if (avisos.has(`${l.id}|acreditar`)) continue
        const d = decidirAcreditacion(l, depositados)
        if (d.tipo !== "unico") { res.sin_decidir++; continue }
        const comision = d.cheques.length === 1 ? comisionDe(l, comisionesLibres.filter((c) => !comisionesTomadas.has(c.id)), acreditacionesDelDia(l)) : null
        if (comision) comisionesTomadas.add(comision)
        const ok = ajustes.modo_propuesta ? await proponer("acreditar", l, d.cheques, comision) : await aplicar("acreditar", l, d.cheques, comision)
        if (ok) {
          depositados = depositados.filter((c) => !d.cheques.includes(c.id))
          if (ajustes.modo_propuesta) res.propuestas++
          else res.acreditados += d.cheques.length
        } else if (comision) comisionesTomadas.delete(comision)
      } else if (clase === "debito_propio") {
        if (avisos.has(`${l.id}|debitar`)) continue
        const d = decidirDebitoPropio(l, propios)
        if (d.tipo !== "unico") { res.sin_decidir++; continue }
        const ok = ajustes.modo_propuesta ? await proponer("debitar", l, d.cheques, null) : await aplicar("debitar", l, d.cheques, null)
        if (ok) {
          propios = propios.filter((c) => !d.cheques.includes(c.id))
          if (ajustes.modo_propuesta) res.propuestas++
          else res.debitados++
        }
      } else if (clase === "rechazo") {
        if (avisos.has(`${l.id}|rechazo`)) continue
        // Solo el aviso: el dueño confirma el rechazo (y la ND) con el botón
        if (await proponer("rechazo", l, posiblesRechazados(l, terceros), null)) res.rechazos++
      }
    } catch (e) {
      res.errores.push(e instanceof Error ? e.message : String(e))
    }
  }
  return res
}

// ─── Datos del panel (/finanzas/cheques) y del vigía de Jarvis ──────────────

export interface PanelChequesBanco {
  instalado: boolean
  ajustes: AjustesChequesBanco
  cuentas: Array<{ id: string; nombre: string; saldo: number; en_clearing: number; cheques: number; proyectado: number; proxima: string | null }>
  demorados: Array<{ id: string; numero: string | null; banco: string | null; monto: number; cuenta: string; cuenta_banco_id: string | null; fecha_deposito: string; esperada: string }>
  avisos: Array<{
    id: string; tipo: "rechazo" | "acreditar" | "debitar"; fecha: string; monto: number; descripcion: string | null; cuenta: string
    cheques: Array<{ id: string; numero: string | null; banco: string | null; monto: number; cliente: string | null; estado: string }>
    con_comision: boolean
  }>
}

/** Feriados/puentes (los bancos no abren). Necesita el cliente admin: calendario_dias no se lee con la sesión. */
async function feriados(db: SupabaseClient, desde: string): Promise<Set<string>> {
  const { data, error } = await db.from("calendario_dias").select("fecha, tipo").gte("fecha", desde).in("tipo", ["feriado", "puente"])
  if (error) return new Set()
  return new Set(((data ?? []) as Fila[]).map((f) => String(f.fecha)))
}

export async function panelChequesBanco(db: SupabaseClient): Promise<PanelChequesBanco> {
  const ajustes = await leerAjustes(db)
  const vacio: PanelChequesBanco = { instalado: false, ajustes: { modo_propuesta: true, dias_alerta: DIAS_ALERTA }, cuentas: [], demorados: [], avisos: [] }
  if (!ajustes) return vacio
  const hoy = hoyISO()
  const [ctasRes, saldosRes, depRes, avRes, fer] = await Promise.all([
    db.from("cuentas_bancarias").select("id, nombre, banco, cheque_dias_acreditacion").eq("activo", true),
    db.from("saldos_financieros").select("cuenta_id, saldo").eq("cuenta_tipo", "BANCO"),
    db.from("cheques").select("id, numero, banco, monto, fecha_deposito, fecha_acreditacion_esperada, cuenta_banco_id").eq("estado", "DEPOSITADO"),
    db.from("cheques_banco_avisos").select("id, tipo, fecha, monto, descripcion, cuenta_bancaria_id, cheque_ids, comision_movimiento_id")
      .eq("estado", "pendiente").order("fecha", { ascending: false }).limit(100),
    feriados(db, sumarDiasISO(hoy, -60)),
  ])
  const ctas = ((ctasRes.data ?? []) as Fila[])
  const nombre = new Map(ctas.map((c) => [c.id as string, String(c.nombre ?? c.banco ?? "")]))
  const diasCta = new Map(ctas.map((c) => [c.id as string, Number(c.cheque_dias_acreditacion ?? DIAS_ACREDITACION) || DIAS_ACREDITACION]))
  const saldo = new Map<string, number>()
  for (const s of (saldosRes.data ?? []) as Fila[]) saldo.set(s.cuenta_id, (saldo.get(s.cuenta_id) ?? 0) + Number(s.saldo ?? 0))

  const deps = ((depRes.data ?? []) as Fila[]).map((c): Fila => ({
    ...c, monto: Number(c.monto),
    esperada: (c.fecha_acreditacion_esperada as string | null) ?? (c.fecha_deposito ? sumarDiasHabiles(c.fecha_deposito, diasCta.get(c.cuenta_banco_id) ?? DIAS_ACREDITACION, fer) : null),
  }))
  const cuentas = ctas.map((c) => {
    const suyos = deps.filter((d) => d.cuenta_banco_id === c.id)
    const en = suyos.reduce((a, d) => a + Math.abs(d.monto), 0)
    const s = saldo.get(c.id) ?? 0
    const proxima = suyos.map((d) => d.esperada).filter(Boolean).sort()[0] ?? null
    return { id: c.id as string, nombre: nombre.get(c.id) ?? "", saldo: s, en_clearing: en, cheques: suyos.length, proyectado: s + en, proxima }
  }).filter((c) => c.cheques > 0)

  const demorados = deps
    .filter((d) => estaDemorado(d.fecha_deposito, hoy, fer, ajustes.dias_alerta))
    .map((d) => ({ id: d.id, numero: d.numero ?? null, banco: d.banco ?? null, monto: d.monto, cuenta: nombre.get(d.cuenta_banco_id) ?? "", cuenta_banco_id: (d.cuenta_banco_id as string | null) ?? null, fecha_deposito: d.fecha_deposito, esperada: d.esperada ?? d.fecha_deposito }))
    .sort((a, b) => a.fecha_deposito.localeCompare(b.fecha_deposito))

  const avs = (avRes.data ?? []) as Fila[]
  const ids = [...new Set(avs.flatMap((a) => (a.cheque_ids ?? []) as string[]))]
  const chRes = ids.length ? await db.from("cheques").select("id, numero, banco, monto, estado, cliente_origen_id").in("id", ids) : { data: [] as Fila[] }
  const chs = new Map(((chRes.data ?? []) as Fila[]).map((c) => [c.id as string, c]))
  const cliIds = [...new Set([...chs.values()].map((c) => c.cliente_origen_id).filter(Boolean))]
  const cliRes = cliIds.length ? await db.from("clientes").select("id, nombre").in("id", cliIds) : { data: [] as Fila[] }
  const cli = new Map(((cliRes.data ?? []) as Fila[]).map((c) => [c.id as string, String(c.nombre ?? "")]))

  const avisos = avs.map((a) => ({
    id: a.id, tipo: a.tipo, fecha: a.fecha, monto: Number(a.monto ?? 0), descripcion: a.descripcion ?? null,
    cuenta: nombre.get(a.cuenta_bancaria_id) ?? "", con_comision: !!a.comision_movimiento_id,
    cheques: ((a.cheque_ids ?? []) as string[]).map((id) => chs.get(id)).filter(Boolean).map((c) => ({
      id: c!.id, numero: c!.numero ?? null, banco: c!.banco ?? null, monto: Number(c!.monto), cliente: cli.get(c!.cliente_origen_id) ?? null, estado: String(c!.estado),
    })),
  }))
  return { instalado: true, ajustes, cuentas, demorados, avisos }
}
