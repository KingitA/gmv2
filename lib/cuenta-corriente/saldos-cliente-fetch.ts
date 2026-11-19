"use client"

import type { SaldosCliente } from "@/lib/cuenta-corriente/saldo"

/**
 * Saldos de un cliente para las pantallas del ERP (navegador), desde la fuente
 * única del servidor (GET /api/clientes/saldos). null si no se pudo leer.
 */
/** Deuda vencida / a vencer (fase 3); null si la base todavía no la tiene. */
export interface VencimientosCliente {
  deuda_vencida: number | null
  deuda_a_vencer: number | null
  proximo_vencimiento: string | null
}

export async function traerSaldosCliente(clienteId: string): Promise<(SaldosCliente & Partial<VencimientosCliente>) | null> {
  try {
    const r = await fetch(`/api/clientes/saldos?ids=${encodeURIComponent(clienteId)}`)
    if (!r.ok) return null
    const j = await r.json()
    return (j.saldos?.[clienteId] as SaldosCliente & Partial<VencimientosCliente>) ?? null
  } catch {
    return null
  }
}
