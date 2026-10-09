// Lista y método de facturación POR SEGMENTO (Limpieza/Bazar · Perfumería 0 ·
// Perfumería plus), como los resuelve el motor de precios (@gm/pricing): lo elegido
// "solo este pedido" → la ficha por segmento → la ficha general.
//
// Por qué existe (caso Freije, 09/10/2026): la app mostraba solo el método y la lista
// GENERALES de la ficha ("Factura", "Estándar" → chip "STD C/IVA") y el vendedor creía
// que el cliente iba todo en factura, cuando la ficha por segmento mandaba limpieza y
// perfumería 0 en presupuesto. Todo lo que muestra lista/método sale de acá.

import { useMemo } from "react"
import { useDataset } from "@gm/core"
import { limpiarCentinela, resolverListaSegmentoDefinido, type ClienteListas, type OverridesListaPedido, type Segmento } from "@gm/pricing"
import { DS } from "../datasets"

export const SEGMENTOS_PRECIO: Array<{ seg: Segmento; label: string; corto: string }> = [
  { seg: "limpieza", label: "Limpieza / Bazar", corto: "L/B" },
  { seg: "perf0", label: "Perfumería 0", corto: "P0" },
  { seg: "perf_plus", label: "Perfumería plus", corto: "P+" },
]

const METODO_LABEL: Record<string, string> = { Factura: "Factura", "Factura (21% IVA)": "Factura", Final: "Final", Presupuesto: "Presupuesto" }
const METODO_CORTO: Record<string, string> = { Factura: "C/IVA", "Factura (21% IVA)": "C/IVA", Final: "FINAL", Presupuesto: "PRES" }
export const metodoLabel = (m: string | null) => (m ? METODO_LABEL[m] || m : null)
export const metodoCorto = (m: string | null) => (m ? METODO_CORTO[m] || m.toUpperCase() : null)

export interface CondSegmento {
  seg: Segmento
  label: string
  corto: string
  listaId: string | null
  listaNombre: string | null
  /** Método crudo (Factura / Presupuesto / Final) o null = nadie lo definió */
  metodo: string | null
  /** true = lo decide lo elegido "solo este pedido" (no la ficha) */
  delPedido: boolean
}

export interface ResumenSegmentos {
  filas: CondSegmento[]
  /** Los tres segmentos con la misma lista y el mismo método */
  uniforme: boolean
  /** Algún segmento sin lista o sin método: el pedido NO se puede cerrar así */
  incompleto: boolean
  /** Cantidad de condiciones por proveedor/marca de la ficha (pueden fijar otra lista/método a esa mercadería) */
  condicionesExtra: number
}

export function resumirSegmentos(
  cliente: ClienteListas | null,
  overrides: OverridesListaPedido,
  nombreLista: (id: string) => string | null,
  condicionesExtra = 0,
): ResumenSegmentos {
  const ovGeneralLista = !!limpiarCentinela(overrides.lista_precio_pedido_id)
  const ovGeneralMetodo = !!limpiarCentinela(overrides.metodo_facturacion_pedido)
  const filas = SEGMENTOS_PRECIO.map(({ seg, label, corto }) => {
    const r = resolverListaSegmentoDefinido(seg, overrides, cliente ?? {})
    return {
      seg, label, corto,
      listaId: r.listaId,
      listaNombre: r.listaId ? nombreLista(r.listaId) : null,
      metodo: r.metodoRaw,
      delPedido: ovGeneralLista || ovGeneralMetodo,
    }
  })
  const clave = (f: CondSegmento) => `${f.listaId}|${metodoLabel(f.metodo)}`
  return {
    filas,
    uniforme: filas.every((f) => clave(f) === clave(filas[0]!)),
    incompleto: filas.some((f) => !f.listaId || !f.metodo),
    condicionesExtra,
  }
}

interface FilaClientePrecio {
  id: string
  cliente: ClienteListas & { id: string }
  condicionesProveedor?: unknown[]
  condicionesMarca?: unknown[]
}

/** Nombre de lista por id (réplica de listas de precios). */
export function useNombreLista(): (id: string) => string | null {
  const { filas } = useDataset<{ id: string; nombre?: string | null; codigo?: string | null }>(DS.preciosListas)
  return useMemo(() => {
    const m = new Map(filas.map((l) => [l.id, l.nombre || l.codigo || null]))
    return (id: string) => m.get(id) ?? null
  }, [filas])
}

/**
 * Lista/método por segmento de un cliente con lo elegido para el pedido (`overrides`).
 * La ficha sale de la réplica de PRECIOS (trae las columnas por segmento); `fichaLocal`
 * = cliente dado de alta en este equipo que todavía no llegó a esa réplica.
 */
export function useSegmentosCliente(
  clienteId: string | undefined,
  overrides: OverridesListaPedido = {},
  /** Cliente que todavía no está en la réplica de precios (alta en este equipo / venta a cliente nuevo) */
  fichaLocal?: ClienteListas | null,
): ResumenSegmentos | null {
  const { filas } = useDataset<FilaClientePrecio>(DS.preciosClientes)
  const nombreLista = useNombreLista()
  const fila = useMemo(() => (clienteId ? filas.find((c) => c.id === clienteId) ?? null : null), [filas, clienteId])
  const clave = JSON.stringify(overrides)
  return useMemo(() => {
    const cliente = fila?.cliente ?? fichaLocal ?? null
    if (!cliente) return null
    const extra = (fila?.condicionesProveedor?.length || 0) + (fila?.condicionesMarca?.length || 0)
    return resumirSegmentos(cliente, overrides, nombreLista, extra)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fila, fichaLocal, nombreLista, clave])
}

// ─── Ficha: lista y método general o POR SEGMENTO (como el ERP) ──────────────

/** Las 8 columnas de lista/método de la ficha ("" = vacío / hereda de lo general). */
export const CAMPOS_FICHA_LISTAS = [
  "lista_precio_id", "metodo_facturacion",
  "lista_limpieza_id", "metodo_limpieza",
  "lista_perf0_id", "metodo_perf0",
  "lista_perf_plus_id", "metodo_perf_plus",
] as const
export type CampoFichaListas = (typeof CAMPOS_FICHA_LISTAS)[number]
export type FichaListas = Record<CampoFichaListas, string>

/** Columnas por segmento, en el orden de SEGMENTOS_PRECIO */
export const COLS_SEGMENTO: Array<{ seg: Segmento; label: string; lista: CampoFichaListas; metodo: CampoFichaListas }> = [
  { seg: "limpieza", label: "Limpieza / Bazar", lista: "lista_limpieza_id", metodo: "metodo_limpieza" },
  { seg: "perf0", label: "Perfumería 0", lista: "lista_perf0_id", metodo: "metodo_perf0" },
  { seg: "perf_plus", label: "Perfumería plus", lista: "lista_perf_plus_id", metodo: "metodo_perf_plus" },
]

/** Lee las 8 columnas de cualquier objeto (ficha de la réplica, payload, cliente local). */
export function fichaListasDe(o: Partial<Record<string, unknown>> | null | undefined): FichaListas {
  const out = {} as FichaListas
  for (const k of CAMPOS_FICHA_LISTAS) {
    const v = o?.[k]
    out[k] = typeof v === "string" ? limpiarCentinela(v) || "" : ""
  }
  return out
}

/** Para el motor / el resolver ("" → null). */
export function clienteListasDe(f: FichaListas): ClienteListas {
  const out: Record<string, string | null> = {}
  for (const k of CAMPOS_FICHA_LISTAS) out[k] = f[k] || null
  return out as ClienteListas
}

/** Ficha de lista/método del cliente tal como está en la réplica de PRECIOS (null = todavía no llegó). */
export function useFichaListas(clienteId: string | undefined): FichaListas | null {
  const { filas } = useDataset<FilaClientePrecio>(DS.preciosClientes)
  return useMemo(() => {
    const fila = clienteId ? filas.find((c) => c.id === clienteId) : null
    return fila ? fichaListasDe(fila.cliente as unknown as Record<string, unknown>) : null
  }, [filas, clienteId])
}
