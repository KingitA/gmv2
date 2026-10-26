import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Tope de devolución en el SERVIDOR (#25, prueba de salida 26/10: entraron
 * DEV-00001 y DEV-00002 por las mismas 6 naftalinas de 6 vendidas).
 *
 * Por renglón, contra su comprobante de origen (el que resolvió
 * prepararRenglonesDevolucion): lo pedido no puede superar lo vendido en ese
 * comprobante menos lo ya devuelto contra él (devoluciones pendientes,
 * aceptadas o con NC; los renglones rechazados no cuentan). Un comprobante sin
 * detalle de artículos (apertura del sistema viejo), o que no tiene ese artículo
 * (origen de respaldo, #28), no se puede controlar: pasa.
 *
 * Devuelve null si está todo bien, o el mensaje para mostrar (la ruta responde
 * 409 con codigo "TOPE_DEVOLUCION"; la app lo muestra tal cual).
 */
export const CODIGO_TOPE_DEVOLUCION = "TOPE_DEVOLUCION"

export async function excedeTopeDevolucion(
  supabase: SupabaseClient,
  items: Array<{ articulo_id: string; cantidad: number | string; comprobante_venta_id?: string | null }>,
  opts: { excluirDevolucionId?: string | null } = {},
): Promise<string | null> {
  // Lo pedido, por (comprobante, artículo)
  const pedido = new Map<string, number>()
  for (const it of items) {
    if (!it.comprobante_venta_id || !it.articulo_id) continue
    const k = `${it.comprobante_venta_id}|${it.articulo_id}`
    pedido.set(k, (pedido.get(k) ?? 0) + (Number(it.cantidad) || 0))
  }
  if (!pedido.size) return null
  const compIds = [...new Set([...pedido.keys()].map((k) => k.split("|")[0]))]
  const artIds = [...new Set([...pedido.keys()].map((k) => k.split("|")[1]))]

  const [{ data: vendidos, error: e1 }, { data: devueltos, error: e2 }, { data: comps }, { data: arts }] = await Promise.all([
    supabase.from("comprobantes_venta_detalle").select("comprobante_id, articulo_id, cantidad").in("comprobante_id", compIds).in("articulo_id", artIds),
    supabase
      .from("devoluciones_detalle")
      .select("devolucion_id, comprobante_venta_id, articulo_id, cantidad, estado_renglon, devolucion:devoluciones!inner(estado)")
      .in("comprobante_venta_id", compIds)
      .in("articulo_id", artIds)
      .in("devolucion.estado", ["pendiente", "confirmado", "facturado"]),
    supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante").in("id", compIds),
    supabase.from("articulos").select("id, descripcion").in("id", artIds),
  ])
  if (e1) throw new Error(`tope devolución (vendido): ${e1.message}`)
  if (e2) throw new Error(`tope devolución (devuelto): ${e2.message}`)

  const vendido = new Map<string, number>()
  for (const v of vendidos || []) {
    const k = `${v.comprobante_id}|${v.articulo_id}`
    vendido.set(k, (vendido.get(k) ?? 0) + (Number(v.cantidad) || 0))
  }
  const yaDevuelto = new Map<string, number>()
  for (const d of devueltos || []) {
    if (opts.excluirDevolucionId && d.devolucion_id === opts.excluirDevolucionId) continue
    if (d.estado_renglon === "rechazado") continue
    const k = `${d.comprobante_venta_id}|${d.articulo_id}`
    yaDevuelto.set(k, (yaDevuelto.get(k) ?? 0) + (Number(d.cantidad) || 0))
  }
  const nombreComp = new Map((comps || []).map((c: any) => [c.id, `${c.tipo_comprobante} ${c.numero_comprobante}`]))
  const nombreArt = new Map((arts || []).map((a: any) => [a.id, a.descripcion]))

  const problemas: string[] = []
  for (const [k, cant] of pedido) {
    const [compId, artId] = k.split("|")
    // Sin ese artículo en el detalle del comprobante (apertura del sistema viejo,
    // o un origen "más reciente" de respaldo que resuelve #28): no hay contra qué topear.
    if (!vendido.has(k)) continue
    const disponible = (vendido.get(k) ?? 0) - (yaDevuelto.get(k) ?? 0)
    if (cant > disponible + 1e-6) {
      const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",")
      problemas.push(
        `${nombreArt.get(artId) || "Artículo"}: en ${nombreComp.get(compId) || "el comprobante"} se vendieron ${fmt(vendido.get(k) ?? 0)}` +
          `${(yaDevuelto.get(k) ?? 0) > 0 ? `, ya se devolvieron ${fmt(yaDevuelto.get(k)!)}` : ""}` +
          ` y querés devolver ${fmt(cant)} (máximo ${fmt(Math.max(0, disponible))})`,
      )
    }
  }
  return problemas.length ? `No se puede devolver más de lo vendido. ${problemas.join(" · ")}` : null
}
