import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import type { MovimientoCC } from "./extracto"

/**
 * Movimientos del libro mayor de un cliente, enriquecidos con el tipo real del
 * comprobante referenciado (el libro postea NCA y REV igual como "nota_credito"; la UI
 * necesita distinguir Reversa de NC fiscal). Misma carga para el ERP y la app.
 */
export async function cargarMovimientosCliente(supabase: any, clienteId: string): Promise<MovimientoCC[]> {
  const raw = await fetchAllRows<any>(() => supabase
    .from("cuenta_corriente_clientes")
    .select("id, fecha, tipo_movimiento, debe, haber, numero_comprobante, observaciones, referencia_tipo, referencia_id")
    .eq("cliente_id", clienteId)
    .order("fecha", { ascending: false }))
  const ids = [...new Set(raw.filter((m) => m.referencia_tipo === "comprobante_venta" && m.referencia_id).map((m) => m.referencia_id as string))]
  const comps = ids.length
    ? await fetchByIds<any>((ch) => supabase.from("comprobantes_venta").select("id, tipo_comprobante").in("id", ch), ids)
    : []
  const tipo = new Map(comps.map((c: any) => [c.id, c.tipo_comprobante]))
  return raw.map((m) => ({
    ...m,
    debe: Number(m.debe || 0),
    haber: Number(m.haber || 0),
    comprobante_tipo: m.referencia_tipo === "comprobante_venta" && m.referencia_id ? tipo.get(m.referencia_id) ?? null : null,
  }))
}

/**
 * Lo mismo para MUCHOS clientes en pocas consultas (réplica de la app: la cuenta de toda
 * la cartera). Por cliente serían 2 consultas × cliente: medido 4,5 s extra para 91.
 */
export async function cargarMovimientosClientes(supabase: any, clienteIds: string[]): Promise<Map<string, MovimientoCC[]>> {
  const out = new Map<string, MovimientoCC[]>(clienteIds.map((id) => [id, []]))
  const raw: any[] = []
  for (let i = 0; i < clienteIds.length; i += 100) {
    const chunk = clienteIds.slice(i, i + 100)
    raw.push(...await fetchAllRows<any>(() => supabase
      .from("cuenta_corriente_clientes")
      .select("id, cliente_id, fecha, tipo_movimiento, debe, haber, numero_comprobante, observaciones, referencia_tipo, referencia_id")
      .in("cliente_id", chunk)
      .order("id")))
  }
  const ids = [...new Set(raw.filter((m) => m.referencia_tipo === "comprobante_venta" && m.referencia_id).map((m) => m.referencia_id as string))]
  const comps = ids.length
    ? await fetchByIds<any>((ch) => supabase.from("comprobantes_venta").select("id, tipo_comprobante").in("id", ch), ids)
    : []
  const tipo = new Map(comps.map((c: any) => [c.id, c.tipo_comprobante]))
  for (const { cliente_id, ...m } of raw) {
    out.get(cliente_id)?.push({
      ...m,
      debe: Number(m.debe || 0),
      haber: Number(m.haber || 0),
      comprobante_tipo: m.referencia_tipo === "comprobante_venta" && m.referencia_id ? tipo.get(m.referencia_id) ?? null : null,
    })
  }
  return out
}
