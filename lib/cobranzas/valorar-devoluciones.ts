import type { SupabaseClient } from "@supabase/supabase-js"
import { valorDevolucion } from "@/lib/cobranzas/valor-devolucion"
import { calcularPercepciones, type ClientePercepcion } from "@/lib/comprobantes/calcular-percepciones"
import { resolverAlicuotaIIBB } from "@/lib/comprobantes/percepcion-iibb"

/**
 * Valúa devoluciones EN PROCESO de un cliente con la regla única de
 * lib/cobranzas/valor-devolucion.ts, resolviendo desde la base lo que el
 * motor puro no conoce:
 *  - aplica_10: la factura original tiene bonificación contado viva (misma
 *    detección que las pantallas de cobro: NC/REV viva cuyo texto
 *    "Bonificación contado…" menciona el número del comprobante original).
 *  - con_iva: el documento futuro será fiscal (original FA/FB/FC/ND*) → NCA/…
 *    con IVA y percepciones; original PRES (o sin original) → REV sin IVA.
 *  - percepciones: mismas funciones que la emisión de la NC.
 *
 * La usan la ficha del vendedor, la vista del chofer, las APIs de cobro y la
 * emisión de la NC: todos ven EL MISMO número, al centavo.
 */

export interface DevolucionValorada {
  devolucion_id: string
  aplica_10: boolean
  con_iva: boolean
  neto: number
  iva: number
  percepciones: number
  /** Lo que vale la devolución completa en un cobro (y su NC futura) */
  total: number
}

const FISCALES = new Set(["FA", "FB", "FC", "ND", "NDA", "NDB", "NDC"])

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
    cliente?: (ClientePercepcion & { id?: string }) | null
  },
): Promise<Map<string, DevolucionValorada>> {
  const out = new Map<string, DevolucionValorada>()
  if (!devolucionIds.length) return out

  const [{ data: detalle }, { data: bonifs }, clienteRow] = await Promise.all([
    supabase
      .from("devoluciones_detalle")
      .select("devolucion_id, subtotal, comprobante_venta_id")
      .in("devolucion_id", devolucionIds),
    supabase
      .from("comprobantes_venta")
      .select("observaciones")
      .eq("cliente_id", clienteId)
      .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
      .is("anulado_en", null)
      .neq("estado_pago", "anulado")
      .ilike("observaciones", "%Bonificación contado%"),
    cliente
      ? Promise.resolve(cliente)
      : supabase
          .from("clientes")
          .select("id, condicion_iva, exento_iva, exento_iibb, provincia, percepcion_iibb")
          .eq("id", clienteId)
          .single()
          .then((r) => r.data as any),
  ])

  const compIds = [...new Set((detalle || []).map((d: any) => d.comprobante_venta_id).filter(Boolean))]
  const { data: origs } = compIds.length
    ? await supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante").in("id", compIds)
    : { data: [] as any[] }
  const origDe = new Map((origs || []).map((c: any) => [c.id, c]))
  const bonifObs = (bonifs || []).map((b: any) => String(b.observaciones || ""))

  // Alícuota IIBB: una sola vez por cliente, igual que la emisión
  let tasaIIBB = 0
  const cli = (clienteRow || {}) as ClientePercepcion
  try {
    tasaIIBB = await resolverAlicuotaIIBB(supabase, cli as any)
  } catch {
    tasaIIBB = Number(cli.percepcion_iibb) || 0
  }
  const cliConTasa = { ...cli, percepcion_iibb: tasaIIBB }

  const porDev = new Map<string, any[]>()
  for (const d of detalle || []) {
    if (!porDev.has(d.devolucion_id)) porDev.set(d.devolucion_id, [])
    porDev.get(d.devolucion_id)!.push(d)
  }

  for (const devId of devolucionIds) {
    const renglones = porDev.get(devId) || []
    const comps = renglones.map((r: any) => origDe.get(r.comprobante_venta_id)).filter(Boolean)
    const conIva = comps.some((c: any) => FISCALES.has(c.tipo_comprobante))
    const aplica10 = comps.some((c: any) => bonifObs.some((o) => o.includes(c.numero_comprobante)))
    const v = valorDevolucion({
      renglones: renglones.map((r: any) => ({ subtotal: Number(r.subtotal) || 0 })),
      aplica10,
      conIva,
      percepcionesDe: conIva
        ? (neto) => {
            const p = calcularPercepciones(neto, cliConTasa, true)
            return (p.percepcion_iva || 0) + (p.percepcion_iibb || 0)
          }
        : undefined,
    })
    out.set(devId, {
      devolucion_id: devId,
      aplica_10: aplica10,
      con_iva: conIva,
      neto: v.neto,
      iva: v.iva,
      percepciones: v.percepciones,
      total: v.total,
    })
  }
  return out
}
