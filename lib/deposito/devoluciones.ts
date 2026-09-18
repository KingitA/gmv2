/**
 * Recepción física de devoluciones — compartida por /api/deposito/devoluciones
 * (web) y el handler `devolucion.recibir` del outbox de la app Depósito.
 *
 * Idempotente: si la devolución ya está confirmada no se repite nada, y cada
 * reingreso de stock se guarda contra su movimiento (`Devolución #<id>`), así
 * una confirmación interrumpida se puede reintentar sin duplicar stock.
 */

import { nowArgentina } from "@/lib/utils"
import { ErrorDeposito } from "./picking"

export interface ItemDevolucionConfirmado {
  detalle_id: string
  articulo_id: string
  cantidad_recibida: number
  es_vendible: boolean
}

export async function confirmarDevolucion(
  supabase: any,
  devolucion_id: string,
  items_confirmados: ItemDevolucionConfirmado[],
  userName: string,
  fecha?: string,
) {
  if (!devolucion_id) throw new ErrorDeposito("devolucion_id requerido", 400)
  const { data: dev } = await supabase.from("devoluciones").select("id, estado").eq("id", devolucion_id).maybeSingle()
  if (!dev) throw new ErrorDeposito("Devolución no encontrada", 404)
  if (dev.estado === "confirmado") return { ok: true, ya_confirmada: true }
  if (dev.estado !== "pendiente") {
    throw new ErrorDeposito(`La devolución está ${dev.estado}: no se puede confirmar.`, 409, { codigo: "devolucion_no_pendiente" })
  }

  const marca = `Devolución #${devolucion_id} — mercadería vendible`
  const { data: previos } = await supabase.from("movimientos_stock").select("articulo_id").eq("observaciones", marca)
  const hechos = new Set((previos || []).map((m: any) => m.articulo_id))

  for (const item of items_confirmados || []) {
    await supabase.from("devoluciones_detalle").update({ es_vendible: item.es_vendible }).eq("id", item.detalle_id)

    // Si es vendible, vuelve al stock. `hechos` = reingresos de un intento anterior
    // interrumpido (no se repiten).
    if (item.es_vendible && item.cantidad_recibida > 0 && !hechos.has(item.articulo_id)) {
      const { data: art } = await supabase.from("articulos").select("stock_actual").eq("id", item.articulo_id).single()
      await supabase
        .from("articulos")
        .update({ stock_actual: (art?.stock_actual || 0) + item.cantidad_recibida })
        .eq("id", item.articulo_id)
      await supabase.from("movimientos_stock").insert({
        articulo_id: item.articulo_id,
        tipo_movimiento: "entrada",
        cantidad: item.cantidad_recibida,
        observaciones: marca,
      })
    }
  }

  // Confirmada (el ERP genera la nota de crédito)
  await supabase
    .from("devoluciones")
    .update({ estado: "confirmado", confirmado_por: userName, fecha_confirmacion: fecha || nowArgentina() })
    .eq("id", devolucion_id)

  return { ok: true }
}
