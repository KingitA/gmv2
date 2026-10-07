"use server"

// Mercadería bonificada de un pedido, por CUPO (todo el pedido / segmento /
// proveedor / marca). Ver lib/pedidos/mercaderia-bonificada.ts.

import { createClient } from "@/lib/supabase/server"
import { agregarItemBonificado, eliminarItemPedido } from "@/lib/actions/pedidos"
import { calcularBonificadosPorCupo } from "@/lib/deposito/bonificados"
import { etiquetasCupos } from "@/lib/pedidos/mercaderia-bonificada"

export interface CupoMercaderiaVista {
  origen: string
  nombre: string
  pct: number
  /** neto que va del cupo (base) */
  base: number
  /** monto a bonificar */
  monto: number
  articulos: Array<{ detalle_id: string; articulo_id: string; descripcion: string; sku: string; cantidad: number; precio_neto: number }>
}

/** Cupos del pedido con lo elegido y la estimación actual. */
export async function getCuposMercaderiaPedido(pedidoId: string): Promise<{
  usaCupos: boolean
  cupos: CupoMercaderiaVista[]
  pendientes: string[]
}> {
  const supabase = await createClient()
  const { data: lineas, error } = await supabase
    .from("pedidos_detalle")
    .select("id, articulo_id, cantidad, cantidad_preparada, estado_item, precio_base, es_bonificado, bonif_merc_origen, bonif_merc_pct, articulos:articulo_id(descripcion, sku)")
    .eq("pedido_id", pedidoId)
  if (error) throw new Error(error.message)
  const rows = (lineas || []) as any[]
  const usaCupos = rows.some((l) => !!l.bonif_merc_origen)
  if (!usaCupos) return { usaCupos: false, cupos: [], pendientes: [] }

  const { cupos, pendientes } = calcularBonificadosPorCupo(rows)
  const etiquetas = await etiquetasCupos(supabase, cupos.map((c) => c.origen))
  return {
    usaCupos: true,
    pendientes,
    cupos: cupos.map((c) => ({
      origen: c.origen,
      nombre: etiquetas[c.origen] || c.origen,
      pct: c.pct,
      base: c.base,
      monto: c.monto,
      articulos: rows
        .filter((l) => l.es_bonificado && l.bonif_merc_origen === c.origen)
        .map((l) => ({
          detalle_id: l.id,
          articulo_id: l.articulo_id,
          descripcion: l.articulos?.descripcion || "",
          sku: l.articulos?.sku || "",
          cantidad: Number(l.cantidad) || 0,
          precio_neto: Number(l.precio_base) || 0,
        })),
    })),
  }
}

/** Elige un artículo a regalar para un cupo (las unidades las calcula el sistema). */
export async function agregarArticuloACupo(pedidoId: string, origen: string, articuloId: string) {
  if (!origen) throw new Error("Falta el cupo")
  return agregarItemBonificado(pedidoId, articuloId, 0, origen)
}

/** Saca un artículo regalado (el resto del cupo se recalcula). */
export async function quitarArticuloBonificado(pedidoId: string, detalleId: string) {
  return eliminarItemPedido(detalleId, pedidoId)
}
