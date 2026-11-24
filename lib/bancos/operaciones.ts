/**
 * Operaciones bancarias con Credicoop (Tanda 2-A). SOLO SERVIDOR.
 *
 * Cada operación se GUARDA antes de salir hacia el banco (tabla bancos_operaciones, migración
 * 20261119d) con su clave de idempotencia (id_origen). Así:
 *   - un mismo pago no se manda dos veces (índice único por medio de pago / e-cheq / VEP);
 *   - si se corta la comunicación, queda "error" (en duda) y con "Actualizar estado" se le
 *     pregunta al banco si había entrado, ANTES de permitir reenviar.
 *
 * Todo va en la modalidad "con firma": el banco la deja esperando la firma con token. El sistema
 * NO da el pago por hecho hasta que el banco dice que la procesó.
 *
 * Qué puede y qué no puede hacerse con la orden mientras hay una operación con el banco lo decide
 * la BASE (guardias de la migración 20261119d: confirmar, cancelar, eliminar, cambiar el importe,
 * y el candado entre mandar y confirmar). Acá solo se pregunta antes, para avisar con claridad.
 *
 * SOLO lo hecho contra el banco REAL (ambiente = "produccion") cuenta como plata: lo del simulador
 * y lo del banco de prueba no bloquea ni habilita la confirmación, y no deja ninguna referencia
 * en la orden de pago real.
 */
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { hoyISO, moneda, sumarDiasISO } from "@/lib/formato"
import { importarExtracto } from "@/lib/finanzas/extractos-import"
import { faltaLaFuncion } from "@/lib/utils/migracion-pendiente"
import { clienteCredicoop, estadoConexion, simuladorEnUso, SIMULADOR_FIRMA_A_LOS_SEGUNDOS, type AmbienteCredicoop } from "./credicoop/config"
import {
  armarEmisionEcheq, armarGestionEcheq, armarListaEcheqs, armarListaVeps, armarPagoVep, armarTransferencia, cbuValido, cuitDeOnce,
  endosoSegunEcheq, ErrorCredicoop, estaHecha, estadoBancoConocido, estadoEcheq, type EstadoOperacion, type ResultadoOperacion,
} from "./credicoop/nucleo"

export type TipoOperacion = "transferencia" | "echeq_emision" | "echeq_endoso" | "vep"
type Fila = Record<string, any>

export const TIPO_NOMBRE: Record<TipoOperacion, string> = {
  transferencia: "Transferencia", echeq_emision: "Emisión de e-cheq", echeq_endoso: "Endoso de e-cheq", vep: "Pago de VEP",
}

/** Minutos que se espera, después de un corte, antes de aceptar que el banco "no tiene" la operación. */
export const MINUTOS_PARA_DAR_POR_NO_ENTRADA = 15

/** La tabla o la función todavía no existen (falta aplicar la migración 20261119d). */
export const faltaTablaBancos = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  return err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "PGRST202" || err?.code === "42883"
    || (/bancos_/.test(String(err?.message ?? "")) && /does not exist|could not find/i.test(String(err?.message ?? "")))
}
export const AVISO_SIN_TABLA = "Falta aplicar la migración 20261119d_bancos_operaciones.sql: todavía no se pueden mandar operaciones al banco."

/**
 * ¿Esta cuenta bancaria se opera por la API de Credicoop? SOLO si está habilitada de forma
 * explícita (cuentas_bancarias.api_banco = 'credicoop'). Que el nombre del banco diga
 * "Credicoop" no alcanza: nadie manda plata por una cuenta que no se habilitó a propósito.
 */
export const esCuentaCredicoop = (c: Fila | null | undefined) => !!c && c.api_banco === "credicoop"

/** Error que se le muestra tal cual a la persona (dato que falta, estado que no corresponde…). */
export class ErrorOperacion extends Error {
  name = "ErrorOperacion"
  constructor(mensaje: string, public status = 422, public extra: Fila = {}) { super(mensaje) }
}

/** Un corte de la base por una de las guardias (mensaje ya escrito para la persona). */
const esGuardia = (e: unknown) => (e as { code?: string } | null)?.code === "P0001"

// ─── Qué se puede mandar de una orden de pago ──────────────────────────────

export interface PagoEnviable {
  detalle_id: string
  tipo: TipoOperacion
  tipo_nombre: string
  banco: string
  cuenta: string | null
  cuenta_cbu: string | null
  /** Endoso con más de una cuenta de Credicoop habilitada: hay que elegir cuál */
  cuentas_a_elegir: Array<{ id: string; nombre: string }>
  beneficiario: string
  beneficiario_cuit: string | null
  /** Solo transferencia */
  beneficiario_cbu: string | null
  monto: number
  /** Transferencia: hoy. E-cheq: su fecha de pago. */
  fecha: string
  /** E-cheq de tercero: el cheque que se endosa */
  cheque: { id: string; numero: string | null; banco: string | null; echeq_id: string | null } | null
  /** Por qué NO se puede mandar todavía. Vacío = se puede. */
  problemas: string[]
  /** La última operación de este pago (la que manda) */
  operacion: Fila | null
}

/** Lo que tiene una orden de pago para mandar a Credicoop: un renglón por medio de pago que corresponda. */
export async function pagosEnviablesDeOrden(db: SupabaseClient, ordenPagoId: string) {
  const { data: op, error } = await db.from("ordenes_pago")
    .select("id, numero_op, estado, fecha, proveedor_id, neto_a_pagar, proveedores(id, nombre, cuit, cbu), ordenes_pago_detalle(*), ordenes_pago_imputaciones(vencimiento_id)")
    .eq("id", ordenPagoId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!op) throw new ErrorOperacion("La orden de pago no existe.", 404)
  const prov = (Array.isArray(op.proveedores) ? op.proveedores[0] : op.proveedores) as Fila | null
  const detalles = ((op.ordenes_pago_detalle ?? []) as Fila[]).filter((d) => d.medio === "transferencia" || d.medio === "cheque" || d.medio === "cheque_propio")

  const cuentaIds = [...new Set(detalles.map((d) => (d.cuenta_origen_tipo === "BANCO" ? d.cuenta_origen_id : null)).filter(Boolean))] as string[]
  const chequeIds = [...new Set(detalles.map((d) => d.cheque_id).filter(Boolean))] as string[]
  const [cuentasRes, chequesRes, credicoopRes] = await Promise.all([
    cuentaIds.length ? db.from("cuentas_bancarias").select("*").in("id", cuentaIds) : Promise.resolve({ data: [] as Fila[], error: null }),
    chequeIds.length ? db.from("cheques").select("*").in("id", chequeIds) : Promise.resolve({ data: [] as Fila[], error: null }),
    db.from("cuentas_bancarias").select("*").eq("activo", true).order("nombre"),
  ])
  if (cuentasRes.error) throw new Error(cuentasRes.error.message)
  if (chequesRes.error) throw new Error(chequesRes.error.message)
  const cuentaDe = new Map(((cuentasRes.data ?? []) as Fila[]).map((c) => [c.id, c]))
  const chequeDe = new Map(((chequesRes.data ?? []) as Fila[]).map((c) => [c.id, c]))
  const cuentasCredicoop = ((credicoopRes.data ?? []) as Fila[]).filter(esCuentaCredicoop)

  let operaciones: Fila[] = []
  let sinTabla = false
  {
    const r = await db.from("bancos_operaciones").select("*").eq("orden_pago_id", ordenPagoId).order("creado_at", { ascending: false })
    if (r.error) { if (!faltaTablaBancos(r.error)) throw new Error(r.error.message); sinTabla = true } else operaciones = (r.data ?? []) as Fila[]
  }
  // Retención de Ganancias (revisión 19/11): si cambió desde que se armó la orden, se acepta ANTES
  // de mandar el pago al banco (el importe del pago puede cambiar). Una vez que el banco hizo un
  // pago, la retención queda fija (op_banco_pago_hecho, migración 20261119n): no se vuelve a mirar.
  let retencion: RetencionAntesDeEnviar | null = null
  if (op.estado === "pendiente" && !sinTabla) {
    const r = await db.rpc("op_retencion_al_confirmar", { p_op_id: ordenPagoId })
    if (!r.error && r.data) retencion = r.data as RetencionAntesDeEnviar
    else if (r.error && !faltaLaFuncion(r.error, "op_retencion_al_confirmar")) throw new Error(r.error.message)
  }
  const problemaRetencion = retencion?.cambia
    ? (retencion.se_puede_ajustar
      ? `La retención de Ganancias cambió desde que se armó la orden (era ${moneda(retencion.retencion_guardada)} y hoy corresponde ${moneda(retencion.retencion_hoy)}). Aceptala arriba antes de mandar el pago: el importe puede cambiar.`
      : `La retención de Ganancias cambió desde que se armó la orden (era ${moneda(retencion.retencion_guardada)} y hoy corresponde ${moneda(retencion.retencion_hoy)}) y no hay una transferencia ni efectivo sin mandar donde ajustar la diferencia: eliminá la orden y armala de nuevo.`)
    : null
  // ¿El banco ya pagó y la orden no se pudo confirmar sola? (columnas de 20261119n; sin la migración, nada)
  let fallaConfirmacion: { mensaje: string; estado: string | null; at: string | null } | null = null
  {
    const r = await db.from("ordenes_pago").select("banco_confirmacion_falla, banco_confirmacion_falla_estado, banco_confirmacion_falla_at").eq("id", ordenPagoId).maybeSingle()
    if (!r.error && r.data?.banco_confirmacion_falla && op.estado === "pendiente") {
      fallaConfirmacion = { mensaje: r.data.banco_confirmacion_falla, estado: r.data.banco_confirmacion_falla_estado ?? null, at: r.data.banco_confirmacion_falla_at ?? null }
    }
  }

  const hoy = hoyISO()
  const cuit = cuitDeOnce(prov?.cuit)
  const pagos: PagoEnviable[] = []
  for (const d of detalles) {
    const cheque = d.cheque_id ? chequeDe.get(d.cheque_id) ?? null : null
    const esEndoso = d.medio === "cheque" && !!d.cheque_id
    // Cheque de tercero en papel, o cheque propio en papel: no pasan por el banco
    if (esEndoso && !cheque?.es_echeq) continue
    if (!esEndoso && d.medio !== "transferencia" && !d.es_echeq) continue
    const tipo: TipoOperacion = d.medio === "transferencia" ? "transferencia" : esEndoso ? "echeq_endoso" : "echeq_emision"
    // Endoso: la cuenta de Credicoop habilitada (si hay una sola; si hay varias, se elige). El resto: la cuenta de la que sale el pago.
    const cuenta = esEndoso ? (cuentasCredicoop.length === 1 ? cuentasCredicoop[0] : null) : (d.cuenta_origen_tipo === "BANCO" ? cuentaDe.get(d.cuenta_origen_id) ?? null : null)
    const cbuBenef = String(d.cbu || prov?.cbu || "").replace(/[^0-9]/g, "") || null
    const problemas: string[] = []
    if (op.estado !== "pendiente") problemas.push(op.estado === "pagada"
      ? "La orden ya está confirmada como pagada. Para mandar un pago a Credicoop, la orden tiene que estar pendiente: el pago se confirma después de que el banco lo procese."
      : `La orden está ${op.estado}.`)
    if (esEndoso && cuentasCredicoop.length === 0) problemas.push("No hay ninguna cuenta habilitada para operar con Credicoop por el sistema. La habilita sistemas, una sola vez.")
    else if (!esEndoso && !cuenta) problemas.push("Este pago no tiene elegida la cuenta bancaria de la que sale.")
    else if (cuenta && !esCuentaCredicoop(cuenta)) problemas.push(`La cuenta "${cuenta.nombre}" no está habilitada para operar con Credicoop por el sistema: este pago se hace a mano en el banco.`)
    else if (cuenta && !cbuValido(String(cuenta.cbu ?? ""))) problemas.push(`La cuenta "${cuenta.nombre}" no tiene cargado su CBU de 22 dígitos (Finanzas → Cuentas).`)
    if (!cuit) problemas.push(`${prov?.nombre ?? "El proveedor"} no tiene cargado un CUIT de 11 dígitos en su ficha${String(prov?.cuit ?? "").trim() ? ` (figura "${String(prov?.cuit).trim()}")` : ""}. Sin el CUIT el banco no acepta la operación: cargalo antes de mandarla.`)
    if (tipo === "transferencia" && !cbuValido(cbuBenef ?? "")) problemas.push(`${prov?.nombre ?? "El proveedor"} no tiene cargado su CBU de 22 dígitos en la ficha.`)
    if (!(Number(d.monto) > 0)) problemas.push("El importe del pago no es válido.")
    const fecha = tipo === "transferencia" ? hoy : String((esEndoso ? cheque?.fecha_vencimiento : d.cheque_fecha_vencimiento) ?? "").slice(0, 10)
    if (tipo === "echeq_emision" && (!fecha || fecha < hoy)) problemas.push("La fecha de pago del e-cheq falta o ya pasó: no se puede emitir con esa fecha.")
    if (sinTabla) problemas.push(AVISO_SIN_TABLA)
    if (problemaRetencion) problemas.push(problemaRetencion)
    pagos.push({
      detalle_id: d.id, tipo, tipo_nombre: TIPO_NOMBRE[tipo], banco: "Banco Credicoop",
      cuenta: cuenta?.nombre ?? null, cuenta_cbu: cuenta?.cbu ?? null,
      cuentas_a_elegir: esEndoso && cuentasCredicoop.length > 1 ? cuentasCredicoop.map((c) => ({ id: c.id, nombre: c.nombre })) : [],
      beneficiario: prov?.nombre ?? "—", beneficiario_cuit: cuit, beneficiario_cbu: tipo === "transferencia" ? cbuBenef : null,
      monto: Math.round(Number(d.monto) * 100) / 100, fecha,
      cheque: esEndoso && cheque ? { id: cheque.id, numero: cheque.numero ?? null, banco: cheque.banco ?? null, echeq_id: cheque.echeq_id ?? null } : null,
      problemas,
      operacion: operaciones.find((o) => o.orden_pago_detalle_id === d.id) ?? null,   // vienen de la más nueva a la más vieja
    })
  }
  return {
    orden: { id: op.id, numero_op: op.numero_op, estado: op.estado, proveedor: prov?.nombre ?? "—", proveedor_id: op.proveedor_id },
    vencimiento_ids: [...new Set(((op.ordenes_pago_imputaciones ?? []) as Fila[]).map((i) => i.vencimiento_id).filter(Boolean))] as string[],
    pagos, conexion: estadoConexion(), retencion, falla_confirmacion: fallaConfirmacion,
    _interno: { prov, cuentaDe, chequeDe, cuentasCredicoop, detalles },
  }
}

/** Lo que devuelve op_retencion_al_confirmar (vista previa; no cambia nada). */
export interface RetencionAntesDeEnviar {
  cambia: boolean
  retencion_guardada: number
  retencion_hoy: number
  neto_guardado: number
  neto_hoy: number
  se_puede_ajustar: boolean
  medio_que_se_ajusta: string | null
  linea_id: string | null
  fecha_pago: string
  fecha_orden: string
  /** 20261119n: el banco real ya hizo un pago de la orden y la retención quedó fija */
  retencion_fija_por_banco?: boolean
}

/**
 * Aceptar la retención de Ganancias de hoy ANTES de mandar el pago al banco (revisión 19/11).
 * Ajusta la transferencia / efectivo de la orden (nunca uno que ya se mandó al banco) y la orden
 * sigue pendiente. `retencionVista` = la que la persona vio en la pantalla: si cambió de nuevo,
 * la base no toca nada y avisa.
 */
export async function aceptarRetencionDeOrden(db: SupabaseClient, ordenPagoId: string, retencionVista: number | null): Promise<Fila> {
  const { data, error } = await db.rpc("op_retencion_actualizar", { p_op_id: ordenPagoId, p_retencion_vista: retencionVista })
  if (error) {
    if (faltaLaFuncion(error, "op_retencion_actualizar")) {
      throw new ErrorOperacion("Falta aplicar la migración 20261119n_pagos_banco_retencion.sql: todavía no se puede aceptar la retención antes de mandar el pago. Mientras tanto, eliminá la orden y armala de nuevo.", 503)
    }
    if (esGuardia(error)) throw new ErrorOperacion(error.message, 409)
    throw new Error(error.message)
  }
  return (data ?? {}) as Fila
}

// ─── Guardar, enviar y registrar el resultado ──────────────────────────────

interface Nueva {
  tipo: TipoOperacion
  cuenta_bancaria_id: string | null
  orden_pago_id?: string | null
  orden_pago_detalle_id?: string | null
  cheque_id?: string | null
  proveedor_id?: string | null
  vencimiento_ids?: string[]
  beneficiario_nombre?: string | null
  beneficiario_cuit?: string | null
  beneficiario_cbu?: string | null
  monto: number
  fecha_pago?: string | null
  numero_vep?: string | null
  id_cheque_banco?: string | null
}
type Empresa = { numeroAdherente: number; firmantes?: Array<{ documento: string; documentoTipo: string }> }

/**
 * El camino único de todo envío: arma el pedido (si falta un dato corta ACÁ, sin guardar ni
 * enviar), guarda la operación como "preparada" —la base controla ahí que la orden siga
 * pendiente y toma su candado—, la manda y anota qué contestó el banco.
 */
async function enviar(db: SupabaseClient, usuarioId: string | null, datos: Nueva,
  armar: (idOrigen: string, empresa: Empresa) => unknown,
  mandar: (pedido: unknown) => Promise<{ cruda: unknown; resultado: ResultadoOperacion }>,
  ambiente: AmbienteCredicoop, empresa: Empresa): Promise<Fila> {
  const idOrigen = randomUUID()
  const pedido = armar(idOrigen, empresa)   // lanza ErrorCredicoop("DATOS") si falta algo: no se guardó nada

  const { data: fila, error } = await db.from("bancos_operaciones").insert({
    ...datos, vencimiento_ids: datos.vencimiento_ids ?? [], ambiente, id_origen: idOrigen, estado: "preparada", pedido, creado_por: usuarioId, actualizado_por: usuarioId,
  }).select("*").single()
  if (error) {
    if (faltaTablaBancos(error)) throw new ErrorOperacion(AVISO_SIN_TABLA, 503)
    if (error.code === "23505") throw new ErrorOperacion("Ese pago ya tiene una operación en curso en Credicoop. Tocá “Actualizar estado” para ver cómo está: no se mandó de nuevo.", 409)
    if (esGuardia(error)) throw new ErrorOperacion(error.message, 409)   // la orden ya no está pendiente, cambió el importe…
    throw new Error(error.message)
  }

  const ahora = new Date().toISOString()
  try {
    const { cruda, resultado } = await mandar(pedido)
    return await anotar(db, fila.id, usuarioId, resultado, cruda, { enviado_at: ahora })
  } catch (e) {
    if (!(e instanceof ErrorCredicoop)) {
      await db.from("bancos_operaciones").update({ estado: "error", motivo: "Falla inesperada al enviar: no se sabe si la operación entró.", enviado_at: ahora, actualizado_at: ahora }).eq("id", fila.id)
      throw e
    }
    // En duda (corte, error del banco, o "ya existía"): NO se sabe si entró → error, y se consulta antes de reintentar.
    // El resto: el banco dijo que no, o ni siquiera salió → rechazada (se puede volver a mandar).
    const enDuda = e.clase === "INCIERTO" || e.clase === "DUPLICADO"
    const { data } = await db.from("bancos_operaciones").update({
      estado: enDuda ? "error" : "rechazada", motivo: e.message, respuesta: e.detalle ?? null, enviado_at: ahora, actualizado_at: ahora, actualizado_por: usuarioId,
    }).eq("id", fila.id).select("*").single()
    throw Object.assign(e, { operacion: data ?? fila })
  }
}

/**
 * Guarda lo que dijo el banco. Si quedó hecha contra el banco REAL, anota la referencia en el
 * medio de pago de la orden. Lo del simulador o del banco de prueba no deja nada en la orden.
 */
async function anotar(db: SupabaseClient, id: string, usuarioId: string | null, r: ResultadoOperacion, cruda: unknown, extra: Fila = {}): Promise<Fila> {
  const ahora = new Date().toISOString()
  const { data: antes } = await db.from("bancos_operaciones").select("*").eq("id", id).single()
  const cambio: Fila = {
    estado: antes?.estado === "acreditada" && estaHecha(r.estado) ? "acreditada" : r.estado,
    estado_banco: r.estadoBanco, motivo: r.motivo, respuesta: cruda, actualizado_at: ahora, actualizado_por: usuarioId, ...extra,
    ...(r.idOperacion ? { id_operacion_banco: r.idOperacion } : {}),
    ...(r.idCheque ? { id_cheque_banco: r.idCheque } : {}),
    ...(estaHecha(r.estado) && !antes?.firmado_at ? { firmado_at: ahora } : {}),
  }
  const { data, error } = await db.from("bancos_operaciones").update(cambio).eq("id", id).select("*").single()
  if (error) throw new Error(error.message)
  if (data.ambiente !== "produccion") return data   // prueba: ninguna referencia falsa en la orden ni en el cheque reales
  // Referencia del banco en el medio de pago (solo un texto de referencia: no mueve nada)
  if (estaHecha(r.estado) && data.orden_pago_detalle_id && data.tipo === "transferencia" && data.id_operacion_banco) {
    await db.from("ordenes_pago_detalle").update({ numero_transferencia: String(data.id_operacion_banco), fecha_transferencia: data.fecha_pago })
      .eq("id", data.orden_pago_detalle_id).is("numero_transferencia", null)
  }
  if (estaHecha(r.estado) && data.tipo === "echeq_endoso" && data.cheque_id && data.id_cheque_banco) {
    await db.from("cheques").update({ echeq_id: data.id_cheque_banco }).eq("id", data.cheque_id).is("echeq_id", null)
  }
  // E-cheq emitido (revisión 19/11): el cheque propio lo crea op_confirmar al confirmar la orden, ya
  // con el identificador del banco (20261119n). Si la orden ya estaba confirmada, se completa acá.
  if (estaHecha(r.estado) && data.tipo === "echeq_emision" && data.orden_pago_id) await completarEcheqsEmitidos(db, data.orden_pago_id)
  return data
}

/** Número de cheque que informó el banco en la respuesta de la emisión (si lo informó). */
const numeroChequeDeRespuesta = (respuesta: unknown): string | null => {
  const d = ((respuesta as any)?.data ?? {}) as any
  const c = d.echeq ?? (Array.isArray(d.echeqs) ? d.echeqs[0] : null)
  return String(c?.numeroCheque ?? "").trim() || null
}

/**
 * E-cheq emitidos por Credicoop (banco real) de una orden de pago: el cheque propio de la orden
 * lleva el identificador y el número que dio el banco (no el número escrito a mano al armar la
 * orden), así el débito y la conciliación lo encuentran. Solo completa cheques que todavía no
 * tienen identificador, y solo cuando hay UN cheque de ese importe sin identificar (si hay más,
 * no adivina). Lo llaman la confirmación de la orden y la consulta al banco. No lanza.
 */
export async function completarEcheqsEmitidos(db: SupabaseClient, ordenPagoId: string): Promise<void> {
  try {
    const { data: ops, error } = await db.from("bancos_operaciones").select("id_cheque_banco, monto, respuesta")
      .eq("orden_pago_id", ordenPagoId).eq("tipo", "echeq_emision").eq("ambiente", "produccion").in("estado", ["firmada", "acreditada"])
      .not("id_cheque_banco", "is", null)
    if (error || !ops?.length) return
    for (const o of ops as Fila[]) {
      const { data: ya } = await db.from("cheques").select("id").eq("echeq_id", o.id_cheque_banco).limit(1)
      if (ya?.length) continue
      const { data: chs } = await db.from("cheques").select("id").eq("orden_pago_id", ordenPagoId).eq("tipo", "PROPIO").is("echeq_id", null).eq("monto", Number(o.monto))
      if (chs?.length !== 1) continue
      const numero = numeroChequeDeRespuesta(o.respuesta)
      const u = await db.from("cheques").update({ echeq_id: o.id_cheque_banco, es_echeq: true, ...(numero ? { numero } : {}) }).eq("id", (chs[0] as Fila).id).is("echeq_id", null)
      if (u.error) console.warn("[bancos] no se pudo anotar el e-cheq del banco en el cheque:", u.error.message)
    }
  } catch (e) {
    console.warn("[bancos] completar e-cheq emitidos:", (e as Error)?.message)
  }
}

/**
 * Manda a Credicoop, para firmar, UN medio de pago de una orden de pago pendiente.
 * `cuentaElegidaId`: solo para endosar un e-cheq cuando hay más de una cuenta de Credicoop habilitada.
 */
export async function enviarPagoDeOrden(db: SupabaseClient, ordenPagoId: string, detalleId: string, usuarioId: string | null, cuentaElegidaId?: string | null): Promise<Fila> {
  const info = await pagosEnviablesDeOrden(db, ordenPagoId)
  const pago = info.pagos.find((p) => p.detalle_id === detalleId)
  if (!pago) throw new ErrorOperacion("Ese pago no es una transferencia ni un e-cheq de esta orden.", 404)
  if (pago.problemas.length) throw new ErrorOperacion(pago.problemas.join(" "))
  if (pago.operacion && pago.operacion.estado !== "rechazada") {
    throw new ErrorOperacion("Ese pago ya se mandó a Credicoop. Tocá “Actualizar estado” para ver cómo está.", 409)
  }
  const { cliente, ambiente } = clienteCredicoop()   // sin credenciales: corta acá, no se manda nada
  const { prov, detalles, cuentaDe, cuentasCredicoop } = info._interno
  const d = detalles.find((x) => x.id === detalleId)!
  const hoy = hoyISO()
  const base: Nueva = {
    tipo: pago.tipo, cuenta_bancaria_id: null, orden_pago_id: ordenPagoId, orden_pago_detalle_id: detalleId, proveedor_id: info.orden.proveedor_id,
    vencimiento_ids: info.vencimiento_ids, beneficiario_nombre: pago.beneficiario, beneficiario_cuit: pago.beneficiario_cuit, monto: pago.monto, fecha_pago: pago.fecha,
  }
  const referencia = `OP${String(info.orden.numero_op ?? "").replace(/[^0-9]/g, "")}`

  if (pago.tipo === "transferencia") {
    const cuenta = cuentaDe.get(d.cuenta_origen_id)!
    return enviar(db, usuarioId, { ...base, cuenta_bancaria_id: cuenta.id, beneficiario_cbu: pago.beneficiario_cbu },
      (idOrigen, empresa) => armarTransferencia(empresa, { idOrigen, cbuCuentaDebito: String(cuenta.cbu), hoy, beneficiarios: [{
        cbuCvu: pago.beneficiario_cbu!, cuit: prov!.cuit, nombre: prov!.nombre, monto: pago.monto, concepto: "FAC", referencia, observaciones: `Orden de pago ${info.orden.numero_op}`,
      }] }), cliente.transferir, ambiente, cliente.empresa)
  }
  if (pago.tipo === "echeq_emision") {
    const cuenta = cuentaDe.get(d.cuenta_origen_id)!
    // El banco exige el nombre con que tiene agendado al beneficiario (APIE-1013); en el sistema
    // el proveedor figura "como lo conocemos". Se pide a la agenda de Credicoop antes de emitir.
    let nombreBanco = prov!.nombre as string
    if (ambiente !== "simulador") {
      const agendado = await cliente.nombreBeneficiarioEcheq(String(prov!.cuit ?? ""))
      if (!agendado) throw new ErrorOperacion(`${prov!.nombre} (CUIT ${prov!.cuit}) no está en la agenda de beneficiarios de e-cheq de Credicoop. Hay que darlo de alta en Banca Internet Empresa y volver a mandarlo. No se mandó nada al banco.`)
      nombreBanco = agendado
    }
    return enviar(db, usuarioId, { ...base, cuenta_bancaria_id: cuenta.id },
      (idOrigen, empresa) => armarEmisionEcheq(empresa, { idOrigen, cbuCuentaDebito: String(cuenta.cbu), hoy, echeqs: [{
        monto: pago.monto, fechaPago: pago.fecha, beneficiarioNombre: nombreBanco, beneficiarioCuit: prov!.cuit, concepto: "FAC", motivo: `Orden de pago ${info.orden.numero_op}`,
      }] }), cliente.emitirEcheq, ambiente, cliente.empresa)
  }
  // Endoso de un e-cheq que nos dio un cliente. La cuenta: la única habilitada, o la que se eligió.
  const cuenta = cuentasCredicoop.length === 1 ? cuentasCredicoop[0] : cuentasCredicoop.find((c) => c.id === cuentaElegidaId)
  if (!cuenta) throw new ErrorOperacion("Elegí con qué cuenta de Credicoop se endosa el e-cheq.")
  if (!cbuValido(String(cuenta.cbu ?? ""))) throw new ErrorOperacion(`La cuenta "${cuenta.nombre}" no tiene cargado su CBU de 22 dígitos (Finanzas → Cuentas).`)
  const cheque = pago.cheque!
  let idCheque = cheque.echeq_id
  if (!idCheque) {
    // Todavía no tiene el identificador del banco: se busca entre los recibidos por su número
    const lista = await cliente.listarEcheqs(armarListaEcheqs(cliente.empresa, { idOrigen: randomUUID(), gestion: "RECIBIDOS", estado: "ACTIVO", numeroCheque: cheque.numero ?? "" }))
    const iguales = lista.echeqs.filter((c) => c.monto != null && Math.abs(c.monto - pago.monto) < 0.01)
    if (iguales.length !== 1) {
      throw new ErrorOperacion(iguales.length === 0
        ? `Credicoop no tiene un e-cheq recibido y activo con el número ${cheque.numero ?? "(sin número)"} por ese importe. Puede que todavía no esté aceptado, o que el número cargado no sea el del e-cheq.`
        : `Credicoop tiene ${iguales.length} e-cheq con ese número e importe: no se puede saber cuál es. Avisá a sistemas.`)
    }
    idCheque = iguales[0].idCheque
    if (ambiente === "produccion") await db.from("cheques").update({ echeq_id: idCheque, ...(iguales[0].cmc7 ? { cmc7: iguales[0].cmc7 } : {}) }).eq("id", cheque.id)
  }
  return enviar(db, usuarioId, { ...base, cuenta_bancaria_id: cuenta.id, cheque_id: cheque.id, id_cheque_banco: idCheque },
    (idOrigen, empresa) => armarGestionEcheq(empresa, { idOrigen, cbuCuenta: String(cuenta.cbu), accion: "ENDOSAR", echeqs: [{ idCheque }], beneficiarioCuit: prov!.cuit }),
    cliente.gestionarEcheq, ambiente, cliente.empresa)
}

const TIPO_SIMULADOR = { transferencia: "transferencia", echeq_emision: "echeq", echeq_endoso: "gestion", vep: "vep" } as const

/**
 * Le pregunta al banco cómo quedó una operación y lo anota. Es lo que hay que hacer ante una
 * duda, antes de reenviar.
 *
 * Si el banco dice que NO la conoce: recién se da por no entrada (rechazada, se puede reenviar)
 * cuando pasaron 15 minutos desde el envío y sigue sin existir. Antes de eso queda en duda: el
 * banco puede tardar en registrarla, y reenviar sería pagar dos veces.
 */
export async function actualizarOperacion(db: SupabaseClient, operacionId: string, usuarioId: string | null): Promise<Fila> {
  const { data: op, error } = await db.from("bancos_operaciones").select("*").eq("id", operacionId).maybeSingle()
  if (error) { if (faltaTablaBancos(error)) throw new ErrorOperacion(AVISO_SIN_TABLA, 503); throw new Error(error.message) }
  if (!op) throw new ErrorOperacion("La operación no existe.", 404)
  if (op.estado === "rechazada" || op.estado === "acreditada") return op   // ya terminó
  const { cliente, ambiente } = clienteCredicoop()
  if (op.ambiente !== ambiente) {
    const donde = (a: string) => (a === "simulador" ? "el simulador" : a === "homologacion" ? "el banco de prueba" : "el banco real")
    throw new ErrorOperacion(`Esta operación se mandó a ${donde(op.ambiente)} y ahora el sistema está conectado a ${donde(ambiente)}: no se puede consultar ahí.`, 409)
  }
  // Simulador: el estado sale de la operación guardada y de la hora (firmada al minuto de enviada),
  // no de la memoria del servidor, que en la nube se pierde entre un pedido y el siguiente.
  if (ambiente === "simulador") {
    const hecha = !!op.enviado_at && Date.now() - Date.parse(op.enviado_at) >= SIMULADOR_FIRMA_A_LOS_SEGUNDOS * 1000
    simuladorEnUso()?.sembrar({ tipo: TIPO_SIMULADOR[op.tipo as TipoOperacion], idOrigen: op.id_origen, pedido: op.pedido, hecha, idOperacion: op.id_operacion_banco })
  }
  const ahora = new Date().toISOString()
  try {
    if (op.tipo === "echeq_endoso") {
      // El banco no publica una consulta para las gestiones de e-cheq: se mira el estado del cheque
      // y solo un estado CONCRETO da el endoso por hecho (ver endosoSegunEcheq).
      const lista = await cliente.listarEcheqs(armarListaEcheqs(cliente.empresa, { idOrigen: randomUUID(), gestion: "RECIBIDOS", estado: "TODOS", idCheque: op.id_cheque_banco }))
      const ch = lista.echeqs.find((c) => c.idCheque === op.id_cheque_banco)
      const como = ch ? endosoSegunEcheq(ch.estado) : "desconocido"
      const texto = ch ? `E-cheq ${estadoEcheq(ch.estado)}` : "El e-cheq no figura entre los recibidos"
      return anotar(db, op.id, usuarioId, {
        idOperacion: op.id_operacion_banco,
        estado: (como === "hecho" ? "firmada" : como === "pendiente" ? (op.estado === "error" ? "error" : "enviada_a_firma") : "en_proceso") as EstadoOperacion,
        estadoBanco: texto,
        motivo: como === "hecho" ? null
          : como === "pendiente" ? "El e-cheq sigue activo en nuestro poder: el endoso todavía no está firmado."
          : "El banco no deja ver cómo quedó el endoso (el e-cheq no figura, o está en un estado que el sistema no esperaba). Verificalo en Banca Internet Empresa; si no se hizo, marcá la operación como rechazada.",
      }, { echeq: ch ?? null })
    }
    const consulta = op.tipo === "transferencia" ? cliente.consultarTransferencia : op.tipo === "echeq_emision" ? cliente.consultarEcheq : cliente.consultarPagoVep
    const { cruda, resultado } = await consulta({ idOrigen: op.id_origen })
    // Un texto de estado que el sistema no conoce se muestra tal cual y queda sin terminar
    if (!estadoBancoConocido(resultado.estadoBanco)) {
      resultado.motivo = `El banco informa un estado que el sistema no conoce: “${resultado.estadoBanco}”. No se toma como hecho ni como rechazado: verificalo en Banca Internet Empresa.`
    }
    return anotar(db, op.id, usuarioId, resultado, cruda)
  } catch (e) {
    // El banco no conoce esa operación. Solo importa para una que estaba en duda o sin enviar.
    if (e instanceof ErrorCredicoop && e.clase === "RECHAZO" && ["APIE-0026", "APIE-1025", "APIE-1029", "APIE-4024"].includes(e.codigo ?? "") && (op.estado === "error" || op.estado === "preparada")) {
      const desde = Date.parse(op.enviado_at ?? op.creado_at)
      const minutos = Number.isFinite(desde) ? (Date.now() - desde) / 60_000 : 0
      const yaPaso = minutos >= MINUTOS_PARA_DAR_POR_NO_ENTRADA
      const { data } = await db.from("bancos_operaciones").update(yaPaso ? {
        estado: "rechazada",
        motivo: `El banco no tiene esta operación ${Math.floor(minutos)} minutos después de enviada: no entró. Antes de volver a mandarla, verificá en Banca Internet Empresa que no figure.`,
        respuesta: e.detalle ?? null, actualizado_at: ahora, actualizado_por: usuarioId,
      } : {
        estado: "error",
        motivo: `El banco todavía no tiene registrada esta operación (se mandó hace ${Math.max(0, Math.floor(minutos))} minutos). Puede tardar: NO la vuelvas a mandar. Volvé a actualizar el estado pasados ${MINUTOS_PARA_DAR_POR_NO_ENTRADA} minutos del envío y verificá en Banca Internet Empresa.`,
        respuesta: e.detalle ?? null, actualizado_at: ahora, actualizado_por: usuarioId,
      }).eq("id", op.id).select("*").single()
      return data ?? op
    }
    throw e
  }
}

/**
 * Destrabe a mano (solo admin): marcar como rechazada una operación que no termina, DESPUÉS de
 * verificar en Banca Internet Empresa que no se hizo ni se va a firmar. Queda registrado quién,
 * cuándo y por qué. No se puede con una que el banco ya procesó.
 */
export async function marcarRechazadaAMano(db: SupabaseClient, operacionId: string, usuarioId: string | null, motivo: string, quien: string): Promise<Fila> {
  const texto = motivo.trim()
  if (texto.length < 5) throw new ErrorOperacion("Escribí el motivo (qué viste en Banca Internet Empresa).")
  const ahora = new Date().toISOString()
  const { data, error } = await db.from("bancos_operaciones").update({
    estado: "rechazada", motivo: `Marcada como rechazada a mano por ${quien}: ${texto.slice(0, 400)}`,
    rechazo_manual_por: usuarioId, rechazo_manual_at: ahora, actualizado_at: ahora, actualizado_por: usuarioId,
  }).eq("id", operacionId).in("estado", ["preparada", "enviada_a_firma", "en_proceso", "error"]).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ErrorOperacion("Solo se puede marcar como rechazada una operación que todavía no terminó. Una que el banco ya procesó no se puede rechazar.", 409)
  return data
}

// ─── VEP ───────────────────────────────────────────────────────────────────

export async function cuentasCredicoopDelSistema(db: SupabaseClient): Promise<Fila[]> {
  const { data, error } = await db.from("cuentas_bancarias").select("*").eq("activo", true).order("nombre")
  if (error) throw new Error(error.message)
  return ((data ?? []) as Fila[]).filter(esCuentaCredicoop)
}

/**
 * CUIT de quienes generan los VEP de la empresa (el contador, el que opera en ARCA). El banco
 * solo muestra un VEP si en la consulta va el CUIT de la persona que lo generó ("originante"):
 * sin eso la lista viene vacía. Salen de CREDICOOP_VEP_ORIGINANTES ("20163027225,20123456789")
 * más el que se escriba en la pantalla.
 */
export function originantesVep(extra?: string | null): string[] {
  const todos = [...String(process.env.CREDICOOP_VEP_ORIGINANTES ?? "").split(","), String(extra ?? "")]
    .map((x) => x.replace(/[^0-9]/g, "")).filter((x) => x.length === 11)
  return [...new Set(todos)]
}

/**
 * VEP pendientes según el banco. Las fechas del filtro son de VENCIMIENTO (máximo 180 días entre
 * las dos): de hace 30 días a dentro de 149 (un VEP vence a los 30 días de generado). Se pregunta
 * una vez sin originante y una por cada originante, y se juntan sin repetir.
 */
async function listarVepsPendientes(cliente: ReturnType<typeof clienteCredicoop>["cliente"], originantes: string[]) {
  const hoy = hoyISO()
  const vistos = new Map<string, Awaited<ReturnType<typeof cliente.listarVeps>>[number]>()
  for (const cuitOriginante of [undefined, ...originantes]) {
    const lista = await cliente.listarVeps(armarListaVeps(cliente.empresa, { idOrigen: randomUUID(), estado: "PENDIENTE_PAGO", desde: sumarDiasISO(hoy, -30), hasta: sumarDiasISO(hoy, 149), cuitOriginante }))
    for (const v of lista) if (v.numeroVep && !vistos.has(v.numeroVep)) vistos.set(v.numeroVep, v)
  }
  return [...vistos.values()]
}

/** VEP de ARCA pendientes de pago, con la operación en curso de cada uno si ya se mandó. */
export async function vepsPendientes(db: SupabaseClient, originante?: string | null) {
  const { cliente } = clienteCredicoop()
  const veps = await listarVepsPendientes(cliente, originantesVep(originante))
  const numeros = veps.map((v) => v.numeroVep).filter(Boolean)
  let ops: Fila[] = []
  if (numeros.length) {
    const r = await db.from("bancos_operaciones").select("*").eq("tipo", "vep").in("numero_vep", numeros).neq("estado", "rechazada")
    if (r.error) { if (!faltaTablaBancos(r.error)) throw new Error(r.error.message) } else ops = (r.data ?? []) as Fila[]
  }
  return veps.map((v) => ({ ...v, operacion: ops.find((o) => o.numero_vep === v.numeroVep) ?? null }))
}

/**
 * Manda a firmar el pago de UN VEP. El importe y los CUIT se toman del banco. Si el importe que
 * informa el banco AHORA no es el que la persona vio en la pantalla, no se manda: se le muestra el nuevo.
 */
export async function enviarPagoVep(db: SupabaseClient, p: { numeroVep: string; cuentaBancariaId: string; montoVisto: number | null; vencimientoId?: string | null; cuitOriginante?: string | null }, usuarioId: string | null): Promise<Fila> {
  const { cliente, ambiente } = clienteCredicoop()
  const { data: cuenta, error } = await db.from("cuentas_bancarias").select("*").eq("id", p.cuentaBancariaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!cuenta || !esCuentaCredicoop(cuenta)) throw new ErrorOperacion("Elegí una cuenta habilitada para operar con Credicoop.")
  if (!cbuValido(String(cuenta.cbu ?? ""))) throw new ErrorOperacion(`La cuenta "${cuenta.nombre}" no tiene cargado su CBU de 22 dígitos (Finanzas → Cuentas).`)
  // Se vuelve a pedir la lista: el VEP tiene que seguir pendiente y el importe es el que informa ARCA
  const hoy = hoyISO()
  const veps = await listarVepsPendientes(cliente, originantesVep(p.cuitOriginante))
  const vep = veps.find((v) => v.numeroVep === String(p.numeroVep))
  if (!vep) throw new ErrorOperacion(`El VEP ${p.numeroVep} ya no figura como pendiente de pago en Credicoop.`)
  if (!(Number(vep.monto) > 0)) throw new ErrorOperacion(`El banco no informa el importe del VEP ${p.numeroVep}: no se puede mandar.`)
  if (p.montoVisto == null || Math.abs(p.montoVisto - vep.monto!) > 0.005) {
    throw new ErrorOperacion(
      `El importe del VEP ${p.numeroVep} cambió: ahora el banco informa ${moneda(vep.monto!)}${p.montoVisto != null ? ` y en la pantalla figuraba ${moneda(p.montoVisto)}` : ""}. No se mandó nada: revisalo y volvé a mandarlo con el importe nuevo.`,
      409, { monto_actual: vep.monto })
  }
  return enviar(db, usuarioId, {
    tipo: "vep", cuenta_bancaria_id: cuenta.id, vencimiento_ids: p.vencimientoId ? [p.vencimientoId] : [],
    beneficiario_nombre: `ARCA — ${vep.descripcion || vep.concepto}`.slice(0, 200), beneficiario_cuit: vep.cuitContribuyente || null,
    monto: vep.monto!, fecha_pago: hoy, numero_vep: vep.numeroVep,
  }, (idOrigen, empresa) => armarPagoVep(empresa, { idOrigen, cbuCuentaDebito: String(cuenta.cbu), numeroVep: vep.numeroVep, monto: vep.monto!, cuitContribuyente: vep.cuitContribuyente, cuitOriginante: vep.cuitOriginante }),
  cliente.pagarVep, ambiente, cliente.empresa)
}

// ─── Movimientos → conciliación ────────────────────────────────────────────

/**
 * Trae los movimientos de una cuenta de Credicoop y los carga como un extracto (fuente
 * "api_banco") en la conciliación que ya existe: el sistema PROPONE con qué pago o cobro
 * coincide cada uno (estado "Sugerido") y una persona lo confirma en Finanzas → Conciliación.
 * No concilia nada solo. Volver a traer el mismo período no duplica movimientos.
 * Solo con el banco real: los movimientos del simulador o del banco de prueba se muestran, pero
 * NO se cargan en la conciliación (no son movimientos de la cuenta).
 */
export async function traerMovimientos(db: SupabaseClient, p: { cuentaBancariaId: string; desde: string; hasta: string }, usuarioId: string | null) {
  const { cliente, ambiente } = clienteCredicoop()
  const { data: cuenta, error } = await db.from("cuentas_bancarias").select("*").eq("id", p.cuentaBancariaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!cuenta || !esCuentaCredicoop(cuenta)) throw new ErrorOperacion("Elegí una cuenta habilitada para operar con Credicoop.")
  const real = ambiente === "produccion"
  let nroCuenta = real ? String(cuenta.numero_cuenta_banco ?? "").trim() : ""
  if (!nroCuenta) {
    // La primera vez se busca el número de cuenta del banco por el CBU
    const cbu = String(cuenta.cbu ?? "").replace(/[^0-9]/g, "")
    const cuentas = await cliente.cuentas()
    const encontrada = cuentas.find((c) => c.cbu === cbu) ?? (real ? undefined : cuentas[0])
    if (!encontrada) throw new ErrorOperacion(`Credicoop no informa ninguna cuenta con el CBU cargado en "${cuenta.nombre}". Revisá el CBU en Finanzas → Cuentas.`)
    nroCuenta = encontrada.nroCuenta
    if (real) await db.from("cuentas_bancarias").update({ numero_cuenta_banco: nroCuenta }).eq("id", cuenta.id)
  }
  const r = await cliente.movimientos(nroCuenta, p.desde, p.hasta)
  // Referencia para no duplicar: el id de transacción del banco; si no viene, una armada con los datos del renglón
  const vistos = new Map<string, number>()
  const movimientos = r.movimientos.map((m) => {
    let ref = m.idTransaccion ? `bccl:${m.idTransaccion}` : `bccl:${m.fecha}|${m.nroComprobante}|${m.monto}|${m.descripcion}`
    const n = (vistos.get(ref) ?? 0) + 1
    vistos.set(ref, n)
    if (n > 1) ref += `#${n}`
    return { fecha: m.fecha, descripcion: [m.descripcion, m.nroComprobante ? `comp. ${m.nroComprobante}` : ""].filter(Boolean).join(" — "), monto: m.monto, referencia_externa: ref }
  })
  const importado = real && movimientos.length
    ? await importarExtracto(db, { cuenta_bancaria_id: cuenta.id, fuente: "api_banco", movimientos, periodo_desde: p.desde, periodo_hasta: p.hasta, saldo_final: r.saldo, importado_por: usuarioId })
    : null

  // Propuesta (no se aplica sola): débitos que coinciden con una operación firmada desde el sistema, del mismo ambiente
  const coincidencias: Array<{ operacion_id: string; tipo: string; beneficiario: string | null; monto: number; fecha_movimiento: string; descripcion: string }> = []
  const ops = await db.from("bancos_operaciones").select("*").eq("cuenta_bancaria_id", cuenta.id).eq("estado", "firmada").eq("ambiente", ambiente).in("tipo", ["transferencia", "vep"])
  if (!ops.error) {
    const libres = [...r.movimientos.filter((m) => m.monto < 0)]
    for (const o of (ops.data ?? []) as Fila[]) {
      const i = libres.findIndex((m) => Math.abs(Math.abs(m.monto) - Number(o.monto)) < 0.01 && o.fecha_pago && m.fecha >= o.fecha_pago && m.fecha <= sumarDiasISO(o.fecha_pago, 3))
      if (i < 0) continue
      const [m] = libres.splice(i, 1)
      coincidencias.push({ operacion_id: o.id, tipo: TIPO_NOMBRE[o.tipo as TipoOperacion], beneficiario: o.beneficiario_nombre, monto: Number(o.monto), fecha_movimiento: m.fecha, descripcion: m.descripcion })
    }
  }
  return { cuenta: cuenta.nombre, traidos: r.movimientos.length, saldo: r.saldo, parcial: r.parcial, importado, coincidencias, de_prueba: !real }
}

/** Marca una operación firmada como "vista en la cuenta" (lo decide una persona, mirando el movimiento). */
export async function marcarAcreditada(db: SupabaseClient, operacionId: string, usuarioId: string | null): Promise<Fila> {
  const ahora = new Date().toISOString()
  const { data, error } = await db.from("bancos_operaciones").update({ estado: "acreditada", acreditado_at: ahora, acreditado_por: usuarioId, actualizado_at: ahora, actualizado_por: usuarioId })
    .eq("id", operacionId).eq("estado", "firmada").select("*").maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ErrorOperacion("Solo se puede marcar como vista en la cuenta una operación que el banco ya procesó.", 409)
  return data
}

// ─── La orden frente al banco ──────────────────────────────────────────────

/**
 * Por qué NO se puede confirmar / cancelar / eliminar la orden por algo que tiene con el banco.
 * null = puede seguir. La regla está en la base (bancos_bloqueo_orden): acá se pregunta antes
 * para avisar con claridad; si igual se intenta, la base corta con el mismo mensaje.
 * Solo cuentan las operaciones del banco real.
 */
export async function bloqueoPorBanco(db: SupabaseClient, ordenPagoId: string, accion: "confirmar" | "cancelar" | "eliminar" = "confirmar"): Promise<string | null> {
  const { data, error } = await db.rpc("bancos_bloqueo_orden", { p_op_id: ordenPagoId, p_accion: accion })
  if (error) { if (faltaTablaBancos(error)) return null; throw new Error(error.message) }
  return typeof data === "string" && data.trim() ? data : null
}

/**
 * ¿Se puede ANULAR esta orden pagada? No, si el banco real ya hizo el pago (o todavía lo puede
 * hacer): anularla devolvería la deuda al proveedor y los vencimientos quedarían para pagar otra
 * vez (pago doble). Desde 20261119n la base corta igual (op_anular → bancos_bloqueo_orden
 * 'anular'); esto avisa antes y anda aunque esa migración no esté aplicada.
 */
export async function bloqueoAnularPorBanco(db: SupabaseClient, ordenPagoId: string): Promise<string | null> {
  const { data, error } = await db.from("bancos_operaciones").select("estado, monto, tipo, creado_at")
    .eq("orden_pago_id", ordenPagoId).eq("ambiente", "produccion").neq("estado", "rechazada")
  if (error) { if (faltaTablaBancos(error)) return null; throw new Error(error.message) }
  const ops = (data ?? []) as Fila[]
  if (!ops.length) return null
  const hecha = ops.find((o) => estaHecha(o.estado as EstadoOperacion))
  if (hecha) {
    const que = hecha.tipo === "transferencia" ? "transferencia" : hecha.tipo === "echeq_emision" ? "e-cheq emitido" : hecha.tipo === "echeq_endoso" ? "e-cheq endosado" : hecha.tipo
    return `No se puede anular: Credicoop ya hizo el pago de ${moneda(Number(hecha.monto))} de esta orden (${que}) y la plata salió. Si se anula, la deuda vuelve a la cuenta corriente del proveedor y los vencimientos quedan para pagar otra vez: sería un pago doble. Si el proveedor devuelve la plata o hay que corregir algo, registralo aparte (nota de crédito o ajuste en la cuenta corriente del proveedor) y avisá a sistemas.`
  }
  return `No se puede anular: esta orden tiene un pago de ${moneda(Number(ops[0].monto))} mandado a Credicoop que todavía puede salir. Primero rechazá esa operación en Banca Internet Empresa y tocá “Actualizar estado” en el botón de Credicoop de la orden.`
}

/**
 * ¿La orden está pendiente y todo lo que se mandó al banco real quedó hecho? Es el momento en que
 * se puede confirmar. Con CONFIRMAR_SOLA la confirma el sistema (lib/bancos/confirmar-sola.ts).
 */
export async function ordenListaParaConfirmar(db: SupabaseClient, ordenPagoId: string): Promise<boolean> {
  const [{ data: op }, { data: ops, error }] = await Promise.all([
    db.from("ordenes_pago").select("estado").eq("id", ordenPagoId).maybeSingle(),
    db.from("bancos_operaciones").select("id").eq("orden_pago_id", ordenPagoId).eq("ambiente", "produccion").limit(1),
  ])
  if (error || op?.estado !== "pendiente" || !ops?.length) return false
  return (await bloqueoPorBanco(db, ordenPagoId, "confirmar")) === null
}

/**
 * Decisión de Juan (19/11/2026): «se confirma como pagada cuando el banco confirma la
 * transferencia y se envía la orden de pago en caso de tener alguien a quien mandárselo, si no,
 * queda cerrada sin enviar.» La confirmación sola vive en lib/bancos/confirmar-sola.ts
 * (confirmarSiElBancoTermino): pasa por el mismo camino que el tilde verde. Poner esto en false
 * la apaga y la orden vuelve a confirmarla una persona.
 */
export const CONFIRMAR_SOLA = true
