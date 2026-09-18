import { useCallback, useEffect, useMemo } from "react"
import { useDataset, useFila, useNoEnviados, useOnline, useRuntime, useSesion, type ItemOutbox } from "@gm/core"
import {
  DS, type Articulo, type CatProveedores, type CatTipos, type CatTransportes, type Devolucion, type OrdenRecepcion, type PedidoDeposito,
} from "../datasets"
import { crearIndice, type Indice } from "./busqueda"
import { articulosTocados, devolucionesVisibles, vistaArticulo, vistaPedido, vistaRecepcion, type ArticuloVista, type Yo } from "./overlay"

/** Operario logueado (el nombre viene en la sesión: no hace falta red). */
export function useYo(): Yo {
  const { sesion } = useSesion()
  return useMemo(
    () => ({ id: sesion?.user.id ?? "", nombre: sesion?.user.nombre || sesion?.user.email?.split("@")[0] || "Operario" }),
    [sesion?.user.id, sesion?.user.nombre, sesion?.user.email],
  )
}

/** Encolar una operación (persistida al instante; se envía sola cuando hay señal). */
export function useEncolar() {
  const { outbox } = useRuntime()
  return useCallback(<P,>(tipo: string, payload: P, etiqueta: string) => outbox.encolar({ tipo, payload, etiqueta }), [outbox])
}

/** Al entrar a una pantalla con señal, pedir lo último sin bloquear nada. */
export function useRefrescarAlEntrar(dataset: string) {
  const { sync } = useRuntime()
  const online = useOnline()
  useEffect(() => {
    if (online) void sync.dataset(dataset)
  }, [sync, dataset, online])
}

// ─── Picking ─────────────────────────────────────────────────────────────────

export function usePedidos() {
  const { filas, cargando, meta } = useDataset<PedidoDeposito>(DS.pedidos)
  const ops = useNoEnviados()
  const pedidos = useMemo(
    () => filas.map((p) => vistaPedido(p, ops)).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
    [filas, ops],
  )
  return { pedidos, cargando, meta }
}

export function usePedido(id: string | undefined) {
  const { fila, cargando } = useFila<PedidoDeposito>(DS.pedidos, id)
  const ops = useNoEnviados()
  const pedido = useMemo(() => (fila ? vistaPedido(fila, ops) : null), [fila, ops])
  return { pedido, cargando }
}

// ─── Artículos ───────────────────────────────────────────────────────────────

const indices = new WeakMap<object, Indice<Articulo>>()

/** Catálogo local + índice de búsqueda (se arma una vez por versión de la réplica). */
export function useArticulos() {
  const { filas, cargando, meta } = useDataset<Articulo>(DS.articulos)
  const indice = useMemo(() => {
    let ix = indices.get(filas)
    if (!ix) indices.set(filas, (ix = crearIndice(filas)))
    return ix
  }, [filas])
  return { articulos: filas, indice, cargando, meta }
}

/** Aplica el overlay solo a los artículos que tienen algo sin enviar (el catálogo es grande). */
export function useVistaArticulos() {
  const ops = useNoEnviados()
  const tocados = useMemo(() => articulosTocados(ops), [ops])
  return useCallback(
    (a: Articulo): ArticuloVista =>
      tocados.has(a.id) ? vistaArticulo(a, ops) : { ...a, stockSinEnviar: false, datosSinEnviar: false, descartado: false },
    [ops, tocados],
  )
}

// ─── Recepciones / devoluciones / catálogos ──────────────────────────────────

export function useRecepciones() {
  const { filas, cargando } = useDataset<OrdenRecepcion>(DS.recepciones)
  const ops = useNoEnviados()
  const { indice } = useArticulos()
  const ordenes = useMemo(
    () =>
      filas
        .map((o) => vistaRecepcion(o, ops, (id) => indice.porId.get(id)))
        .sort((a, b) => (a.orden.fecha_orden < b.orden.fecha_orden ? -1 : 1)),
    [filas, ops, indice],
  )
  return { ordenes, cargando }
}

export function useRecepcion(ordenId: string | undefined) {
  const { fila, cargando } = useFila<OrdenRecepcion>(DS.recepciones, ordenId)
  const ops = useNoEnviados()
  const { indice } = useArticulos()
  const recepcion = useMemo(() => (fila ? vistaRecepcion(fila, ops, (id) => indice.porId.get(id)) : null), [fila, ops, indice])
  return { recepcion, cargando }
}

export function useDevoluciones() {
  const { filas, cargando } = useDataset<Devolucion>(DS.devoluciones)
  const ops = useNoEnviados()
  return { devoluciones: useMemo(() => devolucionesVisibles(filas, ops), [filas, ops]), cargando }
}

export function useCatalogos() {
  const prov = useFila<CatProveedores>(DS.catalogos, "proveedores").fila
  const tipos = useFila<CatTipos>(DS.catalogos, "tipos").fila
  const transp = useFila<CatTransportes>(DS.catalogos, "transportes").fila
  return {
    proveedores: prov?.items ?? [],
    // Mismos valores por defecto que lib/catalogos/tipos-articulo.ts del ERP
    tiposBulto: tipos?.tiposBulto ?? ["UN", "BULTO", "CAJA", "PACK", "BLISTER", "SET", "KG", "LT", "MT"],
    tiposFraccion: tipos?.tiposFraccion ?? ["UN", "BULTO", "PACK", "BLISTER", "CAJA", "DOCENA", "SET", "DISPLAY"],
    transportes: transp?.items ?? [],
  }
}

export const rechazosDe = (ops: ItemOutbox[], prefijo: string) => ops.filter((o) => o.estado === "rechazado" && o.tipo.startsWith(prefijo))
