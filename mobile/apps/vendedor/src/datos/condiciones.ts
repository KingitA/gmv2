// Condiciones comerciales de un pedido en la app (precios pendientes de la v0.4.0, pedido del
// dueño 06/10 confirmado el 20/10): descuento GENERAL y CONTADO por segmento "solo este
// pedido", condiciones por PROVEEDOR / MARCA del pedido y MERCADERÍA bonificada por cupo.
// Misma semántica que el ERP (lib/pedidos/condiciones-form.ts) y mismo motor
// (@gm/pricing: resolverCondSegmento, resolverMercaderiaItem): lo que se ve acá es lo que
// cotiza y arma el servidor.

import { useMemo } from "react"
import { useDataset } from "@gm/core"
import {
  contadoPorDefectoCliente,
  detectarSegmento,
  normalizarBonifPedido,
  resolverCondSegmento,
  resolverContadoItem,
  resolverMercaderiaItem,
  SEGMENTO_LABEL,
  type ArticuloMotor,
  type CondicionMarca,
  type CondicionProveedor,
} from "@gm/pricing"
import { DS, SEGS, type BonifSeg, type CondPedido, type Segmento } from "../datasets"

export type TipoBonif = "general" | "viajante" | "mercaderia" | "contado"
export const TIPOS_DESC = ["general", "viajante", "mercaderia"] as const

interface FilaBonif { tipo: string; segmento: string | null; porcentaje: number }
interface FilaPrecioCliente {
  id: string
  condicionesProveedor: CondicionProveedor[]
  condicionesMarca: CondicionMarca[]
  bonificaciones: FilaBonif[]
}

/** % de la ficha de un tipo, por segmento (segmento propio > fila "todos"). */
export function bonifFichaPorSeg(filas: FilaBonif[], tipo: TipoBonif): BonifSeg {
  const out: BonifSeg = {}
  const todos = filas.find((f) => f.tipo === tipo && !f.segmento)
  for (const s of SEGS) {
    const propio = filas.find((f) => f.tipo === tipo && f.segmento === s)
    const v = Number((propio ?? todos)?.porcentaje || 0)
    if (v) out[s] = tipo === "contado" ? (v > 0 ? 10 : 0) : v
  }
  return out
}

export interface CondicionesFicha {
  filas: FilaBonif[]
  bonif: Record<TipoBonif, BonifSeg>
  condProv: CondicionProveedor[]
  condMarca: CondicionMarca[]
}

/** Ficha comercial del cliente según la réplica de precios. */
export function useCondicionesFicha(clienteId: string | undefined): CondicionesFicha | null {
  const { filas } = useDataset<FilaPrecioCliente>(DS.preciosClientes)
  return useMemo(() => {
    const f = clienteId ? filas.find((x) => x.id === clienteId) : null
    if (!f) return null
    const b = f.bonificaciones || []
    return {
      filas: b,
      bonif: {
        general: bonifFichaPorSeg(b, "general"),
        viajante: bonifFichaPorSeg(b, "viajante"),
        mercaderia: bonifFichaPorSeg(b, "mercaderia"),
        contado: bonifFichaPorSeg(b, "contado"),
      },
      condProv: f.condicionesProveedor || [],
      condMarca: f.condicionesMarca || [],
    }
  }, [filas, clienteId])
}

// ─── Mercadería bonificada por cupo ──────────────────────────────────────────

export interface Cupo {
  /** "todo" | "seg:<segmento>" | "prov:<id>" | "marca:<id>" (= servidor) */
  origen: string
  nombre: string
  pct: number
  /** Neto de los renglones del cupo (estimado: el monto exacto lo fija el picking) */
  base: number
  monto: number
}

/**
 * Cupos de mercadería del pedido en curso: a qué cupo cae cada renglón, con el mismo
 * resolverMercaderiaItem del servidor (createPedido → bonif_merc_origen). Un cupo sin
 * artículos elegidos queda PENDIENTE y no se factura.
 */
export function cuposDelPedido(
  lineas: Array<{ art: ArticuloMotor; cantidad: number; neto: number }>,
  ficha: CondicionesFicha | null,
  cond: CondPedido,
  nombres: { proveedor: (id: string) => string; marca: (id: string) => string },
): Cupo[] {
  if (!ficha) return []
  const condProv = new Map((cond.condProv ?? ficha.condProv).map((c) => [c.proveedor_id, c]))
  const condMarca = new Map((cond.condMarca ?? ficha.condMarca).map((c) => [c.marca_id, c]))
  const bonifPedido = normalizarBonifPedido(cond.bonif as never)
  const cupos = new Map<string, Cupo>()
  for (const l of lineas) {
    const seg = detectarSegmento(l.art)
    const { cond: c, segKey } = resolverCondSegmento(l.art, condProv, condMarca)
    const m = resolverMercaderiaItem(c, segKey, bonifPedido, null, ficha.filas as never, seg, false)
    if (!m.origen || !(m.pct > 0)) continue
    const k = cupos.get(m.origen) || { origen: m.origen, nombre: nombreCupo(m.origen, nombres), pct: 0, base: 0, monto: 0 }
    k.pct = Math.max(k.pct, m.pct)
    k.base += l.neto * l.cantidad
    cupos.set(m.origen, k)
  }
  return [...cupos.values()].map((k) => ({ ...k, base: Math.round(k.base * 100) / 100, monto: Math.round(k.base * k.pct) / 100 }))
}

function nombreCupo(origen: string, nombres: { proveedor: (id: string) => string; marca: (id: string) => string }): string {
  if (origen === "todo") return "Todo el pedido"
  if (origen.startsWith("seg:")) {
    const s = origen.slice(4) as Segmento
    return SEGMENTO_LABEL[s as keyof typeof SEGMENTO_LABEL] ?? s
  }
  if (origen.startsWith("prov:")) return `Proveedor ${nombres.proveedor(origen.slice(5))}`
  if (origen.startsWith("marca:")) return `Marca ${nombres.marca(origen.slice(6))}`
  return origen
}

// ─── 10 % por pago contado al finalizar el pedido (V1, #13, regla del dueño 26/10/2026) ───
//
// Checkbox "10 % descuento pago contado" = bonif_pedido.contado_todo (true tildado, false
// destildado, ausente = cada artículo según su condición). Mismos resolvers que el servidor
// (@gm/pricing: contadoPorDefectoCliente, resolverContadoItem). El 10 % sale en NC/REV aparte
// al facturar: el precio de cada renglón no cambia, el TOTAL del pedido sí (en vivo).

/** Cómo arranca el checkbox para este cliente: "todo" (tildado), "parcial" o "nada". */
export function contadoInicial(ficha: CondicionesFicha | null, cond: CondPedido): "todo" | "parcial" | "nada" {
  return contadoPorDefectoCliente((ficha?.filas ?? []) as never, [...(cond.condProv ?? ficha?.condProv ?? []), ...(cond.condMarca ?? ficha?.condMarca ?? [])])
}

/** 10 % de los renglones que van contado (lo que baja el total del pedido). */
export function descuentoContado(
  lineas: Array<{ art: ArticuloMotor; cantidad: number; precio: number; especial: boolean }>,
  ficha: CondicionesFicha | null,
  cond: CondPedido,
): number {
  const condProv = new Map((cond.condProv ?? ficha?.condProv ?? []).map((c) => [c.proveedor_id, c]))
  const condMarca = new Map((cond.condMarca ?? ficha?.condMarca ?? []).map((c) => [c.marca_id, c]))
  const bonifPedido = normalizarBonifPedido(cond.bonif as never)
  let d = 0
  for (const l of lineas) {
    const { cond: c } = resolverCondSegmento(l.art, condProv, condMarca)
    if (resolverContadoItem(c, bonifPedido, (ficha?.filas ?? []) as never, detectarSegmento(l.art), l.especial)) d += l.precio * l.cantidad * 0.1
  }
  return Math.round(d * 100) / 100
}
