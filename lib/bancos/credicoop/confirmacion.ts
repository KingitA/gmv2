/**
 * ¿La orden de pago se confirma sola? Regla PURA (sin base ni red) — test: credicoop.test.ts.
 *
 * Decisión de Juan (19/11/2026): «se confirma como pagada cuando el banco confirma la
 * transferencia y se envía la orden de pago en caso de tener alguien a quien mandárselo, si no,
 * queda cerrada sin enviar.»
 *
 * La orden se confirma sola cuando:
 *   - está pendiente;
 *   - por cada medio de pago que se mandó al banco, la ÚLTIMA operación quedó hecha (firmada o
 *     vista en la cuenta) y por el mismo importe;
 *   - y no queda ningún medio de pago que no haya pasado por el banco (efectivo, cheque en papel,
 *     una transferencia de otra cuenta): esos los confirma una persona.
 *
 * Solo cuentan las operaciones del ambiente pedido. En el sistema real es "produccion": lo del
 * simulador o del banco de prueba nunca confirma una orden. El ambiente es un parámetro para
 * poder ejercitar la misma regla en las pruebas sin tocar órdenes reales.
 */
import { estaHecha, type EstadoOperacion } from "./nucleo"

export interface MedioDeOrden { id: string; medio: string; monto: number }
export interface OperacionDeOrden {
  id: string
  orden_pago_detalle_id: string | null
  estado: string
  ambiente: string
  monto: number
  creado_at: string
  creado_por?: string | null
}

export type DecisionConfirmar =
  /** No hay nada que decidir: la orden no está pendiente o no tiene operaciones de ese ambiente */
  | { accion: "nada" }
  /** Hay algo del banco sin terminar (esperando la firma, en duda, rechazado sin reenviar) */
  | { accion: "esperar"; motivo: string }
  /** El banco terminó lo suyo, pero quedan medios de pago que no pasan por el banco */
  | { accion: "falta_resto"; medios: string[] }
  /** Todo hecho: se confirma. `operacion` es la última que mandó alguien (quién y cuándo) */
  | { accion: "confirmar"; operacion: OperacionDeOrden }

const MEDIO_NOMBRE: Record<string, string> = {
  efectivo: "efectivo", cheque: "cheque", cheque_propio: "cheque propio", transferencia: "transferencia", deposito: "depósito",
}
export const nombreMedio = (m: string) => MEDIO_NOMBRE[m] ?? m

export function decidirConfirmacion(orden: { estado: string }, medios: MedioDeOrden[], operaciones: OperacionDeOrden[], ambiente = "produccion"): DecisionConfirmar {
  if (orden.estado !== "pendiente") return { accion: "nada" }
  const delAmbiente = operaciones.filter((o) => o.ambiente === ambiente && o.orden_pago_detalle_id)
  if (delAmbiente.length === 0) return { accion: "nada" }

  // La última operación de cada medio de pago es la que manda
  const ultima = new Map<string, OperacionDeOrden>()
  for (const o of delAmbiente) {
    const previa = ultima.get(o.orden_pago_detalle_id!)
    if (!previa || o.creado_at > previa.creado_at) ultima.set(o.orden_pago_detalle_id!, o)
  }
  for (const m of medios) {
    const o = ultima.get(m.id)
    if (!o) continue
    if (!estaHecha(o.estado as EstadoOperacion)) {
      return { accion: "esperar", motivo: o.estado === "rechazada" ? "El banco rechazó un pago de esta orden: no salió." : "Hay un pago de esta orden que el banco todavía no procesó." }
    }
    if (Math.abs(Number(o.monto) - Number(m.monto)) > 0.005) return { accion: "esperar", motivo: "El importe que procesó el banco no coincide con el del pago de la orden." }
  }
  const sinBanco = medios.filter((m) => Number(m.monto) > 0 && !ultima.has(m.id))
  if (sinBanco.length > 0) return { accion: "falta_resto", medios: [...new Set(sinBanco.map((m) => nombreMedio(m.medio)))] }

  const deLaOrden = medios.map((m) => ultima.get(m.id)).filter(Boolean) as OperacionDeOrden[]
  if (deLaOrden.length === 0) return { accion: "nada" }
  return { accion: "confirmar", operacion: deLaOrden.reduce((a, b) => (b.creado_at > a.creado_at ? b : a)) }
}

/**
 * ¿Es horario bancario en la Argentina (lunes a viernes, de 8 a 20)? Fuera de ese horario el
 * banco no firma ni procesa: no tiene sentido consultarle. `ahora` es el instante; la hora se
 * calcula en GMT-3 (la Argentina no cambia la hora).
 */
export function esHorarioBancario(ahora: Date): boolean {
  const ar = new Date(ahora.getTime() - 3 * 3600_000)
  const dia = ar.getUTCDay()
  const hora = ar.getUTCHours()
  return dia >= 1 && dia <= 5 && hora >= 8 && hora < 20
}
