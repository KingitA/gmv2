// Contexto de CAPTURA de un pedido tomado en un dispositivo (app Vendedor).
//
// Regla de negocio (MOBILE.md §5 y §18): el pedido se factura a los precios que
// el vendedor tenía a la vista cuando lo tomó. El handler del outbox reconstruye
// los insumos de precio vigentes a esa hora (lib/mobile/precios-integridad.ts) y
// ejecuta las MISMAS funciones que usa la web (lib/actions/pedidos.ts) dentro de
// este contexto: sus helpers de lectura de insumos consultan `capturaActual()` y,
// si hay contexto, usan los insumos reconstruidos en vez de leer la base.
//
// Por qué AsyncLocalStorage y no un parámetro: las funciones de pedidos.ts son
// server actions ("use server") ⇒ todo parámetro es controlable por un cliente
// remoto. Un contexto en memoria del proceso NO se puede fijar desde afuera: solo
// lo abre código del servidor (el handler del outbox). Sin contexto (toda la web)
// el comportamiento es exactamente el de siempre.

import { AsyncLocalStorage } from "node:async_hooks"
import type { InsumosCliente } from "@/lib/pricing/motor"

export interface CapturaPedido {
  clienteId: string
  /** ISO: momento al que se reconstruyeron los insumos */
  vigenciaAt: string
  insumos: InsumosCliente
  /** Artículos (columnas de precio + descuentos) vigentes a `vigenciaAt`, por id */
  articulos: Map<string, Record<string, any>>
  /** Id del pedido en el dispositivo: se guarda en pedidos.movil_local_id (UNIQUE) */
  localId?: string | null
  /** Fecha del pedido (YYYY-MM-DD, hora Argentina de la captura) */
  fecha?: string | null
}

const almacen = new AsyncLocalStorage<CapturaPedido>()

export function conCaptura<T>(captura: CapturaPedido, fn: () => Promise<T>): Promise<T> {
  return almacen.run(captura, fn)
}

/** Captura vigente para ESTE cliente, o null (toda la web; otro cliente). */
export function capturaActual(clienteId?: string | null): CapturaPedido | null {
  const c = almacen.getStore() ?? null
  if (!c) return null
  if (clienteId && c.clienteId !== clienteId) return null
  return c
}

/** Columnas de listas/métodos de la ficha que participan del precio. */
const COLS_CLIENTE = [
  "metodo_facturacion", "lista_precio_id",
  "lista_limpieza_id", "metodo_limpieza",
  "lista_perf0_id", "metodo_perf0",
  "lista_perf_plus_id", "metodo_perf_plus",
] as const

/** Ficha del cliente con las listas/métodos vigentes a la captura (el resto, actual). */
export function clienteCapturado<T extends Record<string, any>>(clienteInfo: T, clienteId?: string | null): T {
  const c = capturaActual(clienteId ?? clienteInfo?.id)
  if (!c) return clienteInfo
  const out: Record<string, any> = { ...clienteInfo }
  const cap = c.insumos.cliente as Record<string, any>
  for (const k of COLS_CLIENTE) if (k in cap) out[k] = cap[k]
  return out as T
}
