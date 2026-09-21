// Drill-down de comisiones de un pedido (artículos / comprobantes). Parte PURA de
// GET /api/vendedor/comisiones/detalle, compartida con la réplica de la app
// Vendedor (que arma el detalle de todos los pedidos recientes de una sola lectura).

import { getPrecioNeto } from "@/lib/comisiones/calcular"

export const KARDEX_COMISION_COLS =
  "id, pedido_id, articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, cantidad, subtotal_neto, metodo_facturacion, articulo_iva_ventas, comision_viajante_pct, comision_viajante_monto, descuento_financiero_pct, comprobante_venta_id, fecha_comprobante_cobrado, comprobante_cobrado"

// REGLA DE ORO: el número que ve el vendedor es el NETO que va a cobrar.
// Si el comprobante se cobró con bonificación contado, la línea trae
// descuento_financiero_pct y la comisión neta = pactada × (1 − pct/100).
// La pactada y el débito viajan aparte para explicar el porqué.
// PRECIOS SIN IVA: la comisión se calcula sobre el neto, así que precio
// unitario y subtotal se muestran netos para que % × precio = comisión
// cierre a ojo. Con IVA incluido, un 5% sobre $1.000 mostraría $41,32 y
// parecería mal calculado. Se usa la MISMA base que el motor de comisiones
// (getPrecioNeto): subtotal_neto, y en presupuesto de artículo blanco
// además se le quita el IVA implícito (÷1,21).
export const mapArticuloComision = (r: any) => {
  const pactada = Number(r.comision_viajante_monto ?? 0)
  const descPct = Number(r.descuento_financiero_pct ?? 0)
  const neta = descPct > 0 ? Math.round(pactada * (1 - descPct / 100) * 100) / 100 : pactada
  const cantidad = Number(r.cantidad ?? 0)
  const subtotalNeto = Math.round(getPrecioNeto(Number(r.subtotal_neto ?? 0), r.metodo_facturacion, r.articulo_iva_ventas) * 100) / 100
  return {
    kardex_id: r.id,
    articulo_id: r.articulo_id,
    sku: r.articulo_sku ?? "—",
    descripcion: r.articulo_descripcion ?? r.articulo_id ?? "—",
    categoria: r.articulo_categoria ?? "—",
    cantidad,
    precio_unitario: cantidad > 0 ? Math.round((subtotalNeto / cantidad) * 100) / 100 : 0,
    subtotal: subtotalNeto,
    comision_pct: Number(r.comision_viajante_pct ?? 0),
    comision_monto: neta, // neto: lo que efectivamente cobra
    comision_pactada: pactada,
    descuento_financiero_pct: descPct,
  }
}


/** Filas de kardex de UN pedido ya cobradas → agrupadas por comprobante. */
export function agruparPorComprobante(rows: any[], compMap: Map<string, any>) {
  const grupos = new Map<string, any>()
  for (const r of rows || []) {
    const cid = r.comprobante_venta_id ?? "sin_comprobante"
    if (!grupos.has(cid)) {
      const comp = compMap.get(cid)
      grupos.set(cid, {
        comprobante_id: cid,
        numero: comp ? `${comp.tipo_comprobante} ${comp.numero_comprobante}` : "—",
        fecha_cobro: r.fecha_comprobante_cobrado?.slice(0, 10) ?? "",
        total_neto: Number(comp?.total_neto ?? 0),
        total_iva: Number(comp?.total_iva ?? 0),
        total: Number(comp?.total_factura ?? 0),
        total_comision: 0,
        debito_contado: 0,
        articulos: [],
      })
    }
    const g = grupos.get(cid)!
    const art = mapArticuloComision(r)
    g.total_comision += art.comision_monto
    g.debito_contado += art.comision_pactada - art.comision_monto
    g.articulos.push(art)
  }

  for (const g of grupos.values()) {
    g.total_comision = Math.round(g.total_comision * 100) / 100
    g.debito_contado = Math.round(g.debito_contado * 100) / 100
  }

  return [...grupos.values()]
}
