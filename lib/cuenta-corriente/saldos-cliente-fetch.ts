"use client"

import type { SaldosCliente } from "@/lib/cuenta-corriente/saldo"

/**
 * Saldos de un cliente para las pantallas del ERP (navegador), desde la fuente
 * única del servidor (GET /api/clientes/saldos). null si no se pudo leer.
 */
export async function traerSaldosCliente(clienteId: string): Promise<SaldosCliente | null> {
  try {
    const r = await fetch(`/api/clientes/saldos?ids=${encodeURIComponent(clienteId)}`)
    if (!r.ok) return null
    const j = await r.json()
    return (j.saldos?.[clienteId] as SaldosCliente) ?? null
  } catch {
    return null
  }
}
