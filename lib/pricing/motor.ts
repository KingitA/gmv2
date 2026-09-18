// =====================================================
// Motor de precios isomórfico — precio de un artículo para un cliente
// =====================================================
// ÚNICA función que decide el precio que ve el cliente/vendedor. La usan:
//   - lib/actions/pedidos.ts (previewPrecioArticulo / previewPreciosArticulos)
//   - las apps móviles (mobile/), que la ejecutan contra su réplica local
//   - la re-verificación de integridad al sincronizar pedidos offline
// Recibe los INSUMOS ya cargados (sin DB): quien llama decide si salen de
// Supabase (servidor) o de IndexedDB (dispositivo). Mismos insumos ⇒ mismo
// precio, bit a bit. No agregar acá imports de servidor ni de React.

import { calcularPrecioPedido, type ArticuloPrecioInput } from "./calcular-precio-pedido"
import type { DatosLista, DescuentoTipado } from "./calculator"
import { detectarSegmento, type BonifPedido, type Segmento } from "./segmento"
import {
  toMetodoFacturacion,
  resolverListaSegmento,
  resolverCondSegmento,
  resolverBonifItem,
  bonifGeneralViajanteDesdeFilas,
  mergeCondicionesProveedor,
  mergeCondicionesMarca,
  type ClienteListas,
  type CondicionProveedor,
  type CondicionMarca,
  type OverridesListaPedido,
} from "./resolver"

/** Fila de `listas_precio` (columnas que usa el motor). */
export interface ListaPrecioRow {
  id: string
  codigo: string | null
  recargo_limpieza_bazar: number | null
  recargo_perfumeria_negro: number | null
  recargo_perfumeria_blanco: number | null
}

/** Fila de `listas_precio_reglas`. */
export interface ReglaPrecioRow {
  grupo_precio: string
  iva_compras: string
  iva_ventas: string
  formulas: Record<string, string> | null
}

/** Artículo con sus descuentos tipados y metadatos de segmento. */
export type ArticuloMotor = ArticuloPrecioInput & {
  proveedor_id?: string | null
  marca_id?: string | null
}

/** Insumos del motor que NO dependen del artículo (se cargan una vez por cliente). */
export interface InsumosCliente {
  cliente: ClienteListas
  listas: ListaPrecioRow[]
  reglas: ReglaPrecioRow[]
  condicionesProveedor: CondicionProveedor[]
  condicionesMarca: CondicionMarca[]
  /** Filas activas de `bonificaciones` del cliente (tipo general | viajante). */
  bonificaciones: Array<{ tipo: string; segmento: string | null; porcentaje: number }>
}

/** Overrides de un pedido en curso (lo que el vendedor cambia "solo para este pedido"). */
export interface OverridesPedido extends OverridesListaPedido {
  bonif_pedido?: BonifPedido | null
  condiciones_proveedor?: CondicionProveedor[] | null
  condiciones_marca?: CondicionMarca[] | null
}

export interface PrecioArticuloCliente {
  precio: number
  precioNeto: number
  contado: number
  ivaIncluido: boolean
  especial: { bruto: number; oferta_pct: number } | null
  bonifViajantePct: number
  bonifGeneralPct: number
  /** Lista y método efectivamente usados (para guardar en pedidos_detalle). */
  listaId: string | null
  metodoRaw: string
  segmento: Segmento
  vaEnComprobante: "factura" | "presupuesto"
}

function round2(n: number) { return Math.round(n * 100) / 100 }

export function formulasReglasDesdeFilas(reglas: ReglaPrecioRow[]): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {}
  for (const row of reglas) map[`${row.grupo_precio}|${row.iva_compras}|${row.iva_ventas}`] = row.formulas || {}
  return map
}

export function datosListaDesdeFila(
  fila: ListaPrecioRow | null | undefined,
  formulasReglas?: Record<string, Record<string, string>>,
): DatosLista {
  if (!fila) return { recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }
  return {
    recargo_limpieza_bazar: fila.recargo_limpieza_bazar || 0,
    recargo_perfumeria_negro: fila.recargo_perfumeria_negro || 0,
    recargo_perfumeria_blanco: fila.recargo_perfumeria_blanco || 0,
    lista_codigo: fila.codigo || undefined,
    formulas_reglas: formulasReglas,
  }
}

/**
 * Prepara los insumos de un cliente para calcular muchos artículos seguidos
 * (índices por id, fórmulas, bonificaciones con override). Barato: llamarlo
 * de nuevo cuando cambian los overrides del pedido.
 */
export function prepararMotorCliente(insumos: InsumosCliente, overrides: OverridesPedido = {}) {
  const formulas = formulasReglasDesdeFilas(insumos.reglas)
  const listasPorId = new Map(insumos.listas.map((l) => [l.id, l]))
  const listaCache = new Map<string, DatosLista>()
  const datosLista = (id: string | null): DatosLista => {
    const k = id || ""
    let d = listaCache.get(k)
    if (!d) {
      d = datosListaDesdeFila(id ? listasPorId.get(id) : null, formulas)
      listaCache.set(k, d)
    }
    return d
  }
  const condProv = mergeCondicionesProveedor(
    new Map(insumos.condicionesProveedor.map((c) => [c.proveedor_id, c])),
    overrides.condiciones_proveedor,
  )
  const condMarca = mergeCondicionesMarca(
    new Map(insumos.condicionesMarca.map((c) => [c.marca_id, c])),
    overrides.condiciones_marca,
  )
  const { general, viajante } = bonifGeneralViajanteDesdeFilas(insumos.bonificaciones, overrides.bonif_pedido)

  return {
    precio(articulo: ArticuloMotor): PrecioArticuloCliente {
      const segmento = detectarSegmento(articulo)
      const { cond } = resolverCondSegmento(articulo, condProv, condMarca)
      let listaId: string | null
      let metodoRaw: string
      if (cond) {
        listaId = cond.lista_precio_id
        metodoRaw = cond.metodo_facturacion || "Final"
      } else {
        const r = resolverListaSegmento(segmento, overrides, insumos.cliente)
        listaId = r.listaId
        metodoRaw = r.metodoRaw
      }
      const bonif = resolverBonifItem(cond, general, viajante, segmento)
      const p = calcularPrecioPedido(articulo, datosLista(listaId), toMetodoFacturacion(metodoRaw), bonif)
      return {
        precio: p.precioAlCliente,
        precioNeto: p.precioNeto,
        // Contado = 10% menos (regla de la NC de pago contado).
        // Lista Especial NO tiene precio contado: es neto fijo + IVA.
        contado: p.esListaEspecial ? p.precioAlCliente : round2(p.precioAlCliente * 0.9),
        // precio > neto → el precio mostrado lleva IVA incluido; iguales → sin IVA (presupuesto)
        ivaIncluido: Math.abs(p.precioAlCliente - p.precioNeto) > 0.01,
        especial: p.esListaEspecial ? { bruto: p.precioBrutoEspecial, oferta_pct: p.ofertaEspecialPct } : null,
        bonifViajantePct: p.bonifViajantePct,
        bonifGeneralPct: p.bonifGeneralPct,
        listaId,
        metodoRaw,
        segmento,
        vaEnComprobante: p.vaEnComprobante,
      }
    },
  }
}

/** Atajo para un solo artículo. */
export function precioArticuloParaCliente(
  insumos: InsumosCliente,
  articulo: ArticuloMotor,
  overrides: OverridesPedido = {},
): PrecioArticuloCliente {
  return prepararMotorCliente(insumos, overrides).precio(articulo)
}

/** Agrupa filas de `articulos_descuentos` por artículo (orden ascendente). */
export function descuentosPorArticulo(
  rows: Array<{ articulo_id: string; tipo: string; porcentaje: number; orden: number }>,
): Map<string, DescuentoTipado[]> {
  const map = new Map<string, DescuentoTipado[]>()
  for (const d of [...rows].sort((a, b) => a.orden - b.orden)) {
    const list = map.get(d.articulo_id) || []
    list.push({ tipo: d.tipo as DescuentoTipado["tipo"], porcentaje: d.porcentaje, orden: d.orden })
    map.set(d.articulo_id, list)
  }
  return map
}
