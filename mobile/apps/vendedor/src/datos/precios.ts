// Precios en el equipo (MOBILE.md §5): el MISMO motor que el servidor
// (`@gm/pricing` = lib/pricing/isomorfico.ts) sobre los insumos replicados. Nunca se
// guarda un precio calculado: se calcula al mostrarlo, así un cambio que llega por
// sync (o un cambio PROGRAMADO cuya hora llegó, aun sin red) se ve al instante.

import { useEffect, useMemo, useState } from "react"
import { useDataset, useRuntime, type Runtime } from "@gm/core"
import {
  aplicarProgramados,
  prepararMotorCliente,
  proximaVigencia,
  type ArticuloMotor,
  type CambioProgramado,
  type InsumosCliente,
  type ListaPrecioRow,
  type OverridesPedido,
  type PrecioArticuloCliente,
  type ReglaPrecioRow,
} from "@gm/pricing"
import { DS, DS_PRECIOS, type CondPedido } from "../datasets"

type FilaArticuloPrecio = ArticuloMotor & { id: string }
interface FilaClientePrecio {
  id: string
  cliente: InsumosCliente["cliente"] & { id: string }
  condicionesProveedor: InsumosCliente["condicionesProveedor"]
  condicionesMarca: InsumosCliente["condicionesMarca"]
  bonificaciones: InsumosCliente["bonificaciones"]
}

export type Precio = PrecioArticuloCliente

/** Overrides "solo este pedido" en la forma que entiende el motor (= condToOverrides de la web). */
export function overridesDe(c: CondPedido): OverridesPedido {
  const b = c.bonif
  const hayBonif = !!b && ((!!b.viajante && Object.keys(b.viajante).length > 0) || (!!b.mercaderia && Object.keys(b.mercaderia).length > 0))
  return {
    ...(c.metodo ? { metodo_facturacion_pedido: c.metodo } : {}),
    ...(c.lista ? { lista_precio_pedido_id: c.lista } : {}),
    ...(hayBonif ? { bonif_pedido: b as OverridesPedido["bonif_pedido"] } : {}),
  }
}

/**
 * Hora (del servidor) de los precios que el vendedor tiene a la vista: la frescura más
 * vieja de los datasets de precio. Viaja en cada pedido (`precios_al`): el servidor
 * recalcula con los insumos vigentes a ESA hora ⇒ da idéntico a lo que mostró la app.
 */
export function preciosAl(runtime: Runtime): string | null {
  let min: string | null = null
  for (const ds of DS_PRECIOS) {
    const g = runtime.replica.metaSync(ds)?.generadoAt
    if (!g) return null
    if (!min || g < min) min = g
  }
  return min
}

/** Insumos comunes a todos los clientes, con los cambios programados ya vigentes aplicados. */
export function useInsumosBase() {
  const { reloj } = useRuntime()
  const listas = useDataset<ListaPrecioRow & { nombre?: string }>(DS.preciosListas)
  const reglas = useDataset<ReglaPrecioRow & { id: string }>(DS.preciosReglas)
  const programados = useDataset<CambioProgramado>(DS.preciosProgramados)
  const articulos = useDataset<FilaArticuloPrecio>(DS.preciosArticulos)

  // Re-render a la hora EXACTA del próximo cambio programado (sin red también)
  const [tic, setTic] = useState(0)
  useEffect(() => {
    const prox = proximaVigencia(programados.filas, new Date(reloj.ahora()))
    if (!prox) return
    const ms = Math.min(prox.getTime() - reloj.ahora() + 250, 2 ** 31 - 1)
    const t = setTimeout(() => setTic((n) => n + 1), Math.max(250, ms))
    return () => clearTimeout(t)
  }, [programados.filas, reloj, tic])

  return useMemo(() => {
    const ahora = new Date(reloj.ahora())
    const arts = aplicarProgramados(articulos.filas, programados.filas, "articulos", ahora)
    return {
      listas: aplicarProgramados(listas.filas, programados.filas, "listas_precio", ahora),
      reglas: reglas.filas,
      articulos: new Map(arts.map((a) => [a.id, a])),
      listo: !articulos.cargando && !listas.cargando && !reglas.cargando,
      vacio: !articulos.cargando && articulos.filas.length === 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listas.filas, reglas.filas, programados.filas, articulos.filas, articulos.cargando, listas.cargando, reglas.cargando, tic])
}

export interface MotorLocal {
  /** null = artículo sin insumos de precio en el equipo (no se puede vender) */
  precio(articuloId: string): Precio | null
  listo: boolean
  /** true = todavía no se descargaron precios en este equipo */
  sinDatos: boolean
}

function motorDe(base: ReturnType<typeof useInsumosBase>, insumosCliente: Omit<InsumosCliente, "listas" | "reglas"> | null, overrides: OverridesPedido): MotorLocal {
  if (!insumosCliente) return { precio: () => null, listo: base.listo, sinDatos: base.vacio }
  const motor = prepararMotorCliente({ ...insumosCliente, listas: base.listas, reglas: base.reglas }, overrides)
  const cache = new Map<string, Precio | null>()
  return {
    listo: base.listo,
    sinDatos: base.vacio,
    precio(id) {
      let p = cache.get(id)
      if (p === undefined) {
        const art = base.articulos.get(id)
        try {
          p = art ? motor.precio(art) : null
        } catch {
          p = null
        }
        cache.set(id, p)
      }
      return p
    },
  }
}

/**
 * Motor de precios de UN cliente con las condiciones del pedido en curso.
 * `fichaLocal`: cliente dado de alta en este equipo que todavía no está en la réplica
 * de precios (nace sin condiciones ni bonificaciones, con su lista y método).
 */
export function useMotorCliente(clienteId: string | undefined, cond: CondPedido, fichaLocal?: { lista_precio_id: string | null; metodo_facturacion: string | null } | null): MotorLocal {
  const base = useInsumosBase()
  const clientes = useDataset<FilaClientePrecio>(DS.preciosClientes)
  const fila = useMemo(() => (clienteId ? clientes.filas.find((c) => c.id === clienteId) ?? null : null), [clientes.filas, clienteId])
  const claveCond = JSON.stringify(cond)
  return useMemo(() => {
    const insumos = fila
      ? { cliente: fila.cliente, condicionesProveedor: fila.condicionesProveedor, condicionesMarca: fila.condicionesMarca, bonificaciones: fila.bonificaciones }
      : fichaLocal
        ? { cliente: { ...fichaLocal }, condicionesProveedor: [], condicionesMarca: [], bonificaciones: [] }
        : null
    return motorDe(base, insumos, overridesDe(cond))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, fila, fichaLocal?.lista_precio_id, fichaLocal?.metodo_facturacion, claveCond])
}

/**
 * Precio de LISTA × método sin cliente (pantalla Precios = previewPreciosListas de la
 * web): sin condiciones ni bonificaciones.
 */
export function useMotoresLista(combos: Array<{ lista_id: string; metodo: string }>): MotorLocal[] {
  const base = useInsumosBase()
  const clave = combos.map((c) => `${c.lista_id}|${c.metodo}`).join(",")
  return useMemo(
    () => combos.map((c) => motorDe(base, { cliente: { lista_precio_id: c.lista_id, metodo_facturacion: c.metodo }, condicionesProveedor: [], condicionesMarca: [], bonificaciones: [] }, {})),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, clave],
  )
}
