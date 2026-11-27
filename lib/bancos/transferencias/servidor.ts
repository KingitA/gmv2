/**
 * Transferencias de clientes ↔ créditos del banco (Tanda 3, 27/11/2026). SOLO SERVIDOR.
 * La regla es pura (./matching.ts, con pruebas). Acá: leer la base, confirmar por el mismo camino
 * que /caja y aprender quién paga por quién.
 *
 *  - Modo propuesta (por defecto encendido): solo se dice "se confirmaría con…"; no se confirma nada.
 *  - Modo automático: confirma sola la transferencia informada cuando hay UNA coincidencia exacta.
 *    cobranza_confirmar va dentro de banco_transferencia_conciliar (todo o nada); después,
 *    procesarPostConfirmacion + débito de billetera, como el botón Confirmar de /caja.
 *  - Créditos sin identificar: quedan pendientes. NADA toca una cuenta corriente hasta "Vincular".
 */
import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"
import { debitarBilleteraCobroDigital } from "@/lib/cobranzas/billetera-digital"
import { crearCobranza } from "@/lib/cobranzas/crear"
import { diasEspeciales } from "@/lib/viajes/calendario-laboral"
import { fetchByIds } from "@/lib/supabase/fetch-all"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { fechaISO, hoyISO, mismoCuit, normalizarCuit, sumarDiasISO } from "@/lib/formato"
import {
  emparejar, esCreditoDeCliente, noAparecio, normalizarNombrePagador, sugerirClientes,
  type CreditoBanco, type Decision, type Pagador, type TransferenciaInformada,
} from "./matching"

const DIAS_ATRAS = 45

export interface AjustesTransferencias {
  modo_propuesta: boolean
  confirma_usuario_id: string | null
  cambiado_at: string | null
}

export const faltaTablaTransferencias = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  return err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "PGRST202"
    || /(clientes_pagadores|banco_transferencias_|banco_transferencia_conciliar)/.test(String(err?.message ?? ""))
      && /does not exist|could not find/i.test(String(err?.message ?? ""))
}

export async function leerAjustes(db: SupabaseClient): Promise<AjustesTransferencias | null> {
  const { data, error } = await db.from("banco_transferencias_ajustes").select("modo_propuesta, confirma_usuario_id, cambiado_at").eq("id", true).maybeSingle()
  if (error) { if (faltaTablaTransferencias(error)) return null; throw new Error(error.message) }
  return { modo_propuesta: data?.modo_propuesta !== false, confirma_usuario_id: data?.confirma_usuario_id ?? null, cambiado_at: data?.cambiado_at ?? null }
}

export async function cambiarModo(db: SupabaseClient, propuesta: boolean, usuarioId: string): Promise<void> {
  const { error } = await db.from("banco_transferencias_ajustes").upsert({
    id: true, modo_propuesta: propuesta, confirma_usuario_id: propuesta ? null : usuarioId, cambiado_por: usuarioId, cambiado_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

// ─── Lectura ────────────────────────────────────────────────────────────────────────────

interface Credito extends CreditoBanco { hora?: string | null; fuente_detalle?: string | null; banco_nombre?: string }
interface Informada extends TransferenciaInformada { cliente_nombre: string; tipo_pago: string; pago_fecha: string | null }

interface Datos {
  hoy: string
  creditos: Credito[]
  informadas: Informada[]
  pagadores: Pagador[]
  clientesPorCuit: { id: string; nombre: string; cuit: string | null; localidad: string | null }[]
  feriados: Set<string>
  cuitPropio: string | null
  ultimaLectura: Map<string, string>
  cuentas: Map<string, string>
}

const COLS_MOV = "id, cuenta_bancaria_id, fecha, monto, descripcion, estado_matching"
const COLS_MOV_T1 = `${COLS_MOV}, hora, contraparte_nombre, contraparte_cuit, contraparte_cbu, concepto_banco, fuente_detalle`

/** soloInformadas: lo justo para las marcas de /caja (sin créditos ni pagadores). */
async function cargar(db: SupabaseClient, soloInformadas = false): Promise<Datos> {
  const hoy = hoyISO()
  const desde = sumarDiasISO(hoy, -DIAS_ATRAS)

  const movs = (cols: string) => db.from("banco_extractos_movimientos").select(cols)
    .eq("estado_matching", "PENDIENTE").gt("monto", 0).gte("fecha", desde).order("fecha").limit(2000)
  let movRes = soloInformadas ? { data: [], error: null } : await movs(COLS_MOV_T1)
  if (movRes.error && faltaLaColumna(movRes.error)) movRes = await movs(COLS_MOV)
  if (movRes.error) throw new Error(movRes.error.message)

  const [pagosRes, rendRes, cuentasRes, empresaRes, feriadosArr] = await Promise.all([
    db.from("pagos_clientes")
      .select("id, cliente_id, fecha_pago, estado, created_at, clientes(nombre, cuit), pagos_detalle(id, tipo_pago, monto, cuenta_bancaria_id, fecha_transferencia, color_cheque)")
      .in("estado", ["pendiente", "pendiente_rendicion"]).limit(3000),
    db.from("rendiciones").select("rendicion_items(pago_id)").eq("estado", "abierta"),
    db.from("cuentas_bancarias").select("id, nombre, banco"),
    db.from("configuracion_empresa").select("cuit").limit(1).maybeSingle(),
    diasEspeciales(db, sumarDiasISO(desde, -10), sumarDiasISO(hoy, 10)).catch(() => []),
  ])
  if (pagosRes.error) throw new Error(pagosRes.error.message)

  const cuentas = new Map(((cuentasRes.data ?? []) as Record<string, any>[]).map((c) => [c.id as string, (c.nombre || c.banco || "Banco") as string]))
  const creditos: Credito[] = ((movRes.data ?? []) as unknown as Record<string, any>[]).map((m) => ({
    id: m.id, cuenta_bancaria_id: m.cuenta_bancaria_id, fecha: String(m.fecha).slice(0, 10), monto: Number(m.monto),
    descripcion: m.descripcion ?? null, concepto_banco: m.concepto_banco ?? null, contraparte_nombre: m.contraparte_nombre ?? null,
    contraparte_cuit: m.contraparte_cuit ?? null, contraparte_cbu: m.contraparte_cbu ?? null, hora: m.hora ?? null,
    fuente_detalle: m.fuente_detalle ?? null, banco_nombre: cuentas.get(m.cuenta_bancaria_id) ?? "Banco",
  }))

  // Pagos dentro de una rendición abierta: se confirman con su rendición, no con el banco
  const enRendicion = new Set(((rendRes.data ?? []) as Record<string, any>[]).flatMap((r) => (r.rendicion_items ?? []).map((i: any) => i.pago_id)))
  const esDigital = (d: any) => d.tipo_pago === "transferencia" || d.tipo_pago === "deposito" || (d.tipo_pago === "cheque" && d.color_cheque === "ECHEQ")
  const informadas: Informada[] = []
  for (const p of (pagosRes.data ?? []) as Record<string, any>[]) {
    if (enRendicion.has(p.id)) continue
    const detalles: any[] = p.pagos_detalle ?? []
    if (p.estado === "pendiente_rendicion" && !detalles.every(esDigital)) continue
    for (const d of detalles) {
      if (d.tipo_pago !== "transferencia" && d.tipo_pago !== "deposito") continue
      informadas.push({
        pago_id: p.id, detalle_id: d.id, cliente_id: p.cliente_id, cliente_cuit: p.clientes?.cuit ?? null, cliente_nombre: p.clientes?.nombre ?? "Cliente",
        cuenta_bancaria_id: d.cuenta_bancaria_id ?? null, monto: Number(d.monto), tipo_pago: d.tipo_pago,
        fecha: String(d.fecha_transferencia || p.fecha_pago || fechaISO(p.created_at) || hoy).slice(0, 10),
        pago_fecha: p.fecha_pago ?? null, solo_este_medio: detalles.length === 1,
      })
    }
  }

  // Lo que ya está vinculado no se vuelve a usar
  const [vincMovs, vincDets] = await Promise.all([
    creditos.length ? fetchByIds<any>((c) => db.from("banco_transferencias_vinculos").select("movimiento_id").in("movimiento_id", c), creditos.map((c) => c.id)) : [],
    informadas.length ? fetchByIds<any>((c) => db.from("banco_transferencias_vinculos").select("pago_detalle_id").in("pago_detalle_id", c), informadas.map((i) => i.detalle_id)) : [],
  ])
  const movsVinc = new Set(vincMovs.map((v) => v.movimiento_id))
  const detsVinc = new Set(vincDets.map((v) => v.pago_detalle_id))
  for (const c of creditos) c.vinculado = movsVinc.has(c.id)
  for (const i of informadas) i.vinculada = detsVinc.has(i.detalle_id)

  // Pagadores: de los clientes con transferencias informadas y de los CUIT / nombres que mandó el banco
  const clienteIds = soloInformadas ? [] : [...new Set(informadas.map((i) => i.cliente_id))]
  const cuits = [...new Set(creditos.map((c) => normalizarCuit(c.contraparte_cuit)).filter((x): x is string => !!x))]
  const nombres = [...new Set(creditos.map((c) => normalizarNombrePagador(c.contraparte_nombre)).filter((x): x is string => !!x))]
  const COLS_P = "cliente_id, pagador_cuit, pagador_nombre_normalizado, veces, ultimo_uso"
  const [pagCli, pagCuit, pagNom, cliCuit] = await Promise.all([
    clienteIds.length ? fetchByIds<any>((c) => db.from("clientes_pagadores").select(COLS_P).in("cliente_id", c), clienteIds) : [],
    cuits.length ? fetchByIds<any>((c) => db.from("clientes_pagadores").select(COLS_P).in("pagador_cuit", c), cuits) : [],
    nombres.length ? fetchByIds<any>((c) => db.from("clientes_pagadores").select(COLS_P).in("pagador_nombre_normalizado", c), nombres) : [],
    cuits.length ? fetchByIds<any>((c) => db.from("clientes").select("id, nombre, cuit, localidad").in("cuit", c).is("eliminado_at", null), cuits) : [],
  ])
  const vistos = new Set<string>()
  const pagadores: Pagador[] = []
  for (const p of [...pagCli, ...pagCuit, ...pagNom] as Pagador[]) {
    const k = `${p.cliente_id}|${p.pagador_cuit ?? ""}|${p.pagador_nombre_normalizado ?? ""}`
    if (!vistos.has(k)) { vistos.add(k); pagadores.push(p) }
  }

  // Hasta qué día se leyó cada cuenta (para no avisar "no apareció" de una cuenta sin cargar)
  const ultimaLectura = new Map<string, string>()
  const cuentasUsadas = [...new Set(informadas.map((i) => i.cuenta_bancaria_id).filter((x): x is string => !!x))]
  await Promise.all(cuentasUsadas.map(async (id) => {
    const { data } = await db.from("banco_extractos_movimientos").select("fecha").eq("cuenta_bancaria_id", id).order("fecha", { ascending: false }).limit(1).maybeSingle()
    if (data?.fecha) ultimaLectura.set(id, String(data.fecha).slice(0, 10))
  }))

  const feriados = new Set((feriadosArr as { fecha: string; tipo: string; en_fuente: boolean }[])
    .filter((d) => (d.tipo === "feriado" || d.tipo === "puente") && d.en_fuente).map((d) => d.fecha))

  return {
    hoy, creditos, informadas, pagadores, clientesPorCuit: cliCuit, feriados,
    cuitPropio: normalizarCuit(empresaRes.data?.cuit ?? null), ultimaLectura, cuentas,
  }
}

// ─── Confirmar / vincular ───────────────────────────────────────────────────────────────

export class ErrorTransferencia extends Error {
  constructor(message: string, public status = 409) { super(message) }
}

async function aprenderPagador(db: SupabaseClient, clienteId: string, mov: Credito, origen: "manual" | "aprendido", usuarioId: string) {
  const cuit = normalizarCuit(mov.contraparte_cuit)
  const nombreNorm = normalizarNombrePagador(mov.contraparte_nombre)
  if (!cuit && !nombreNorm) return
  try {
    const { data: cli } = await db.from("clientes").select("cuit").eq("id", clienteId).maybeSingle()
    if (cuit && cli?.cuit && mismoCuit(cli.cuit, cuit)) return // el CUIT del cliente ya cuenta como pagador
    let q = db.from("clientes_pagadores").select("id, veces, pagador_nombre, banco, cbu").eq("cliente_id", clienteId)
    q = cuit ? q.eq("pagador_cuit", cuit) : q.is("pagador_cuit", null).eq("pagador_nombre_normalizado", nombreNorm!)
    const { data: ya } = await q.limit(1).maybeSingle()
    const ahora = new Date().toISOString()
    if (ya) {
      await db.from("clientes_pagadores").update({
        veces: Number(ya.veces ?? 0) + 1, ultimo_uso: ahora,
        pagador_nombre: ya.pagador_nombre ?? mov.contraparte_nombre ?? null, cbu: ya.cbu ?? mov.contraparte_cbu ?? null,
        banco: ya.banco ?? mov.banco_nombre ?? null,
      }).eq("id", ya.id)
    } else {
      await db.from("clientes_pagadores").insert({
        cliente_id: clienteId, pagador_cuit: cuit, pagador_nombre: mov.contraparte_nombre ?? null, pagador_nombre_normalizado: nombreNorm,
        cbu: mov.contraparte_cbu ?? null, banco: mov.banco_nombre ?? null, veces: 1, ultimo_uso: ahora, origen, creado_por: usuarioId,
      })
    }
  } catch (e) {
    console.warn("[bancos] no se pudo aprender el pagador:", e) // accesorio: no frena la confirmación
  }
}

async function leerMovimiento(db: SupabaseClient, movId: string): Promise<Credito> {
  let r = await db.from("banco_extractos_movimientos").select(COLS_MOV_T1).eq("id", movId).maybeSingle()
  if (r.error && faltaLaColumna(r.error)) r = await db.from("banco_extractos_movimientos").select(COLS_MOV).eq("id", movId).maybeSingle()
  if (r.error) throw new Error(r.error.message)
  const m = r.data as Record<string, any> | null
  if (!m) throw new ErrorTransferencia("Movimiento del banco no encontrado.", 404)
  const { data: cta } = await db.from("cuentas_bancarias").select("nombre, banco").eq("id", m.cuenta_bancaria_id).maybeSingle()
  return {
    id: m.id, cuenta_bancaria_id: m.cuenta_bancaria_id, fecha: String(m.fecha).slice(0, 10), monto: Number(m.monto), descripcion: m.descripcion ?? null,
    concepto_banco: m.concepto_banco ?? null, contraparte_nombre: m.contraparte_nombre ?? null, contraparte_cuit: m.contraparte_cuit ?? null,
    contraparte_cbu: m.contraparte_cbu ?? null, fuente_detalle: m.fuente_detalle ?? null, banco_nombre: cta?.nombre || cta?.banco || "Banco",
    vinculado: m.estado_matching !== "PENDIENTE",
  }
}

/** Vincula el crédito con la transferencia y confirma el cobro (el mismo camino que /caja). */
async function confirmarConBanco(
  db: SupabaseClient,
  a: { mov: Credito; pagoId: string; detalleId: string; clienteId: string; usuarioId: string; origen: "auto" | "existente" | "nuevo" },
): Promise<{ numero_recibo: string | null; bonificacion_error: string | null }> {
  const { data, error } = await db.rpc("banco_transferencia_conciliar", {
    p_mov_id: a.mov.id, p_pago_id: a.pagoId, p_detalle_id: a.detalleId, p_usuario_id: a.usuarioId, p_origen: a.origen,
  })
  if (error) {
    if (faltaTablaTransferencias(error)) throw new ErrorTransferencia("Falta aplicar la migración 20261127c_bancos_transferencias_clientes.sql.", 503)
    throw new ErrorTransferencia(error.message.replace(/^.*?banco_transferencia_conciliar:\s*/, ""))
  }
  // Lo accesorio de la confirmación, igual que /caja: comisiones, 10 % contado y billetera
  const post = await procesarPostConfirmacion(db, db, { pagoId: a.pagoId, usuarioId: a.usuarioId })
  await debitarBilleteraCobroDigital(db, a.pagoId, a.usuarioId)
  await aprenderPagador(db, a.clienteId, a.mov, a.origen === "auto" ? "aprendido" : "manual", a.usuarioId)
  return { numero_recibo: (data as any)?.numero_recibo ?? null, bonificacion_error: post.bonificacion_error }
}

export interface ResultadoRevision {
  modo_propuesta: boolean
  confirmadas: number
  propuestas: number
  errores: string[]
}

/**
 * Cruza los créditos pendientes con las transferencias informadas. En modo propuesta no confirma
 * nada. Lo llaman la importación del extracto (hook en lib/finanzas/extractos-import.ts) y /caja.
 * Nunca lanza.
 */
export async function revisarTransferencias(db: SupabaseClient = createAdminClient()): Promise<ResultadoRevision> {
  const out: ResultadoRevision = { modo_propuesta: true, confirmadas: 0, propuestas: 0, errores: [] }
  try {
    const ajustes = await leerAjustes(db)
    if (!ajustes) return out // sin la migración: no hace nada
    const datos = await cargar(db)
    const decisiones = decidir(datos)
    const aConfirmar = decisiones.filter((d): d is Extract<Decision, { accion: "confirmar" }> => d.accion === "confirmar")
    out.propuestas = aConfirmar.length
    out.modo_propuesta = ajustes.modo_propuesta || !ajustes.confirma_usuario_id
    if (out.modo_propuesta) return out
    const porId = new Map(datos.creditos.map((c) => [c.id, c]))
    for (const d of aConfirmar) {
      try {
        await confirmarConBanco(db, {
          mov: porId.get(d.movimiento_id)!, pagoId: d.transferencia.pago_id, detalleId: d.transferencia.detalle_id,
          clienteId: d.transferencia.cliente_id, usuarioId: ajustes.confirma_usuario_id!, origen: "auto",
        })
        out.confirmadas++
      } catch (e) {
        out.errores.push(e instanceof Error ? e.message : String(e))
      }
    }
  } catch (e) {
    console.error("[bancos] revisar transferencias:", e)
    out.errores.push(e instanceof Error ? e.message : String(e))
  }
  return out
}

function decidir(d: Datos): Decision[] {
  const opts = { feriados: d.feriados, cuitPropio: d.cuitPropio }
  return emparejar(d.creditos.filter((c) => esCreditoDeCliente(c, opts)), d.informadas, d.pagadores, opts)
}

/** "Vincular" con una transferencia ya informada (pendiente). */
export async function vincularExistente(db: SupabaseClient, a: { movimientoId: string; pagoId: string; detalleId: string; usuarioId: string }) {
  const mov = await leerMovimiento(db, a.movimientoId)
  const { data: p } = await db.from("pagos_clientes").select("cliente_id").eq("id", a.pagoId).maybeSingle()
  if (!p) throw new ErrorTransferencia("Cobro no encontrado.", 404)
  return confirmarConBanco(db, { mov, pagoId: a.pagoId, detalleId: a.detalleId, clienteId: p.cliente_id, usuarioId: a.usuarioId, origen: "existente" })
}

/** "Vincular" eligiendo el cliente: se crea el cobro con el crédito del banco como transferencia y se confirma. */
export async function vincularNuevo(db: SupabaseClient, a: { movimientoId: string; clienteId: string; usuarioId: string }) {
  const mov = await leerMovimiento(db, a.movimientoId)
  if (mov.vinculado || mov.monto <= 0) throw new ErrorTransferencia("Ese movimiento del banco ya está vinculado o conciliado.")
  const h = createHash("md5").update(`banco-credito:${mov.id}:${a.clienteId}`).digest("hex")
  const clave = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  const quien = [mov.contraparte_nombre, mov.contraparte_cuit].filter(Boolean).join(" ")
  const { pago_id } = await crearCobranza(db, {
    idempotency_key: clave, cliente_id: a.clienteId, monto: mov.monto, fecha_pago: mov.fecha, estado: "pendiente",
    cobrador_tipo: "oficina", creado_por: a.usuarioId,
    observaciones: `Transferencia vista en el banco${quien ? ` (${quien})` : ""}`,
    detalles: [{
      tipo_pago: "transferencia", monto: mov.monto, cuenta_bancaria_id: mov.cuenta_bancaria_id, fecha_transferencia: mov.fecha,
      banco: mov.banco_nombre ?? null, cuit_emisor: normalizarCuit(mov.contraparte_cuit), referencia: (mov.concepto_banco || mov.descripcion || "").slice(0, 100) || null,
    }],
  })
  const { data: det } = await db.from("pagos_detalle").select("id").eq("pago_id", pago_id).limit(1).maybeSingle()
  if (!det) throw new Error("No se encontró la transferencia del cobro recién creado.")
  return confirmarConBanco(db, { mov, pagoId: pago_id, detalleId: det.id, clienteId: a.clienteId, usuarioId: a.usuarioId, origen: "nuevo" })
}

// ─── Lo que muestra /caja ───────────────────────────────────────────────────────────────

export interface PanelTransferencias {
  disponible: boolean
  modo_propuesta: boolean
  sin_identificar: {
    movimiento_id: string; fecha: string; hora: string | null; monto: number; banco: string
    nombre: string | null; cuit: string | null; concepto: string | null
    /** En propuesta: con qué cobro se confirmaría */
    propuesta: { pago_id: string; detalle_id: string; cliente_id: string; cliente: string; por: string } | null
    /** Por qué no se confirma solo */
    motivo: string | null
    sugerencias: { cliente_id: string; nombre: string; localidad: string | null; por: string }[]
    informadas: { pago_id: string; detalle_id: string; cliente: string; fecha: string; banco: string }[]
  }[]
  confirmadas: { movimiento_id: string; pago_id: string; cliente: string; monto: number; fecha: string; banco: string; origen: string; at: string }[]
  no_aparecieron: { pago_id: string; cliente: string; monto: number; fecha: string; banco: string }[]
}

const MOTIVOS: Record<string, string> = {
  varias: "Hay más de una transferencia informada igual",
  otros_medios: "El cobro tiene otros medios: confirmalo a mano",
  compartida: "Hay dos créditos iguales para la misma transferencia",
}

export async function panelTransferencias(db: SupabaseClient): Promise<PanelTransferencias> {
  const vacio: PanelTransferencias = { disponible: false, modo_propuesta: true, sin_identificar: [], confirmadas: [], no_aparecieron: [] }
  const ajustes = await leerAjustes(db)
  if (!ajustes) return vacio
  const d = await cargar(db)
  const decisiones = new Map(decidir(d).map((x) => [x.movimiento_id, x]))
  const opts = { feriados: d.feriados, cuitPropio: d.cuitPropio }

  // Nombres de los clientes sugeridos por pagadores
  const sugeridosIds = [...new Set(d.pagadores.map((p) => p.cliente_id))]
  const clientesSug = sugeridosIds.length ? await fetchByIds<any>((c) => db.from("clientes").select("id, nombre, localidad").in("id", c).is("eliminado_at", null), sugeridosIds) : []
  const cliente = new Map<string, { nombre: string; localidad: string | null }>()
  for (const c of [...clientesSug, ...d.clientesPorCuit]) cliente.set(c.id, { nombre: c.nombre, localidad: c.localidad ?? null })

  const sin_identificar: PanelTransferencias["sin_identificar"] = []
  for (const c of d.creditos) {
    if (c.vinculado || !esCreditoDeCliente(c, opts)) continue
    const dec = decisiones.get(c.id)
    const prop = dec?.accion === "confirmar" ? dec.transferencia : null
    const informada = prop ? d.informadas.find((i) => i.detalle_id === prop.detalle_id) : null
    // Transferencias informadas con ese monto (cualquier cuenta, ±10 días): para vincular a mano
    const parecidas = d.informadas
      .filter((i) => !i.vinculada && i.solo_este_medio && Math.abs(i.monto - c.monto) < 1 && Math.abs(Date.parse(i.fecha) - Date.parse(c.fecha)) <= 10 * 86_400_000)
      .slice(0, 6)
    sin_identificar.push({
      movimiento_id: c.id, fecha: c.fecha, hora: c.hora ?? null, monto: c.monto, banco: c.banco_nombre ?? "Banco",
      nombre: c.contraparte_nombre ?? null, cuit: c.contraparte_cuit ?? null, concepto: c.concepto_banco || c.descripcion || null,
      propuesta: prop && informada ? { pago_id: prop.pago_id, detalle_id: prop.detalle_id, cliente_id: prop.cliente_id, cliente: informada.cliente_nombre, por: dec?.accion === "confirmar" && dec.por === "pagador" ? "por quien pagó" : "única coincidencia" } : null,
      motivo: dec?.accion === "nada" ? MOTIVOS[dec.motivo] ?? null : null,
      sugerencias: sugerirClientes(c, d.pagadores, d.clientesPorCuit).slice(0, 5).map((s) => ({
        cliente_id: s.cliente_id, nombre: cliente.get(s.cliente_id)?.nombre ?? "Cliente", localidad: cliente.get(s.cliente_id)?.localidad ?? null,
        por: s.por === "pagador" ? `pagó ${s.veces} vez${s.veces === 1 ? "" : "es"}` : "mismo CUIT",
      })),
      informadas: parecidas.map((i) => ({ pago_id: i.pago_id, detalle_id: i.detalle_id, cliente: i.cliente_nombre, fecha: i.fecha, banco: d.cuentas.get(i.cuenta_bancaria_id ?? "") ?? "sin cuenta" })),
    })
  }
  sin_identificar.sort((a, b) => b.fecha.localeCompare(a.fecha))

  const no_aparecieron = d.informadas
    .filter((i) => noAparecio(i, d.hoy, i.cuenta_bancaria_id ? d.ultimaLectura.get(i.cuenta_bancaria_id) : null, d.feriados))
    .map((i) => ({ pago_id: i.pago_id, cliente: i.cliente_nombre, monto: i.monto, fecha: i.fecha, banco: d.cuentas.get(i.cuenta_bancaria_id ?? "") ?? "Banco" }))

  // Confirmadas con el banco en los últimos 7 días
  const { data: vinc } = await db.from("banco_transferencias_vinculos")
    .select("movimiento_id, pago_id, origen, created_at, pagos_clientes(monto, clientes(nombre)), banco_extractos_movimientos(fecha, monto, cuenta_bancaria_id)")
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(100)
  const confirmadas = ((vinc ?? []) as Record<string, any>[]).map((v) => ({
    movimiento_id: v.movimiento_id, pago_id: v.pago_id, cliente: v.pagos_clientes?.clientes?.nombre ?? "Cliente",
    monto: Number(v.banco_extractos_movimientos?.monto ?? v.pagos_clientes?.monto ?? 0), fecha: String(v.banco_extractos_movimientos?.fecha ?? "").slice(0, 10),
    banco: d.cuentas.get(v.banco_extractos_movimientos?.cuenta_bancaria_id) ?? "Banco", origen: v.origen, at: v.created_at,
  }))

  return { disponible: true, modo_propuesta: ajustes.modo_propuesta || !ajustes.confirma_usuario_id, sin_identificar, confirmadas, no_aparecieron }
}

/**
 * Marcas para las filas de /caja: cobros confirmados por el banco y transferencias informadas que no
 * aparecieron. Nunca lanza (sin la migración devuelve vacío).
 */
export async function marcasBancoParaCaja(db: SupabaseClient, pagoIds: string[]): Promise<{ porBanco: Set<string>; noAparecio: Set<string> }> {
  const out = { porBanco: new Set<string>(), noAparecio: new Set<string>() }
  try {
    if (pagoIds.length) {
      const v = await fetchByIds<any>((c) => db.from("banco_transferencias_vinculos").select("pago_id").in("pago_id", c), pagoIds)
      for (const x of v) out.porBanco.add(x.pago_id)
    }
    if (!(await leerAjustes(db))) return out
    const d = await cargar(db, true)
    for (const i of d.informadas) if (noAparecio(i, d.hoy, i.cuenta_bancaria_id ? d.ultimaLectura.get(i.cuenta_bancaria_id) : null, d.feriados)) out.noAparecio.add(i.pago_id)
  } catch (e) {
    if (!faltaTablaTransferencias(e)) console.warn("[bancos] marcas para caja:", e)
  }
  return out
}
