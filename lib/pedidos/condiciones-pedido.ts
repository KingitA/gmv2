// Condiciones CONGELADAS de un pedido (regla del dueño, 06/10/2026).
//
// El precio de un pedido se cierra cuando se toma. Desde ese momento el pedido
// no depende más de la ficha del cliente:
//   - pedidos.condiciones_cliente (jsonb) guarda la ficha comercial vigente al
//     tomarlo: listas/métodos (general y por segmento) y las bonificaciones
//     (general / viajante / mercadería / contado).
//   - pedido_proveedor_condicion / pedido_marca_condicion guardan TODAS las
//     condiciones por proveedor/marca que rigen el pedido (las de la ficha se
//     copian al crearlo, más las cargadas "solo para este pedido").
//   - pedidos.precios_al: momento de los precios del pedido.
// Cambiar la ficha después NO toca pedidos tomados. Todo lo que se haga sobre el
// mismo pedido (agregar ítems, cambiar sus condiciones) usa sus condiciones
// congeladas y los precios a `precios_al`. "Repreciar" (botón del modal del
// pedido) recalcula con los precios de HOY y mueve precios_al a ahora.
//
// Implementación: el mismo mecanismo de "captura" que usan los pedidos tomados
// en la app (lib/mobile/contexto-captura.ts): las funciones de pedidos.ts leen
// los insumos de la captura en vez de la base. Acá se arma una captura con la
// ficha congelada + listas/reglas/artículos reconstruidos a la fecha.
//
// Pedidos sin condiciones_cliente (viejos, ya facturados) siguen leyendo la
// ficha actual, como siempre.

import { capturaActual, conCaptura, type CapturaPedido } from "@/lib/mobile/contexto-captura"
import { insumosAFecha } from "@/lib/mobile/precios-integridad"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ClienteListas, CondicionMarca, CondicionProveedor, FilaBonifTipo } from "@/lib/pricing/resolver"
import { CONDICION_MARCA_COLS, CONDICION_PROVEEDOR_COLS } from "@/lib/pricing/cargar-insumos"

/** Contenido de pedidos.condiciones_cliente */
export interface CondicionesCliente {
  cliente: ClienteListas
  /** Filas activas de `bonificaciones` (sin proveedor): general, viajante, mercaderia, contado */
  bonificaciones: FilaBonifTipo[]
  tomado_at: string
}

export const TIPOS_BONIF_FICHA = ["general", "viajante", "mercaderia", "contado"] as const

const COLS_LISTAS = [
  "metodo_facturacion", "lista_precio_id",
  "lista_limpieza_id", "metodo_limpieza",
  "lista_perf0_id", "metodo_perf0",
  "lista_perf_plus_id", "metodo_perf_plus",
] as const

function soloListas(c: Record<string, any> | null | undefined): ClienteListas {
  const out: Record<string, any> = {}
  for (const k of COLS_LISTAS) out[k] = c?.[k] ?? null
  return out as ClienteListas
}

function filasBonif(rows: any[] | null | undefined): FilaBonifTipo[] {
  return (rows || [])
    .filter((b) => b && b.activo !== false && !b.proveedor_id && (TIPOS_BONIF_FICHA as readonly string[]).includes(b.tipo))
    .map((b) => ({ tipo: String(b.tipo), segmento: b.segmento || null, porcentaje: Number(b.porcentaje) || 0 }))
}

export function leerCondicionesCliente(v: unknown): CondicionesCliente | null {
  if (!v || typeof v !== "object") return null
  const o = v as any
  if (!o.cliente || typeof o.cliente !== "object") return null
  return {
    cliente: soloListas(o.cliente),
    bonificaciones: filasBonif(o.bonificaciones),
    tomado_at: String(o.tomado_at || ""),
  }
}

/**
 * Ficha comercial vigente de un cliente para tomar un pedido. Si hay una captura
 * activa (pedido de la app), la ficha es la vigente a la captura.
 */
export async function leerFichaComercial(supabase: any, clienteId: string): Promise<{
  snapshot: CondicionesCliente
  condicionesProveedor: CondicionProveedor[]
  condicionesMarca: CondicionMarca[]
}> {
  const captura = capturaActual(clienteId)
  if (captura) {
    return {
      snapshot: {
        cliente: soloListas(captura.insumos.cliente as any),
        bonificaciones: filasBonif(captura.insumos.bonificaciones as any[]),
        tomado_at: captura.vigenciaAt,
      },
      condicionesProveedor: captura.insumos.condicionesProveedor || [],
      condicionesMarca: captura.insumos.condicionesMarca || [],
    }
  }
  const [cli, bonif, prov, marca] = await Promise.all([
    supabase.from("clientes").select(COLS_LISTAS.join(",")).eq("id", clienteId).single(),
    supabase.from("bonificaciones").select("tipo, segmento, porcentaje, activo, proveedor_id")
      .eq("cliente_id", clienteId).eq("activo", true).in("tipo", [...TIPOS_BONIF_FICHA]),
    supabase.from("cliente_proveedor_condicion").select(`${CONDICION_PROVEEDOR_COLS}, contado`).eq("cliente_id", clienteId),
    supabase.from("cliente_marca_condicion").select(`${CONDICION_MARCA_COLS}, contado`).eq("cliente_id", clienteId),
  ])
  if (cli.error || !cli.data) throw new Error(`Cliente no encontrado: ${cli.error?.message || clienteId}`)
  for (const r of [bonif, prov, marca]) if (r.error) throw new Error(r.error.message)
  return {
    snapshot: { cliente: soloListas(cli.data), bonificaciones: filasBonif(bonif.data), tomado_at: new Date().toISOString() },
    condicionesProveedor: (prov.data || []) as CondicionProveedor[],
    condicionesMarca: (marca.data || []) as CondicionMarca[],
  }
}

export interface PedidoCongelable {
  id: string
  cliente_id: string
  condiciones_cliente?: unknown
  precios_al?: string | null
}

/**
 * Captura de precios de un pedido con condiciones congeladas, o null (pedido
 * viejo: lee la ficha actual). `vigencia`:
 *   - "pedido": precios a pedidos.precios_al (cambios de condiciones, ítems nuevos)
 *   - "ahora":  precios de hoy (botón Repreciar, confirmación del carrito en vivo)
 * Si ya hay una captura activa (pedido de la app), se respetan SUS precios —los
 * que vio el vendedor— y solo se reemplaza la ficha por la congelada.
 */
export async function capturaDelPedido(
  pedido: PedidoCongelable,
  opts: { vigencia: "pedido" | "ahora"; articuloIds: string[] },
): Promise<CapturaPedido | null> {
  const cond = leerCondicionesCliente(pedido.condiciones_cliente)
  if (!cond) return null
  const fichaCongelada = {
    cliente: cond.cliente,
    condicionesProveedor: [] as CondicionProveedor[],   // rigen las del pedido (pedido_*_condicion)
    condicionesMarca: [] as CondicionMarca[],
    bonificaciones: cond.bonificaciones,
  }
  const base = capturaActual(pedido.cliente_id)
  if (base) {
    return { ...base, insumos: { ...base.insumos, ...fichaCongelada } }
  }
  const vigenciaAt = opts.vigencia === "pedido" && pedido.precios_al ? new Date(pedido.precios_al).toISOString() : new Date().toISOString()
  // `.in("id", [])` no es un filtro válido para PostgREST: un pedido sin renglones
  // igual necesita listas/reglas a la fecha.
  const ids = [...new Set(opts.articuloIds.filter(Boolean))]
  if (!ids.length) ids.push("00000000-0000-0000-0000-000000000000")
  const reconstruido = await insumosAFecha(createAdminClient(), pedido.cliente_id, ids, vigenciaAt)
  return {
    clienteId: pedido.cliente_id,
    vigenciaAt,
    insumos: { ...reconstruido.insumos, ...fichaCongelada },
    articulos: new Map(reconstruido.articulos.map((a: any) => [a.id, a])),
  }
}

/** Ejecuta `fn` con los precios/condiciones del pedido (sin captura si es un pedido viejo). */
export async function conPreciosDelPedido<T>(
  pedido: PedidoCongelable,
  opts: { vigencia: "pedido" | "ahora"; articuloIds: string[] },
  fn: () => Promise<T>,
): Promise<T> {
  const captura = await capturaDelPedido(pedido, opts)
  return captura ? conCaptura(captura, fn) : fn()
}
