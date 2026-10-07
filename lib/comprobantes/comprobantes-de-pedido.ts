// Comprobantes de un pedido para mostrar e imprimir juntos: los emitidos al
// facturarlo (pedido_id) + las NC/REV que se les imputaron como crédito (la del
// 10% contado al facturar o al cobrar, devoluciones, etc.). Las NC/REV no llevan
// pedido_id: se encuentran por imputaciones.credito_comprobante_id.

export interface ComprobanteDePedido {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  total_factura: number
  pedido_id: string | null
  anulado_en: string | null
  pdf_path?: string | null
  fecha?: string | null
  /** id del pedido al que pertenece (también para las NC/REV sin pedido_id) */
  pedido_ref: string
}

const COLS = "id, tipo_comprobante, numero_comprobante, total_factura, pedido_id, anulado_en, pdf_path, fecha"
const ORDEN_TIPO: Record<string, number> = { FA: 0, FB: 0, FC: 0, PRES: 1, ND: 2, NDA: 2, NDB: 2, NCA: 3, NCB: 3, NCC: 3, REV: 4 }

export async function comprobantesDePedidos(supabase: any, pedidoIds: string[]): Promise<ComprobanteDePedido[]> {
  const out: ComprobanteDePedido[] = []
  const propios: any[] = []
  for (let i = 0; i < pedidoIds.length; i += 100) {
    const { data, error } = await supabase.from("comprobantes_venta").select(COLS).in("pedido_id", pedidoIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
    propios.push(...(data || []))
  }
  for (const c of propios) out.push({ ...c, pedido_ref: c.pedido_id })

  // Créditos imputados a esos comprobantes (NC/REV)
  const pedidoDe = new Map(propios.map((c) => [c.id, c.pedido_id as string]))
  const ids = propios.map((c) => c.id)
  const vistos = new Set(ids)
  for (let i = 0; i < ids.length; i += 100) {
    const { data: imps, error } = await supabase
      .from("imputaciones")
      .select("comprobante_id, credito_comprobante_id")
      .in("comprobante_id", ids.slice(i, i + 100))
      .not("credito_comprobante_id", "is", null)
      .neq("estado", "anulado")
    if (error) throw new Error(error.message)
    const creditoA = new Map<string, string>()
    for (const imp of imps || []) if (!vistos.has(imp.credito_comprobante_id)) creditoA.set(imp.credito_comprobante_id, pedidoDe.get(imp.comprobante_id)!)
    if (!creditoA.size) continue
    const { data: creds, error: cErr } = await supabase.from("comprobantes_venta").select(COLS).in("id", [...creditoA.keys()])
    if (cErr) throw new Error(cErr.message)
    for (const c of creds || []) {
      if (vistos.has(c.id)) continue
      vistos.add(c.id)
      out.push({ ...c, pedido_ref: creditoA.get(c.id)! })
    }
  }
  return out.sort((a, b) =>
    (ORDEN_TIPO[a.tipo_comprobante] ?? 9) - (ORDEN_TIPO[b.tipo_comprobante] ?? 9) ||
    String(a.numero_comprobante).localeCompare(String(b.numero_comprobante)))
}
