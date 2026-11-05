// "Cargar pedido" (05/11/2026): un pedido NUEVO armado desde el depósito, para el propio
// operario ("Para mí": va a su cuenta personal) o para un cliente. No se muestran ni se
// eligen precios, lista ni método: eso lo resuelve el servidor (op "pedido.cargar_deposito",
// handler del agente Listas de precios). Reglas puras: tests en
// packages/core/test/deposito-cargar.test.ts.

import type { ItemOutbox } from "@gm/core"
import type { ClienteDeposito } from "../datasets"
import { coincide, normalizar } from "./busqueda"

export const OP_CARGAR = "pedido.cargar_deposito"

export type ModoCarga = "propio" | "cliente"

export interface RenglonCarga {
  articulo_id: string
  cantidad: number
}

/** Pedido a medio cargar: vive en el equipo hasta que el servidor lo confirma. */
export interface BorradorCarga {
  /** id lógico del pedido: el servidor no lo crea dos veces aunque llegue repetido */
  local_id: string
  modo: ModoCarga
  cliente: ClienteDeposito | null
  items: RenglonCarga[]
  observaciones?: string
}

export interface PayloadCarga {
  local_id: string
  modo: ModoCarga
  cliente_id?: string
  items: RenglonCarga[]
  observaciones?: string
}

export function nuevoBorrador(modo: ModoCarga, cliente: ClienteDeposito | null, localId: string): BorradorCarga {
  return { local_id: localId, modo, cliente: modo === "cliente" ? cliente : null, items: [] }
}

/** Cantidad ABSOLUTA del artículo (escanearlo de nuevo la corrige, no la suma). 0 o menos = sacarlo. */
export function ponerCantidad(b: BorradorCarga, articuloId: string, cantidad: number): BorradorCarga {
  if (!(cantidad > 0)) return quitarRenglon(b, articuloId)
  const existe = b.items.some((i) => i.articulo_id === articuloId)
  return {
    ...b,
    items: existe ? b.items.map((i) => (i.articulo_id === articuloId ? { ...i, cantidad } : i)) : [...b.items, { articulo_id: articuloId, cantidad }],
  }
}

export function quitarRenglon(b: BorradorCarga, articuloId: string): BorradorCarga {
  return { ...b, items: b.items.filter((i) => i.articulo_id !== articuloId) }
}

export const cantidadDe = (b: BorradorCarga | null, articuloId: string) => b?.items.find((i) => i.articulo_id === articuloId)?.cantidad ?? null

export function payloadCarga(b: BorradorCarga): PayloadCarga {
  const p: PayloadCarga = { local_id: b.local_id, modo: b.modo, items: b.items.map((i) => ({ articulo_id: i.articulo_id, cantidad: i.cantidad })) }
  if (b.modo === "cliente" && b.cliente) p.cliente_id = b.cliente.id
  if (b.observaciones?.trim()) p.observaciones = b.observaciones.trim()
  return p
}

/** Un pedido rechazado por el servidor vuelve a ser borrador para corregirlo (mismo local_id). */
export function borradorDesdePayload(p: PayloadCarga, cliente: ClienteDeposito | null): BorradorCarga {
  return { local_id: p.local_id, modo: p.modo, cliente: p.modo === "cliente" ? cliente : null, items: p.items.map((i) => ({ ...i })), observaciones: p.observaciones }
}

/** Qué falta para poder cerrar (null = se puede). */
export function faltaParaCerrar(b: BorradorCarga): string | null {
  if (b.modo === "cliente" && !b.cliente) return "Elegí el cliente"
  if (b.items.length === 0) return "Cargá al menos un artículo"
  return null
}

/**
 * Buscador de clientes: código (empieza con lo tipeado, primero) o nombre / localidad /
 * dirección con todas las palabras (sin acentos). Menos de 2 letras y no es número: nada.
 * Un número de 1 o 2 cifras busca solo por código.
 */
export function buscarClientes(clientes: ClienteDeposito[], q0: string, limite = 50): ClienteDeposito[] {
  const q = q0.trim()
  const esNumero = /^\d+$/.test(q)
  if (!q || (!esNumero && normalizar(q).length < 2)) return []
  const porCodigo = esNumero ? clientes.filter((c) => (c.codigo || "").startsWith(q)) : []
  const exacto = porCodigo.filter((c) => c.codigo === q)
  // Un número corto es un código: no se busca en direcciones ("5" traería "Alsina 45")
  const resto = esNumero && q.length < 3 ? [] : clientes.filter((c) => !porCodigo.includes(c) && coincide(q, c.nombre, c.codigo, c.localidad, c.direccion))
  const ordenNombre = (a: ClienteDeposito, b: ClienteDeposito) => a.nombre.localeCompare(b.nombre, "es")
  return [...exacto, ...porCodigo.filter((c) => !exacto.includes(c)).sort(ordenNombre), ...resto.sort(ordenNombre)].slice(0, limite)
}

export type ResultadoCierre =
  | { tipo: "ok"; pedido_id: string | null; numero_pedido: string | null; cliente_nombre: string | null }
  | { tipo: "rechazo"; mensaje: string }
  | { tipo: "sin_senal" }

/**
 * Qué pasó con el cierre, mirando la operación del outbox después de intentar enviarla:
 * enviada ⇒ el servidor devolvió el número; rechazada ⇒ su mensaje tal cual (el pedido
 * vuelve a quedar abierto); cualquier otra cosa ⇒ sin señal (queda guardada y se envía sola).
 */
export function resultadoCierre(it: ItemOutbox | null): ResultadoCierre {
  if (it?.estado === "enviado") {
    const r = (it.resultado ?? {}) as { pedido_id?: string; numero_pedido?: string | number; cliente_nombre?: string }
    return { tipo: "ok", pedido_id: r.pedido_id ?? null, numero_pedido: r.numero_pedido != null ? String(r.numero_pedido) : null, cliente_nombre: r.cliente_nombre ?? null }
  }
  if (it?.estado === "rechazado") return { tipo: "rechazo", mensaje: it.error || "El servidor rechazó el pedido" }
  return { tipo: "sin_senal" }
}
