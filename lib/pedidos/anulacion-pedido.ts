// Anular los comprobantes de un pedido para refacturarlo (#19/#20) — REGLAS.
//
// Reglas del dueño (26/10 y 27/10/2026):
//  - Se puede anular en CUALQUIER estado (facturado, listo, en viaje,
//    entregado) mientras el pedido NO esté cobrado al 100 %: cobrado en parte se
//    puede refacturar (ej.: el cliente pagó una parte al chofer y hay que
//    rehacerlo; el chofer vuelve después a cobrar lo que resta).
//  - Se anula TODO: los comprobantes del pedido y las NC/REV del 10 % contado
//    que les quedaron imputadas. Las NC/REV de DEVOLUCIONES no se tocan (son
//    mercadería que volvió físicamente, con su propio stock).
//  - El pedido QUEDA EN SU ESTADO (entregado sigue entregado, en viaje sigue en
//    viaje): refacturar solo cambia los comprobantes. Sin débitos vivos las
//    condiciones son editables (#16, puedeEditarCondiciones con tieneFacturaViva)
//    y Generar vuelve a emitir con las cantidades preparadas sin tocar el estado
//    (estadoAlFacturar).
//  - Lo ya pagado respeta lo que eligió quien cobró: lo imputado a este pedido
//    pasa al comprobante nuevo de este pedido (refacturar.ts, al volver a
//    generar); lo que quedó a cuenta sigue a cuenta.
//  - R3 (Juan 27/10): la NC/REV del 10 % contado es UNA por cobro y puede cubrir
//    otros pedidos y deuda vieja. Si cubre solo comprobantes de este pedido se
//    anula entera; si cubre otros también, se anula SOLO la parte de este pedido
//    (REV → PRES por esa parte, anular-parte-contado.ts; NC con CAE → ND con
//    CAE por esa parte, anularComprobante con `parcial` — Juan 27/10, opción B).
//
// La anulación en sí (cuenta corriente, comisión, stock, remito) es de cuentas
// corrientes: usa `evaluarAnulacionPedido` para saber si se puede y qué anular.

import { comprobantesDePedidos, type ComprobanteDePedido } from "../comprobantes/comprobantes-de-pedido"

const VENTA = new Set(["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])
const CREDITO = new Set(["NCA", "NCB", "NCC", "REV"])

/** NC/REV del 10 % por pago contado (generar-bonificacion / generar: "Bonificación contado 10% — …"). */
export function esBonificacionContado(observaciones: string | null | undefined): boolean {
  return String(observaciones || "").includes("Bonificación contado")
}

export interface ComprobanteAnulable {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  total_factura: number
  saldo_pendiente: number | null
  anulado_en: string | null
  observaciones?: string | null
  /** true = emitido al facturar el pedido (pedido_id); false = NC/REV imputada */
  propio: boolean
  /** NC/REV del 10 % contado: cuánto de ella está imputado a comprobantes de ESTE pedido */
  parte_pedido?: number
  /** NC/REV del 10 % contado: cuánto está imputado a comprobantes de OTROS pedidos o deuda vieja */
  parte_otros?: number
  /** Si se anula solo una parte (R3): el monto de esa parte */
  parcial?: number
}

export interface ReglaAnulacion {
  puede: boolean
  motivo: string | null
  /** Lo que se anula, en orden: primero el 10 % contado, después los del pedido (fiscales antes que PRES) */
  aAnular: ComprobanteAnulable[]
}

const ESTADOS_SIN_ANULAR = new Set(["eliminado", "sistema_viejo"])

/** Parte pura: con el estado del pedido y sus comprobantes, ¿se puede anular y qué? */
export function reglaAnulacionPedido(estado: string | null | undefined, comprobantes: ComprobanteAnulable[]): ReglaAnulacion {
  const vivos = comprobantes.filter((c) => !c.anulado_en)
  const propios = vivos.filter((c) => c.propio && VENTA.has(c.tipo_comprobante))
  const contado = vivos.filter((c) => !c.propio && CREDITO.has(c.tipo_comprobante) && esBonificacionContado(c.observaciones))
  const no = (motivo: string): ReglaAnulacion => ({ puede: false, motivo, aAnular: [] })

  if (ESTADOS_SIN_ANULAR.has(String(estado || ""))) return no("Este pedido no se puede refacturar.")
  if (!propios.length) return no("El pedido no tiene comprobantes para anular.")
  // Cobrado al 100 %: todos sus comprobantes saldados (pagos, 10 % contado, devoluciones)
  const saldado = propios.every((c) => Math.abs(Number(c.saldo_pendiente) || 0) < 0.005)
  if (saldado) return no("El pedido ya está cobrado al 100 %: no se puede refacturar.")

  // R3: la nota del 10 % compartida con otros comprobantes se anula solo en la parte de este pedido
  const contadoAAnular: ComprobanteAnulable[] = []
  for (const n of contado) {
    const otros = Number(n.parte_otros) || 0
    if (otros <= 0.005) { contadoAAnular.push(n); continue }
    // REV → PRES por la parte; NC con CAE → ND con CAE por la parte (Juan 27/10, opción B)
    const parte = Math.round((Number(n.parte_pedido) || 0) * 100) / 100
    if (parte > 0.005) contadoAAnular.push({ ...n, parcial: parte })
  }

  const fiscalPrimero = (a: ComprobanteAnulable, b: ComprobanteAnulable) =>
    Number(a.tipo_comprobante === "PRES") - Number(b.tipo_comprobante === "PRES") || a.numero_comprobante.localeCompare(b.numero_comprobante)
  return { puede: true, motivo: null, aAnular: [...contadoAAnular.sort(fiscalPrimero), ...propios.sort(fiscalPrimero)] }
}

/** Servidor: carga el pedido y sus comprobantes y aplica la regla. */
export async function evaluarAnulacionPedido(supabase: any, pedidoId: string): Promise<ReglaAnulacion & { estado: string | null }> {
  const { data: pedido, error } = await supabase.from("pedidos").select("id, estado").eq("id", pedidoId).single()
  if (error || !pedido) throw new Error("Pedido no encontrado")
  const todos: ComprobanteDePedido[] = await comprobantesDePedidos(supabase, [pedidoId])
  const ids = todos.map((c) => c.id)
  const { data: extra } = ids.length
    ? await supabase.from("comprobantes_venta").select("id, saldo_pendiente, observaciones").in("id", ids)
    : { data: [] as any[] }
  const extraDe = new Map((extra || []).map((x: any) => [x.id, x]))
  // R3: de cada NC/REV imputada, cuánto va a comprobantes de este pedido y cuánto a otros
  const propiosIds = new Set(todos.filter((c) => c.pedido_id === pedidoId).map((c) => c.id))
  const creditoIds = todos.filter((c) => c.pedido_id !== pedidoId).map((c) => c.id)
  const partes = new Map<string, { pedido: number; otros: number }>()
  if (creditoIds.length) {
    const { data: imps } = await supabase
      .from("imputaciones")
      .select("credito_comprobante_id, comprobante_id, monto_imputado")
      .in("credito_comprobante_id", creditoIds)
      .neq("estado", "anulado")
    for (const i of imps || []) {
      const p = partes.get(i.credito_comprobante_id) || { pedido: 0, otros: 0 }
      if (propiosIds.has(i.comprobante_id)) p.pedido += Number(i.monto_imputado) || 0
      else p.otros += Number(i.monto_imputado) || 0
      partes.set(i.credito_comprobante_id, p)
    }
  }
  const comprobantes: ComprobanteAnulable[] = todos.map((c) => ({
    id: c.id,
    tipo_comprobante: c.tipo_comprobante,
    numero_comprobante: c.numero_comprobante,
    total_factura: Number(c.total_factura) || 0,
    saldo_pendiente: (extraDe.get(c.id) as any)?.saldo_pendiente ?? null,
    anulado_en: c.anulado_en,
    observaciones: (extraDe.get(c.id) as any)?.observaciones ?? null,
    propio: c.pedido_id === pedidoId,
    parte_pedido: partes.get(c.id)?.pedido,
    parte_otros: partes.get(c.id)?.otros,
  }))
  return { ...reglaAnulacionPedido(pedido.estado, comprobantes), estado: pedido.estado }
}
