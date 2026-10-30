import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { endOfDayArgentina, startOfDayArgentina } from "@/lib/utils"

/**
 * CAJA DE AJUSTES (P2-03, regla de Juan 29-31/10): un solo lugar donde caen todos
 * los ajustes de plata (redondeos de cobros, sobrantes ajustados, "Ajustar saldo",
 * deuda asumida al eliminar un cliente). La llena la base desde el libro
 * (migración 20261031_caja_ajustes.sql); acá solo se lee. No es una caja
 * operativa: no tiene arqueo ni suma al disponible. Solo admin.
 *
 * monto > 0 = a favor de la empresa · monto < 0 = en contra. Saldo = la suma.
 */

export const ORIGENES_AJUSTE = {
  redondeo_cobro: "Redondeo de cobro",
  sobrante: "Sobrante ajustado",
  ajuste_saldo: "Ajustar saldo",
  reversa: "Ajuste eliminado",
  deuda_asumida: "Deuda asumida",
} as const
export type OrigenAjuste = keyof typeof ORIGENES_AJUSTE

export interface RenglonAjuste {
  id: string
  fecha: string
  origen: OrigenAjuste
  origen_label: string
  monto: number
  motivo: string | null
  cliente: { id: string; codigo: string | null; nombre: string } | null
  usuario: string | null
  usuario_id: string | null
  pago_id: string | null
  comprobante: { id: string; tipo: string; numero: string } | null
  /** Deuda asumida: lo que cerró (comprobantes pasados a pagados / entregas a cuenta), con su saldo anterior */
  cancelados: Array<{ comprobante: { id: string; tipo: string; numero: string } | null; pago_id: string | null; saldo_anterior: number }>
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Primer y último día (aaaa-mm-dd) de un mes "aaaa-mm". */
function rangoMes(mes: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` }
}

/** Saldo de la caja (suma de todos los renglones), para la tarjeta de Finanzas. */
export async function saldoCajaAjustes(supabase: SupabaseClient): Promise<number> {
  const todos = await fetchAllRows<{ monto: number }>(() => supabase.from("caja_ajustes").select("id, monto"))
  return r2(todos.reduce((s, r) => s + Number(r.monto || 0), 0))
}

export async function leerCajaAjustes(
  supabase: SupabaseClient,
  filtros: { mes?: string | null; origen?: string | null; usuarioId?: string | null } = {},
) {
  // Saldo total: TODA la caja (sin filtros)
  const saldo = await saldoCajaAjustes(supabase)

  const rango = filtros.mes ? rangoMes(filtros.mes) : null
  const filas = await fetchAllRows<any>(() => {
    let q = supabase
      .from("caja_ajustes")
      .select("id, fecha, origen, cliente_id, monto, motivo, usuario_id, pago_id, comprobante_id")
    if (rango) q = q.gte("fecha", startOfDayArgentina(rango.desde)).lte("fecha", endOfDayArgentina(rango.hasta))
    if (filtros.origen && filtros.origen in ORIGENES_AJUSTE) q = q.eq("origen", filtros.origen)
    if (filtros.usuarioId) q = q.eq("usuario_id", filtros.usuarioId)
    return q
  })

  // Deuda asumida (P2-02): qué cerró cada ajuste
  const asumidas = filas.filter((f) => f.origen === "deuda_asumida").map((f) => f.id)
  const cancelados = await fetchByIds<any>(
    (ch) => supabase.from("caja_ajustes_cancelados").select("ajuste_id, comprobante_id, pago_id, saldo_anterior").in("ajuste_id", ch),
    asumidas,
  )
  const canceladosDe = new Map<string, any[]>()
  for (const c of cancelados) canceladosDe.set(c.ajuste_id, [...(canceladosDe.get(c.ajuste_id) || []), c])

  const ids = (k: string) => [...new Set(filas.map((f) => f[k]).filter(Boolean))] as string[]
  const compIds = [...new Set([...ids("comprobante_id"), ...cancelados.map((c) => c.comprobante_id).filter(Boolean)])] as string[]
  const [clientes, comprobantes, usuarios] = await Promise.all([
    fetchByIds<any>((ch) => supabase.from("clientes").select("id, codigo_cliente, codigo_cliente_eliminado, nombre_razon_social, razon_social, nombre").in("id", ch), ids("cliente_id")),
    fetchByIds<any>((ch) => supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante").in("id", ch), compIds),
    fetchByIds<any>((ch) => supabase.from("usuarios").select("id, nombre").in("id", ch), ids("usuario_id")),
  ])
  const cliDe = new Map(clientes.map((c) => [c.id, c]))
  const compDe = new Map(comprobantes.map((c) => [c.id, c]))
  const usrDe = new Map(usuarios.map((u) => [u.id, u.nombre as string]))

  const renglones: RenglonAjuste[] = filas
    .map((f) => {
      const c = cliDe.get(f.cliente_id)
      const cp = compDe.get(f.comprobante_id)
      return {
        id: f.id,
        fecha: f.fecha,
        origen: f.origen,
        origen_label: ORIGENES_AJUSTE[f.origen as OrigenAjuste] ?? f.origen,
        monto: Number(f.monto) || 0,
        motivo: f.motivo,
        cliente: c
          ? { id: c.id, codigo: c.codigo_cliente ?? c.codigo_cliente_eliminado ?? null, nombre: c.nombre_razon_social || c.razon_social || c.nombre || "—" }
          : null,
        usuario: f.usuario_id ? usrDe.get(f.usuario_id) ?? null : null,
        usuario_id: f.usuario_id,
        pago_id: f.pago_id,
        comprobante: cp ? { id: cp.id, tipo: cp.tipo_comprobante, numero: cp.numero_comprobante } : null,
        cancelados: (canceladosDe.get(f.id) || []).map((x) => {
          const k = compDe.get(x.comprobante_id)
          return {
            comprobante: k ? { id: k.id, tipo: k.tipo_comprobante, numero: k.numero_comprobante } : null,
            pago_id: x.pago_id,
            saldo_anterior: Number(x.saldo_anterior) || 0,
          }
        }),
      }
    })
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))

  return {
    saldo,
    saldo_filtrado: r2(renglones.reduce((s, r) => s + r.monto, 0)),
    renglones,
    usuarios: [...usrDe.entries()].map(([id, nombre]) => ({ id, nombre })),
    origenes: Object.entries(ORIGENES_AJUSTE).map(([key, label]) => ({ key, label })),
  }
}

