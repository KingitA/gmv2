import type { SupabaseClient } from "@supabase/supabase-js"
import { valorDevolucionConOrigen, type OrigenDevolucion, type ValorDevolucionResult } from "@/lib/cobranzas/valor-devolucion"
import { alicuotaIIBBVigente, origenesDeRenglones } from "@/lib/cobranzas/origen-devolucion"
import type { ClientePercepcion } from "@/lib/comprobantes/calcular-percepciones"

/**
 * Valúa devoluciones de un cliente con la regla única de
 * lib/cobranzas/valor-devolucion.ts (regla del dueño 21/10/2026: tal cual fue
 * facturado). Cada renglón contra SU comprobante de origen
 * (lib/cobranzas/origen-devolucion.ts): neto e IVA del renglón facturado,
 * percepción IVA si ese comprobante la llevó, IIBB vigente, 10% si fue contado.
 *
 * La usan la ficha del vendedor, la vista del chofer, las APIs de cobro y la
 * emisión de la NC: todos ven EL MISMO número, al centavo.
 */

export interface DevolucionValorada {
  devolucion_id: string
  /** Algún renglón sale con el 10% contado */
  aplica_10: boolean
  /** Algún renglón va en NC fiscal (A/B) */
  con_iva: boolean
  neto: number
  iva: number
  percepciones: number
  /** Lo que vale la devolución completa en un cobro (= NC + REV) */
  total: number
  /** Desglose completo (parte fiscal / parte REV, por renglón) */
  valor: ValorDevolucionResult
  /** Renglones valuados (aceptados o en proceso; los rechazados no cuentan) con su origen */
  renglones: Array<{ id: string; articulo_id: string; cantidad: number; precio_venta_original: number; comprobante_venta_id: string | null; origen: OrigenDevolucion }>
  alicuota_iibb: number
}

export async function valorarDevoluciones(
  supabase: SupabaseClient,
  {
    clienteId,
    devolucionIds,
    cliente,
  }: {
    clienteId: string
    devolucionIds: string[]
    /** Ficha del cliente si el caller ya la tiene (evita re-consultarla) */
    cliente?: (ClientePercepcion & { id?: string; cuit?: string | null }) | null
  },
): Promise<Map<string, DevolucionValorada>> {
  const out = new Map<string, DevolucionValorada>()
  if (!devolucionIds.length) return out

  const [{ data: detalle }, clienteRow] = await Promise.all([
    supabase
      .from("devoluciones_detalle")
      .select("id, devolucion_id, articulo_id, cantidad, precio_venta_original, estado_renglon, comprobante_venta_id")
      .in("devolucion_id", devolucionIds),
    cliente && "cuit" in cliente
      ? Promise.resolve(cliente)
      : supabase
          .from("clientes")
          .select("id, cuit, condicion_iva, exento_iva, exento_iibb, provincia, percepcion_iibb")
          .eq("id", clienteId)
          .single()
          .then((r) => r.data as any),
  ])

  // Rechazados (o en 0) no valen nada
  const vivos = (detalle || []).filter((d: any) => d.estado_renglon !== "rechazado" && Number(d.cantidad) > 0)
  const [origenes, alicuota] = await Promise.all([
    origenesDeRenglones(
      supabase,
      clienteId,
      vivos.map((d: any) => ({ articulo_id: d.articulo_id, comprobante_venta_id: d.comprobante_venta_id, precio_venta_original: Number(d.precio_venta_original) || 0 })),
      clienteRow,
    ),
    alicuotaIIBBVigente(supabase, (clienteRow || {}) as any),
  ])

  const porDev = new Map<string, DevolucionValorada["renglones"]>()
  vivos.forEach((d: any, i: number) => {
    if (!porDev.has(d.devolucion_id)) porDev.set(d.devolucion_id, [])
    porDev.get(d.devolucion_id)!.push({
      id: d.id,
      articulo_id: d.articulo_id,
      cantidad: Number(d.cantidad) || 0,
      precio_venta_original: Number(d.precio_venta_original) || 0,
      comprobante_venta_id: d.comprobante_venta_id ?? null,
      origen: origenes[i],
    })
  })

  for (const devId of devolucionIds) {
    const renglones = porDev.get(devId) || []
    const v = valorDevolucionConOrigen(renglones, alicuota)
    out.set(devId, {
      devolucion_id: devId,
      aplica_10: renglones.some((r) => r.origen.bonificado_contado),
      con_iva: renglones.some((r) => r.origen.fiscal),
      neto: v.neto,
      iva: v.iva,
      percepciones: v.percepciones,
      total: v.total,
      valor: v,
      renglones,
      alicuota_iibb: alicuota,
    })
  }
  return out
}
