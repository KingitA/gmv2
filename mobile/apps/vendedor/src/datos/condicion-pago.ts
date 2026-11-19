// Condición de pago y deuda vencida en la app del vendedor (condiciones de pago, fase 4 —
// 19/11/2026). Reglas puras (las prueban los tests). El texto sale de @gm/condicion-pago:
// el mismo que muestra el ERP ("Contado · Efectivo", "Cuenta corriente 30 días · Cheque a 60 días").

import { normalizarCondicion, textoCondicionPago, type CondicionPago } from "@gm/condicion-pago"
import type { Cliente } from "../datasets"

/** Condición de la ficha del cliente (campos nuevos), normalizada. */
export function condicionDeCliente(c: Partial<Cliente> | null | undefined): CondicionPago {
  return normalizarCondicion({
    condicion_pago_tipo: c?.condicion_pago_tipo ?? null,
    plazo_dias: c?.plazo_dias ?? null,
    forma_pago: c?.forma_pago ?? null,
    cheque_dias_desde: c?.cheque_dias_desde ?? null,
    cheque_dias_hasta: c?.cheque_dias_hasta ?? null,
  })
}

/**
 * Texto para mostrar: el nuevo si la ficha lo tiene; si no, el texto viejo (réplica de
 * antes de la fase 1 o alta hecha en este equipo con una APK vieja). "" = sin cargar.
 */
export function textoCondicionCliente(c: Partial<Cliente> | null | undefined): string {
  return textoCondicionPago(condicionDeCliente(c)) || (c?.condicion_pago ?? "").trim()
}

export type FiltroDeuda = "" | "vencida" | "a_vencer"

const hay = (n: number | null | undefined) => (Number(n) || 0) > 0.005

/**
 * Deuda vencida = algo vencido (aunque también tenga a vencer); a vencer = debe y nada
 * está vencido todavía. Sin el dato del servidor (null) no entra en ninguno de los dos.
 */
export function pasaFiltroDeuda(c: Pick<Cliente, "deuda_vencida" | "deuda_a_vencer">, filtro: FiltroDeuda): boolean {
  if (!filtro) return true
  if (filtro === "vencida") return hay(c.deuda_vencida)
  return !hay(c.deuda_vencida) && hay(c.deuda_a_vencer)
}

/** Lo que va en la fila: "Vencida $X" (rojo) o "A vencer $X · vence dd/mm". null = nada. */
export function resumenDeuda(c: Pick<Cliente, "deuda_vencida" | "deuda_a_vencer" | "proximo_vencimiento">): { tipo: "vencida" | "a_vencer"; monto: number; vence: string | null } | null {
  if (hay(c.deuda_vencida)) return { tipo: "vencida", monto: Number(c.deuda_vencida), vence: null }
  if (hay(c.deuda_a_vencer)) return { tipo: "a_vencer", monto: Number(c.deuda_a_vencer), vence: c.proximo_vencimiento ?? null }
  return null
}
