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
 * Nada de esto toca la cuenta corriente, los vencimientos ni la caja: eso lo sigue haciendo la
 * confirmación de la orden de pago, como siempre.
 */
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { hoyISO, sumarDiasISO } from "@/lib/formato"
import { importarExtracto } from "@/lib/finanzas/extractos-import"
import { clienteCredicoop, estadoConexion } from "./credicoop/config"
import {
  armarEmisionEcheq, armarGestionEcheq, armarListaEcheqs, armarListaVeps, armarPagoVep, armarTransferencia, cbuValido, cuitDeOnce,
  ErrorCredicoop, esEstadoFinal, estaHecha, type EstadoOperacion, type ResultadoOperacion,
} from "./credicoop/nucleo"

export type TipoOperacion = "transferencia" | "echeq_emision" | "echeq_endoso" | "vep"
type Fila = Record<string, any>

export const TIPO_NOMBRE: Record<TipoOperacion, string> = {
  transferencia: "Transferencia", echeq_emision: "Emisión de e-cheq", echeq_endoso: "Endoso de e-cheq", vep: "Pago de VEP",
}

/** La tabla todavía no existe (falta aplicar la migración 20261119d). */
export const faltaTablaBancos = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  return err?.code === "42P01" || err?.code === "PGRST205" || /bancos_operaciones/.test(String(err?.message ?? "")) && /does not exist|could not find/i.test(String(err?.message ?? ""))
}
export const AVISO_SIN_TABLA = "Falta aplicar la migración 20261119d_bancos_operaciones.sql: todavía no se pueden mandar operaciones al banco."

/** ¿Esta cuenta bancaria es de Credicoop y se opera por la API? */
export const esCuentaCredicoop = (c: Fila | null | undefined) =>
  !!c && (c.api_banco === "credicoop" || (!c.api_banco && /credicoop/i.test(String(c.banco ?? ""))))

/** Error que se le muestra tal cual a la persona (dato que falta, estado que no corresponde…). */
export class ErrorOperacion extends Error {
  name = "ErrorOperacion"
  constructor(mensaje: string, public status = 422) { super(mensaje) }
}

// ─── Qué se puede mandar de una orden de pago ──────────────────────────────

export interface PagoEnviable {
  detalle_id: string
  tipo: TipoOperacion
  tipo_nombre: string
  banco: string
  cuenta: string | null
  cuenta_cbu: string | null
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
    db.from("cuentas_bancarias").select("*").eq("activo", true),
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
  const hoy = hoyISO()
  const pagos: PagoEnviable[] = []
  for (const d of detalles) {
    const cheque = d.cheque_id ? chequeDe.get(d.cheque_id) ?? null : null
    const esEndoso = d.medio === "cheque" && !!d.cheque_id
    // Cheque de tercero en papel, o cheque propio en papel: no pasan por el banco
    if (esEndoso && !cheque?.es_echeq) continue
    if (!esEndoso && d.medio !== "transferencia" && !d.es_echeq) continue
    const tipo: TipoOperacion = d.medio === "transferencia" ? "transferencia" : esEndoso ? "echeq_endoso" : "echeq_emision"
    // Endoso: la cuenta es la de Credicoop habilitada (la primera); el resto, la cuenta de la que sale el pago
    const cuenta = esEndoso ? cuentasCredicoop[0] ?? null : (d.cuenta_origen_tipo === "BANCO" ? cuentaDe.get(d.cuenta_origen_id) ?? null : null)
    const cbuBenef = String(d.cbu || prov?.cbu || "").replace(/[^0-9]/g, "") || null
    const problemas: string[] = []
    if (op.estado !== "pendiente") problemas.push(op.estado === "pagada"
      ? "La orden ya está confirmada como pagada. Para mandar un pago a Credicoop, la orden tiene que estar pendiente: el pago se confirma después de que el banco lo procese."
      : `La orden está ${op.estado}.`)
    if (!cuenta) problemas.push(esEndoso ? "No hay ninguna cuenta de Credicoop habilitada para endosar e-cheq." : "Este pago no tiene elegida la cuenta bancaria de la que sale.")
    else if (!esCuentaCredicoop(cuenta)) problemas.push(`La cuenta "${cuenta.nombre}" no es de Credicoop: este pago no se manda por el sistema.`)
    else if (!cbuValido(String(cuenta.cbu ?? ""))) problemas.push(`La cuenta "${cuenta.nombre}" no tiene cargado su CBU de 22 dígitos (Finanzas → Cuentas).`)
    if (!cuitDeOnce(prov?.cuit)) problemas.push(`Falta el CUIT de ${prov?.nombre ?? "el proveedor"} en su ficha.`)
    if (tipo === "transferencia" && !cbuValido(cbuBenef ?? "")) problemas.push(`Falta el CBU de ${prov?.nombre ?? "el proveedor"} (22 dígitos) en su ficha.`)
    if (!(Number(d.monto) > 0)) problemas.push("El importe del pago no es válido.")
    const fecha = tipo === "transferencia" ? hoy : String((esEndoso ? cheque?.fecha_vencimiento : d.cheque_fecha_vencimiento) ?? "").slice(0, 10)
    if (tipo === "echeq_emision" && (!fecha || fecha < hoy)) problemas.push("La fecha de pago del e-cheq falta o ya pasó: no se puede emitir con esa fecha.")
    if (sinTabla) problemas.push(AVISO_SIN_TABLA)
    pagos.push({
      detalle_id: d.id, tipo, tipo_nombre: TIPO_NOMBRE[tipo], banco: "Banco Credicoop",
      cuenta: cuenta?.nombre ?? null, cuenta_cbu: cuenta?.cbu ?? null,
      beneficiario: prov?.nombre ?? "—", beneficiario_cuit: cuitDeOnce(prov?.cuit), beneficiario_cbu: tipo === "transferencia" ? cbuBenef : null,
      monto: Math.round(Number(d.monto) * 100) / 100, fecha,
      cheque: esEndoso && cheque ? { id: cheque.id, numero: cheque.numero ?? null, banco: cheque.banco ?? null, echeq_id: cheque.echeq_id ?? null } : null,
      problemas,
      operacion: operaciones.find((o) => o.orden_pago_detalle_id === d.id && o.estado !== "rechazada") ?? operaciones.find((o) => o.orden_pago_detalle_id === d.id) ?? null,
    })
  }
  return {
    orden: { id: op.id, numero_op: op.numero_op, estado: op.estado, proveedor: prov?.nombre ?? "—", proveedor_id: op.proveedor_id },
    vencimiento_ids: [...new Set(((op.ordenes_pago_imputaciones ?? []) as Fila[]).map((i) => i.vencimiento_id).filter(Boolean))] as string[],
    pagos, conexion: estadoConexion(), _interno: { prov, cuentaDe, chequeDe, cuentasCredicoop, detalles },
  }
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

/**
 * El camino único de todo envío: arma el pedido (si falta un dato corta ACÁ, sin guardar ni
 * enviar), guarda la operación como "preparada", la manda y anota qué contestó el banco.
 */
async function enviar(db: SupabaseClient, usuarioId: string | null, datos: Nueva,
  armar: (idOrigen: string, empresa: { numeroAdherente: number; firmantes?: Array<{ documento: string; documentoTipo: string }> }) => unknown,
  mandar: (pedido: unknown) => Promise<{ cruda: unknown; resultado: ResultadoOperacion }>,
  ambiente: string, empresa: { numeroAdherente: number; firmantes?: Array<{ documento: string; documentoTipo: string }> }): Promise<Fila> {
  const idOrigen = randomUUID()
  const pedido = armar(idOrigen, empresa)   // lanza ErrorCredicoop("DATOS") si falta algo: no se guardó nada

  const { data: fila, error } = await db.from("bancos_operaciones").insert({
    ...datos, vencimiento_ids: datos.vencimiento_ids ?? [], ambiente, id_origen: idOrigen, estado: "preparada", pedido, creado_por: usuarioId, actualizado_por: usuarioId,
  }).select("*").single()
  if (error) {
    if (faltaTablaBancos(error)) throw new ErrorOperacion(AVISO_SIN_TABLA, 503)
    if (error.code === "23505") throw new ErrorOperacion("Ese pago ya tiene una operación en curso en Credicoop. Tocá “Actualizar estado” para ver cómo está: no se mandó de nuevo.", 409)
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

/** Guarda lo que dijo el banco. Al quedar hecha, anota el número de operación en el medio de pago de la orden. */
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
  // Referencia del banco en el medio de pago (solo un texto de referencia: no mueve nada)
  if (estaHecha(r.estado) && data.orden_pago_detalle_id && data.tipo === "transferencia" && data.id_operacion_banco) {
    await db.from("ordenes_pago_detalle").update({ numero_transferencia: String(data.id_operacion_banco), fecha_transferencia: data.fecha_pago })
      .eq("id", data.orden_pago_detalle_id).is("numero_transferencia", null)
  }
  if (estaHecha(r.estado) && data.tipo === "echeq_endoso" && data.cheque_id && data.id_cheque_banco) {
    await db.from("cheques").update({ echeq_id: data.id_cheque_banco }).eq("id", data.cheque_id).is("echeq_id", null)
  }
  return data
}

/** Manda a Credicoop, para firmar, UN medio de pago de una orden de pago pendiente. */
export async function enviarPagoDeOrden(db: SupabaseClient, ordenPagoId: string, detalleId: string, usuarioId: string | null): Promise<Fila> {
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
    return enviar(db, usuarioId, { ...base, cuenta_bancaria_id: cuenta.id },
      (idOrigen, empresa) => armarEmisionEcheq(empresa, { idOrigen, cbuCuentaDebito: String(cuenta.cbu), hoy, echeqs: [{
        monto: pago.monto, fechaPago: pago.fecha, beneficiarioNombre: prov!.nombre, beneficiarioCuit: prov!.cuit, concepto: "FAC", motivo: `Orden de pago ${info.orden.numero_op}`,
      }] }), cliente.emitirEcheq, ambiente, cliente.empresa)
  }
  // Endoso de un e-cheq que nos dio un cliente
  const cuenta = cuentasCredicoop[0]
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
    await db.from("cheques").update({ echeq_id: idCheque, ...(iguales[0].cmc7 ? { cmc7: iguales[0].cmc7 } : {}) }).eq("id", cheque.id)
  }
  return enviar(db, usuarioId, { ...base, cuenta_bancaria_id: cuenta.id, cheque_id: cheque.id, id_cheque_banco: idCheque },
    (idOrigen, empresa) => armarGestionEcheq(empresa, { idOrigen, cbuCuenta: String(cuenta.cbu), accion: "ENDOSAR", echeqs: [{ idCheque }], beneficiarioCuit: prov!.cuit }),
    cliente.gestionarEcheq, ambiente, cliente.empresa)
}

/**
 * Le pregunta al banco cómo quedó una operación y lo anota. Es lo que hay que hacer ante una
 * duda, antes de reenviar. Si el banco no la conoce, es que nunca había entrado: queda
 * rechazada y se puede volver a mandar.
 */
export async function actualizarOperacion(db: SupabaseClient, operacionId: string, usuarioId: string | null): Promise<Fila> {
  const { data: op, error } = await db.from("bancos_operaciones").select("*").eq("id", operacionId).maybeSingle()
  if (error) { if (faltaTablaBancos(error)) throw new ErrorOperacion(AVISO_SIN_TABLA, 503); throw new Error(error.message) }
  if (!op) throw new ErrorOperacion("La operación no existe.", 404)
  if (op.estado === "rechazada" || op.estado === "acreditada") return op   // ya terminó
  const { cliente } = clienteCredicoop()
  const ahora = new Date().toISOString()
  try {
    if (op.tipo === "echeq_endoso") {
      // El banco no publica una consulta para las gestiones de e-cheq: se mira el estado del cheque.
      // Si ya no está ACTIVO en nuestro poder (pasó a ACTIVO-PENDIENTE: endosado, esperando que el
      // proveedor lo acepte, o ya ni figura entre los recibidos), el endoso se hizo.
      const lista = await cliente.listarEcheqs(armarListaEcheqs(cliente.empresa, { idOrigen: randomUUID(), gestion: "RECIBIDOS", estado: "TODOS", idCheque: op.id_cheque_banco }))
      const ch = lista.echeqs.find((c) => c.idCheque === op.id_cheque_banco)
      const estadoCheque = ch?.estado ?? "(ya no figura entre los recibidos)"
      const hecho = !ch || ch.estado !== "ACTIVO"
      return anotar(db, op.id, usuarioId, {
        idOperacion: op.id_operacion_banco, estado: hecho ? "firmada" : (op.estado === "error" ? "error" : "enviada_a_firma") as EstadoOperacion,
        estadoBanco: `E-cheq ${estadoCheque}`, motivo: hecho ? null : "El e-cheq sigue activo en nuestro poder: el endoso todavía no está firmado.",
      }, { echeq: ch ?? null })
    }
    const consulta = op.tipo === "transferencia" ? cliente.consultarTransferencia : op.tipo === "echeq_emision" ? cliente.consultarEcheq : cliente.consultarPagoVep
    const { cruda, resultado } = await consulta({ idOrigen: op.id_origen })
    return anotar(db, op.id, usuarioId, resultado, cruda)
  } catch (e) {
    // El banco no conoce esa operación: nunca entró. Solo vale para una que estaba en duda o sin enviar.
    if (e instanceof ErrorCredicoop && e.clase === "RECHAZO" && ["APIE-0026", "APIE-1025", "APIE-4024"].includes(e.codigo ?? "") && (op.estado === "error" || op.estado === "preparada")) {
      const { data } = await db.from("bancos_operaciones").update({
        estado: "rechazada", motivo: "El banco no tiene esta operación: no había entrado. Se puede volver a mandar.", respuesta: e.detalle ?? null, actualizado_at: ahora, actualizado_por: usuarioId,
      }).eq("id", op.id).select("*").single()
      return data ?? op
    }
    throw e
  }
}

// ─── VEP ───────────────────────────────────────────────────────────────────

export async function cuentasCredicoopDelSistema(db: SupabaseClient): Promise<Fila[]> {
  const { data, error } = await db.from("cuentas_bancarias").select("*").eq("activo", true).order("nombre")
  if (error) throw new Error(error.message)
  return ((data ?? []) as Fila[]).filter(esCuentaCredicoop)
}

/** VEP de ARCA pendientes de pago, con la operación en curso de cada uno si ya se mandó. */
export async function vepsPendientes(db: SupabaseClient) {
  const { cliente } = clienteCredicoop()
  const hoy = hoyISO()
  const veps = await cliente.listarVeps(armarListaVeps(cliente.empresa, { idOrigen: randomUUID(), estado: "PENDIENTE_PAGO", desde: sumarDiasISO(hoy, -170), hasta: sumarDiasISO(hoy, 10) }))
  const numeros = veps.map((v) => v.numeroVep).filter(Boolean)
  let ops: Fila[] = []
  if (numeros.length) {
    const r = await db.from("bancos_operaciones").select("*").eq("tipo", "vep").in("numero_vep", numeros).neq("estado", "rechazada")
    if (r.error) { if (!faltaTablaBancos(r.error)) throw new Error(r.error.message) } else ops = (r.data ?? []) as Fila[]
  }
  return veps.map((v) => ({ ...v, operacion: ops.find((o) => o.numero_vep === v.numeroVep) ?? null }))
}

/** Manda a firmar el pago de UN VEP. El importe y los CUIT se toman del banco, no de lo que diga la pantalla. */
export async function enviarPagoVep(db: SupabaseClient, p: { numeroVep: string; cuentaBancariaId: string; vencimientoId?: string | null }, usuarioId: string | null): Promise<Fila> {
  const { cliente, ambiente } = clienteCredicoop()
  const { data: cuenta, error } = await db.from("cuentas_bancarias").select("*").eq("id", p.cuentaBancariaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!cuenta || !esCuentaCredicoop(cuenta)) throw new ErrorOperacion("Elegí una cuenta de Credicoop para pagar el VEP.")
  if (!cbuValido(String(cuenta.cbu ?? ""))) throw new ErrorOperacion(`La cuenta "${cuenta.nombre}" no tiene cargado su CBU de 22 dígitos (Finanzas → Cuentas).`)
  // Se vuelve a pedir la lista: el VEP tiene que seguir pendiente y el importe es el que informa ARCA
  const hoy = hoyISO()
  const veps = await cliente.listarVeps(armarListaVeps(cliente.empresa, { idOrigen: randomUUID(), estado: "PENDIENTE_PAGO", desde: sumarDiasISO(hoy, -170), hasta: sumarDiasISO(hoy, 10) }))
  const vep = veps.find((v) => v.numeroVep === String(p.numeroVep))
  if (!vep) throw new ErrorOperacion(`El VEP ${p.numeroVep} ya no figura como pendiente de pago en Credicoop.`)
  if (!(Number(vep.monto) > 0)) throw new ErrorOperacion(`El banco no informa el importe del VEP ${p.numeroVep}: no se puede mandar.`)
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
 */
export async function traerMovimientos(db: SupabaseClient, p: { cuentaBancariaId: string; desde: string; hasta: string }, usuarioId: string | null) {
  const { cliente } = clienteCredicoop()
  const { data: cuenta, error } = await db.from("cuentas_bancarias").select("*").eq("id", p.cuentaBancariaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!cuenta || !esCuentaCredicoop(cuenta)) throw new ErrorOperacion("Elegí una cuenta de Credicoop.")
  let nroCuenta = String(cuenta.numero_cuenta_banco ?? "").trim()
  if (!nroCuenta) {
    // La primera vez se busca el número de cuenta del banco por el CBU
    const cbu = String(cuenta.cbu ?? "").replace(/[^0-9]/g, "")
    const cuentas = await cliente.cuentas()
    const encontrada = cuentas.find((c) => c.cbu === cbu)
    if (!encontrada) throw new ErrorOperacion(`Credicoop no informa ninguna cuenta con el CBU cargado en "${cuenta.nombre}". Revisá el CBU en Finanzas → Cuentas.`)
    nroCuenta = encontrada.nroCuenta
    await db.from("cuentas_bancarias").update({ numero_cuenta_banco: nroCuenta }).eq("id", cuenta.id)
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
  const importado = movimientos.length
    ? await importarExtracto(db, { cuenta_bancaria_id: cuenta.id, fuente: "api_banco", movimientos, periodo_desde: p.desde, periodo_hasta: p.hasta, saldo_final: r.saldo, importado_por: usuarioId })
    : null

  // Propuesta (no se aplica sola): débitos que coinciden con una operación firmada desde el sistema
  let coincidencias: Array<{ operacion_id: string; tipo: string; beneficiario: string | null; monto: number; fecha_movimiento: string; descripcion: string }> = []
  const ops = await db.from("bancos_operaciones").select("*").eq("cuenta_bancaria_id", cuenta.id).eq("estado", "firmada").in("tipo", ["transferencia", "vep"])
  if (!ops.error) {
    const libres = [...r.movimientos.filter((m) => m.monto < 0)]
    for (const o of (ops.data ?? []) as Fila[]) {
      const i = libres.findIndex((m) => Math.abs(Math.abs(m.monto) - Number(o.monto)) < 0.01 && o.fecha_pago && m.fecha >= o.fecha_pago && m.fecha <= sumarDiasISO(o.fecha_pago, 3))
      if (i < 0) continue
      const [m] = libres.splice(i, 1)
      coincidencias.push({ operacion_id: o.id, tipo: TIPO_NOMBRE[o.tipo as TipoOperacion], beneficiario: o.beneficiario_nombre, monto: Number(o.monto), fecha_movimiento: m.fecha, descripcion: m.descripcion })
    }
  }
  return { cuenta: cuenta.nombre, traidos: r.movimientos.length, saldo: r.saldo, parcial: r.parcial, importado, coincidencias }
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

/**
 * ¿La orden tiene algo mandado a Credicoop que todavía no terminó? Mientras sea así no se puede
 * confirmar (el pago no se da por hecho hasta que el banco lo procese). null = puede seguir.
 */
export async function bloqueoPorBanco(db: SupabaseClient, ordenPagoId: string): Promise<string | null> {
  const { data, error } = await db.from("bancos_operaciones").select("tipo, estado, monto").eq("orden_pago_id", ordenPagoId).neq("estado", "rechazada")
  if (error) { if (faltaTablaBancos(error)) return null; throw new Error(error.message) }
  const abiertas = ((data ?? []) as Fila[]).filter((o) => !esEstadoFinal(o.estado as EstadoOperacion))
  if (!abiertas.length) return null
  const enDuda = abiertas.some((o) => o.estado === "error")
  return `Esta orden tiene ${abiertas.length === 1 ? "un pago mandado" : `${abiertas.length} pagos mandados`} a Credicoop que todavía no ${abiertas.length === 1 ? "está procesado" : "están procesados"} `
    + `(${enDuda ? "hay uno en duda: " : ""}falta la firma con token o que el banco termine). Tocá “Actualizar estado” en el botón de Credicoop de la orden; se puede confirmar cuando el banco diga que quedó hecho.`
}
