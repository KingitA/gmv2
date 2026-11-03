import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resumen de cuenta de cada comprobante que el chofer cobra (pedido de Juan, 03/11/2026: "si miro
 * las cuentas no me va a dar nunca"). Por comprobante, lo que ya le restó al total: pagos,
 * devoluciones, 10 % contado y otros créditos (imputaciones confirmadas). Así la app muestra
 *   Presupuesto 0035 339.161,76 · Devolución −8.105,08 · Pago 28/10 −100.000 · Debe 231.056,68
 * en vez de un saldo suelto.
 *
 * Un comprobante REFACTURADO recibe el crédito de la anulación del anterior (REV "Anulación",
 * comprobantes_relacionados_ids[0] = el anulado). Ese crédito se abre en lo que tenía el anterior
 * (sus pagos y devoluciones), que es lo que el chofer entiende; si no cierra, queda en un renglón.
 */

export interface MovimientoComprobante {
  tipo: "pago" | "devolucion" | "contado" | "credito"
  concepto: string
  /** ISO; null si no se sabe */
  fecha: string | null
  /** Lo que restó (positivo) */
  monto: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const MAX_PROFUNDIDAD = 3

interface Credito { id: string; tipo_comprobante: string; numero_comprobante: string; fecha: string | null; observaciones: string | null; motivo_ajuste: string | null; comprobantes_relacionados_ids: string[] | null }
interface Imp { comprobante_id: string; pago_id: string | null; credito_comprobante_id: string | null; monto_imputado: number | string; created_at: string; credito: Credito | Credito[] | null }

export async function movimientosDeComprobantes(supabase: SupabaseClient, comprobanteIds: string[], profundidad = 0): Promise<Record<string, MovimientoComprobante[]>> {
  const ids = [...new Set(comprobanteIds)].filter(Boolean)
  const out: Record<string, MovimientoComprobante[]> = {}
  if (!ids.length || profundidad > MAX_PROFUNDIDAD) return out

  const { data, error } = await supabase
    .from("imputaciones")
    .select("comprobante_id, pago_id, credito_comprobante_id, monto_imputado, created_at, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(id, tipo_comprobante, numero_comprobante, fecha, observaciones, motivo_ajuste, comprobantes_relacionados_ids)")
    .in("comprobante_id", ids)
    .eq("estado", "confirmado")
    .order("created_at", { ascending: true })
  if (error) throw new Error(`movimientosDeComprobantes: ${error.message}`)
  const imps = (data || []) as unknown as Imp[]

  const pagoIds = [...new Set(imps.map((i) => i.pago_id).filter((x): x is string => !!x))]
  const anulaciones = new Map<string, string>() // crédito de anulación → comprobante anulado
  for (const i of imps) {
    const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
    const orig = cr?.motivo_ajuste === "Anulación" ? cr.comprobantes_relacionados_ids?.[0] : null
    // La anulación imputada al MISMO comprobante que anuló cancela su resto: no se abre
    if (cr && orig && orig !== i.comprobante_id) anulaciones.set(cr.id, orig)
  }
  const originales = [...new Set(anulaciones.values())]
  const [pagos, anteriores, origs] = await Promise.all([
    pagoIds.length ? supabase.from("pagos_clientes").select("id, fecha_pago, created_at").in("id", pagoIds) : Promise.resolve({ data: [] as any[] }),
    originales.length ? movimientosDeComprobantes(supabase, originales, profundidad + 1) : Promise.resolve({} as Record<string, MovimientoComprobante[]>),
    originales.length ? supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante").in("id", originales) : Promise.resolve({ data: [] as any[] }),
  ])
  const fechaPago = new Map(((pagos.data || []) as any[]).map((p) => [p.id as string, (p.fecha_pago || p.created_at) as string]))
  const nombreOrig = new Map(((origs.data || []) as any[]).map((o) => [o.id as string, `${o.tipo_comprobante} ${o.numero_comprobante}`]))

  for (const i of imps) {
    const monto = r2(Number(i.monto_imputado) || 0)
    if (!(monto > 0.005)) continue
    const lista = (out[i.comprobante_id] ??= [])
    if (i.pago_id) { lista.push({ tipo: "pago", concepto: "Pago", fecha: fechaPago.get(i.pago_id) ?? i.created_at, monto }); continue }
    const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
    if (!cr) { lista.push({ tipo: "credito", concepto: "Ajuste", fecha: i.created_at, monto }); continue }
    const orig = anulaciones.get(cr.id)
    if (cr.motivo_ajuste === "Anulación" && (!orig || orig === i.comprobante_id)) { lista.push({ tipo: "credito", concepto: "Anulación", fecha: cr.fecha, monto }); continue }
    if (orig) {
      // Refacturado: lo que traía el anulado (sin la propia anulación, que cancela su resto)
      const previos = (anteriores[orig] ?? []).filter((m) => !(m.tipo === "credito" && m.concepto === "Anulación"))
      const suma = r2(previos.reduce((s, m) => s + m.monto, 0))
      const de = nombreOrig.get(orig) ?? "el comprobante anterior"
      if (previos.length && Math.abs(suma - monto) < 0.02) lista.push(...previos.map((m) => ({ ...m, concepto: `${m.concepto} (en ${de})` })))
      else lista.push({ tipo: "credito", concepto: `Anulación: pasado de ${de}`, fecha: cr.fecha, monto })
      continue
    }
    const texto = `${cr.motivo_ajuste || ""} ${cr.observaciones || ""}`
    const dev = texto.match(/Devoluci[oó]n\s+(DEV-\d+)/i)
    if (dev) lista.push({ tipo: "devolucion", concepto: `Devolución ${dev[1]}`, fecha: cr.fecha, monto })
    else if (/Bonificaci[oó]n contado/i.test(texto)) lista.push({ tipo: "contado", concepto: "10 % contado", fecha: cr.fecha, monto })
    else lista.push({ tipo: "credito", concepto: `${cr.tipo_comprobante} ${cr.numero_comprobante}`, fecha: cr.fecha, monto })
  }
  return out
}
