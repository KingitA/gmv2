// =====================================================
// Resolución de lista / método / bonificaciones por ítem — PURO
// =====================================================
// Extraído de lib/actions/pedidos.ts (antes funciones privadas del archivo
// "use server"). Sin DB ni imports de servidor: lo ejecutan idéntico las
// server actions / API routes del ERP y las apps móviles (motor isomórfico,
// ver MOBILE.md → "Precios"). Cualquier cambio acá cambia el precio en
// TODOS lados a la vez: es intencional.

import type { MetodoFacturacion } from "./calculator"
import {
  SEGMENTO_BONIF,
  normalizarBonifPedido,
  bonifSegAFilas,
  type Segmento,
  type BonifPedido,
} from "./segmento"

export function toMetodoFacturacion(raw: string | null | undefined): MetodoFacturacion {
  if (!raw) return "Final"
  if (raw === "Factura (21% IVA)" || raw === "Factura") return "Factura"
  if (raw === "Presupuesto") return "Presupuesto"
  return "Final"
}

// Resuelve qué listaId + metodoRaw usar para un segmento dado.
// Jerarquía (06/10/2026): override del pedido por segmento → override GENERAL del
// pedido → ficha del cliente por segmento → ficha general. Lo elegido "solo para
// este pedido" gana siempre sobre la ficha: antes la ficha por segmento le ganaba
// al override general y el método elegido para el pedido no se aplicaba.
// (Los pedidos de la APK vendedor ≤ 0.2.3 conservan la regla vieja: ver
// compatOverridesApkVieja en lib/mobile/outbox/vendedor.ts.)
// Centinelas de UI que NUNCA deben llegar como lista/método concretos: si el
// usuario eligió "por segmento", el valor general queda vacío y resuelve por segmento.
const CENTINELAS_SEGMENTO = new Set(["PorSegmento", "porsegmento", "__por_segmento__", "por_segmento"])
export function limpiarCentinela(v?: string | null): string | undefined {
  return v && !CENTINELAS_SEGMENTO.has(v) ? v : undefined
}

/** Overrides de lista/método que puede traer un pedido (columnas *_pedido). */
export interface OverridesListaPedido {
  lista_limpieza_pedido_id?: string | null; metodo_limpieza_pedido?: string | null
  lista_perf0_pedido_id?: string | null;    metodo_perf0_pedido?: string | null
  lista_perf_plus_pedido_id?: string | null; metodo_perf_plus_pedido?: string | null
  lista_precio_pedido_id?: string | null;   metodo_facturacion_pedido?: string | null
}

/** Configuración de listas/métodos de la ficha del cliente. */
export interface ClienteListas {
  lista_limpieza_id?: string | null; metodo_limpieza?: string | null
  lista_perf0_id?: string | null;    metodo_perf0?: string | null
  lista_perf_plus_id?: string | null; metodo_perf_plus?: string | null
  lista_precio_id?: string | null;   metodo_facturacion?: string | null
}

export function resolverListaSegmento(
  segmento: Segmento,
  overrides: OverridesListaPedido,
  cliente: ClienteListas,
): { listaId: string | null; metodoRaw: string } {
  const lc = limpiarCentinela
  const general = {
    listaId: lc(overrides.lista_precio_pedido_id) || lc(cliente.lista_precio_id) || null,
    metodoRaw: lc(overrides.metodo_facturacion_pedido) || lc(cliente.metodo_facturacion) || "Final",
  }

  const ovLista = lc(overrides.lista_precio_pedido_id)
  const ovMetodo = lc(overrides.metodo_facturacion_pedido)
  const pick = (ovSegLista?: string | null, ovSegMetodo?: string | null, cliSegLista?: string | null, cliSegMetodo?: string | null) => ({
    listaId: lc(ovSegLista) || ovLista || lc(cliSegLista) || general.listaId,
    metodoRaw: lc(ovSegMetodo) || ovMetodo || lc(cliSegMetodo) || general.metodoRaw,
  })

  if (segmento === "limpieza") {
    return pick(overrides.lista_limpieza_pedido_id, overrides.metodo_limpieza_pedido, cliente.lista_limpieza_id, cliente.metodo_limpieza)
  }
  if (segmento === "perf0") {
    return pick(overrides.lista_perf0_pedido_id, overrides.metodo_perf0_pedido, cliente.lista_perf0_id, cliente.metodo_perf0)
  }
  // perf_plus
  return pick(overrides.lista_perf_plus_pedido_id, overrides.metodo_perf_plus_pedido, cliente.lista_perf_plus_id, cliente.metodo_perf_plus)
}

/**
 * Lista y método de un ítem: la condición por marca/proveedor define los suyos;
 * lo que deja vacío ("del pedido") HEREDA la resolución normal del segmento.
 * Antes una lista vacía en la condición se cotizaba SIN lista (sin recargo ni
 * fórmula) y un método vacío como "Final".
 */
export function resolverListaMetodoConCondicion(
  segmento: Segmento,
  cond: CondicionSegmento | null,
  overrides: OverridesListaPedido,
  cliente: ClienteListas,
): { listaId: string | null; metodoRaw: string } {
  const base = resolverListaSegmento(segmento, overrides, cliente)
  if (!cond) return base
  return {
    listaId: limpiarCentinela(cond.lista_precio_id) || base.listaId,
    metodoRaw: limpiarCentinela(cond.metodo_facturacion) || base.metodoRaw,
  }
}

// ─── Condiciones por proveedor / marca ───────────────────────────────────────
// El proveedor sólo identifica QUÉ mercadería (articulos.proveedor_id) recibe estas
// condiciones para este cliente. lista/método se aplican al precio; los 3 descuentos
// se aplican como líneas en el comprobante (general/viajante) o como bonificada (mercadería).
// Condición de segmento (lista/método/descuentos). El segmento se identifica por
// proveedor o por marca. Marca gana sobre proveedor cuando un artículo cae en ambos.
export type CondicionSegmento = {
  lista_precio_id: string | null
  metodo_facturacion: string | null
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
  /** true = esa mercadería sale con 10% contado · false = no · null/ausente = hereda */
  contado?: boolean | null
}
export type CondicionProveedor = CondicionSegmento & { proveedor_id: string }
export type CondicionMarca = CondicionSegmento & { marca_id: string }

// Combina las condiciones del cliente con overrides de formulario (al crear el pedido,
// cuando todavía no existe pedido_proveedor_condicion).
export function mergeCondicionesProveedor(
  base: Map<string, CondicionProveedor>,
  overrides?: CondicionProveedor[] | null,
): Map<string, CondicionProveedor> {
  const map = new Map(base)
  for (const o of overrides || []) if (o?.proveedor_id) map.set(o.proveedor_id, o)
  return map
}

export function mergeCondicionesMarca(
  base: Map<string, CondicionMarca>,
  overrides?: CondicionMarca[] | null,
): Map<string, CondicionMarca> {
  const map = new Map(base)
  for (const o of overrides || []) if (o?.marca_id) map.set(o.marca_id, o)
  return map
}

// Resuelve la condición de segmento de un artículo: MARCA gana sobre PROVEEDOR.
export function resolverCondSegmento(
  articulo: { proveedor_id?: string | null; marca_id?: string | null },
  condProvMap: Map<string, CondicionProveedor>,
  condMarcaMap: Map<string, CondicionMarca>,
): { cond: CondicionSegmento | null; segKey: string | null } {
  const marcaCond = (articulo.marca_id && condMarcaMap.get(articulo.marca_id)) || null
  if (marcaCond) return { cond: marcaCond, segKey: `marca:${articulo.marca_id}` }
  const provCond = (articulo.proveedor_id && condProvMap.get(articulo.proveedor_id)) || null
  if (provCond) return { cond: provCond, segKey: `prov:${articulo.proveedor_id}` }
  return { cond: null, segKey: null }
}

// ─── Bonificaciones ──────────────────────────────────────────────────────────

export type FilaBonif = { segmento: string | null; porcentaje: number }

/**
 * Devuelve el descuento_viajante (%) aplicable al segmento dado.
 * Prioriza segmento específico sobre segmento NULL (todos).
 */
export function getDescuentoViajante(bonifs: FilaBonif[], segmento: Segmento): number {
  const key = SEGMENTO_BONIF[segmento]
  const especifico = bonifs.find(b => b.segmento === key)
  if (especifico) return especifico.porcentaje
  const general = bonifs.find(b => b.segmento === null || b.segmento === "")
  return general?.porcentaje ?? 0
}

/**
 * Devuelve la bonificación general (%) aplicable al segmento dado.
 * Misma resolución que viajante: segmento específico > segmento NULL (todos).
 */
export function getDescuentoGeneral(bonifs: FilaBonif[], segmento: Segmento): number {
  const key = SEGMENTO_BONIF[segmento]
  const especifico = bonifs.find(b => b.segmento === key)
  if (especifico) return especifico.porcentaje
  const general = bonifs.find(b => b.segmento === null || b.segmento === "")
  return general?.porcentaje ?? 0
}

// Override por segmento del pedido sobre la ficha: los segmentos definidos en
// el override pisan; el resto queda como en la ficha. Vale para general y viajante.
export function mezclarOverride(
  ficha: FilaBonif[],
  bonifPedido: BonifPedido | null | undefined,
  tipo: "general" | "viajante",
): FilaBonif[] {
  const ovr = normalizarBonifPedido(bonifPedido)?.[tipo]
  if (!ovr) return ficha
  const filasOvr = bonifSegAFilas(ovr)
  const segsOvr = new Set(filasOvr.map((f) => f.segmento))
  // La fila "sin segmento" de la ficha sigue valiendo para los segmentos no pisados,
  // pero una fila específica pisada se reemplaza.
  return [...filasOvr, ...ficha.filter((f) => !segsOvr.has(f.segmento))]
}

/**
 * Separa las filas activas de `bonificaciones` de un cliente en general/viajante
 * aplicando el override "solo este pedido" (pedidos.bonif_pedido).
 */
export function bonifGeneralViajanteDesdeFilas(
  rows: Array<{ tipo: string; segmento: string | null; porcentaje: number }>,
  bonifPedido?: BonifPedido | null,
): { general: FilaBonif[]; viajante: FilaBonif[] } {
  return {
    general: mezclarOverride(rows.filter((b) => b.tipo === "general"), bonifPedido, "general"),
    viajante: mezclarOverride(rows.filter((b) => b.tipo === "viajante"), bonifPedido, "viajante"),
  }
}

/**
 * Resuelve los % de general/viajante para un ítem.
 * Con condición por proveedor/marca: cada % que la condición DEFINE (no null) pisa;
 * el que deja en null se hereda de la resolución normal (override del pedido > ficha).
 * Antes un null se tomaba como 0 y se perdía, p. ej., el viajante "solo este pedido"
 * en la mercadería de un proveedor con condición que solo fijaba el general.
 */
export function resolverBonifItem(
  cond: CondicionSegmento | null,
  general: FilaBonif[],
  viajante: FilaBonif[],
  segmento: Segmento,
): { generalPct: number; viajantePct: number } {
  const definido = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(Number(v))
  const generalPct = cond && definido(cond.dto_general_pct) ? Number(cond.dto_general_pct) : getDescuentoGeneral(general, segmento)
  const viajantePct = cond && definido(cond.dto_viajante_pct) ? Number(cond.dto_viajante_pct) : getDescuentoViajante(viajante, segmento)
  return { generalPct, viajantePct }
}

// ─── Contado y mercadería bonificada por ítem ────────────────────────────────
// `fichaFilas`: filas activas de `bonificaciones` de la ficha (las congeladas en
// el pedido) de tipo mercaderia / contado. segmento null = "todos los segmentos".

export type FilaBonifTipo = { tipo: string; segmento: string | null; porcentaje: number }

function filaFicha(filas: FilaBonifTipo[], tipo: string, segmento: Segmento): FilaBonifTipo | null {
  const key = SEGMENTO_BONIF[segmento]
  const deTipo = filas.filter((b) => b.tipo === tipo)
  return deTipo.find((b) => b.segmento === key) || deTipo.find((b) => b.segmento === null || b.segmento === "") || null
}

const definidoNum = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))

/**
 * ¿El ítem sale con 10% por pago contado? Jerarquía: condición marca/proveedor
 * (si lo define) > "solo este pedido" por segmento > ficha (segmento > todos).
 * La lista Especial nunca lleva contado (neto fijo + IVA).
 */
export function resolverContadoItem(
  cond: CondicionSegmento | null,
  bonifPedido: BonifPedido | null | undefined,
  fichaFilas: FilaBonifTipo[],
  segmento: Segmento,
  esEspecial = false,
): boolean {
  if (esEspecial) return false
  if (cond && cond.contado !== null && cond.contado !== undefined) return !!cond.contado
  const ov = normalizarBonifPedido(bonifPedido)?.contado?.[SEGMENTO_BONIF[segmento]]
  if (typeof ov === "number") return ov > 0
  return (filaFicha(fichaFilas, "contado", segmento)?.porcentaje || 0) > 0
}

/**
 * Cupo de mercadería bonificada al que aporta un ítem, y su %. El origen
 * identifica el cupo: "marca:<id>" / "prov:<id>" (condición propia),
 * "seg:<segmento>" (por segmento) o "todo" (todo el pedido). Jerarquía:
 * condición (si define %) > pedido por segmento > pedido "todo"
 * (pedidos.bonif_mercaderia_pct) > ficha por segmento > ficha "todos".
 * 0 = sin mercadería para ese ítem. La lista Especial no bonifica.
 */
export function resolverMercaderiaItem(
  cond: CondicionSegmento | null,
  segKey: string | null,
  bonifPedido: BonifPedido | null | undefined,
  mercTodoPedido: number | null | undefined,
  fichaFilas: FilaBonifTipo[],
  segmento: Segmento,
  esEspecial = false,
): { origen: string | null; pct: number } {
  const nada = { origen: null, pct: 0 }
  if (esEspecial) return nada
  const seg = SEGMENTO_BONIF[segmento]
  if (cond && segKey && definidoNum(cond.dto_mercaderia_pct)) {
    const pct = Number(cond.dto_mercaderia_pct)
    return pct > 0 ? { origen: segKey, pct } : nada
  }
  const ov = normalizarBonifPedido(bonifPedido)?.mercaderia?.[seg]
  if (typeof ov === "number") return ov > 0 ? { origen: `seg:${seg}`, pct: ov } : nada
  if (definidoNum(mercTodoPedido)) {
    const pct = Number(mercTodoPedido)
    return pct > 0 ? { origen: "todo", pct } : nada
  }
  const fila = filaFicha(fichaFilas, "mercaderia", segmento)
  if (!fila || !(Number(fila.porcentaje) > 0)) return nada
  return { origen: fila.segmento ? `seg:${seg}` : "todo", pct: Number(fila.porcentaje) }
}
