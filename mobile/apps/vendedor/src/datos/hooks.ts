import { useCallback, useEffect, useMemo } from "react"
import { useDataset, useFila, useNoEnviados, useOnline, useRuntime, useSesion, uuidv4, type ItemOutbox } from "@gm/core"
import {
  DS, type Articulo, type CatalogoRubro, type CatalogosFicha, type Cliente, type CuentaCliente, type ListaPrecio, type PedidoVendedor,
  type ProveedorCatalogo, type ViajeVendedor, type ZonaViaje,
} from "../datasets"
import { crearIndice, type IndiceCatalogo } from "./busqueda"
import { clientesVisibles, cuentaVacia, cuentaVisible, pedidosVisibles, viajesVisibles, type PedidoVista } from "./overlay"

export { uuidv4 }

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
    if (online) void sync.dataset(dataset).catch(() => {})
  }, [sync, dataset, online])
}

/** Refresco PARCIAL: con señal, re-lee solo esas filas (p. ej. la cuenta del cliente que se abre). */
export function useRefrescarFilas(dataset: string, ids: Array<string | undefined>) {
  const { replica } = useRuntime()
  const online = useOnline()
  const clave = ids.filter(Boolean).join(",")
  useEffect(() => {
    if (online && clave) void replica.refrescarIds(dataset, clave.split(","))
  }, [replica, dataset, online, clave])
}

export function useYo() {
  const { sesion } = useSesion()
  return useMemo(
    () => ({ id: sesion?.user.id ?? "", nombre: sesion?.user.nombre || sesion?.user.email?.split("@")[0] || "Vendedor", email: sesion?.user.email ?? null }),
    [sesion?.user.id, sesion?.user.nombre, sesion?.user.email],
  )
}

export const rechazosDe = (ops: ItemOutbox[], prefijo: string) => ops.filter((o) => o.estado === "rechazado" && o.tipo.startsWith(prefijo))

// ─── Catálogo ────────────────────────────────────────────────────────────────

const indices = new WeakMap<object, IndiceCatalogo>()

/** Catálogo local + índice de búsqueda (se arma una vez por versión de la réplica). */
export function useCatalogo() {
  const { filas, cargando, meta } = useDataset<Articulo>(DS.articulos)
  const indice = useMemo(() => {
    let ix = indices.get(filas)
    if (!ix) indices.set(filas, (ix = crearIndice(filas)))
    return ix
  }, [filas])
  return { indice, cargando, meta, vacio: !cargando && filas.length === 0 }
}

function useFilaCatalogo<T>(id: string): T | null {
  return useFila<T & { id: string }>(DS.catalogos, id).fila
}

export function useTaxonomia(): CatalogoRubro[] {
  return useFilaCatalogo<{ rubros: CatalogoRubro[] }>("catalogo")?.rubros ?? VACIO
}
export function useProveedores(): ProveedorCatalogo[] {
  return useFilaCatalogo<{ proveedores: ProveedorCatalogo[] }>("proveedores")?.proveedores ?? VACIO
}
export function useVentas(): Record<string, number> {
  return useFilaCatalogo<{ ventas: Record<string, number> }>("ventas")?.ventas ?? SIN_VENTAS
}
export function useListasPermitidas(): { listas: ListaPrecio[]; metodos: Array<{ key: string; label: string }> } {
  const f = useFilaCatalogo<{ listas: ListaPrecio[]; metodos: Array<{ key: string; label: string }> }>("precios_listas")
  return useMemo(() => ({ listas: f?.listas ?? [], metodos: f?.metodos ?? METODOS }), [f])
}
export function useCatalogosFicha(): CatalogosFicha | null {
  return useFilaCatalogo<CatalogosFicha>("ficha")
}
export function useCuentasBancarias(): Array<{ id: string; banco: string; nombre: string; alias: string | null }> {
  return useFilaCatalogo<{ cuentas: Array<{ id: string; banco: string; nombre: string; alias: string | null }> }>("cuentas")?.cuentas ?? VACIO
}
export function useZonas(): ZonaViaje[] {
  return useFilaCatalogo<{ zonas: ZonaViaje[] }>("zonas")?.zonas ?? VACIO
}
const VACIO: never[] = []
const SIN_VENTAS: Record<string, number> = {}
const METODOS = [{ key: "Factura", label: "c/IVA" }, { key: "Final", label: "Final" }, { key: "Presupuesto", label: "Presup." }]

// ─── Clientes ────────────────────────────────────────────────────────────────

export function useClientes() {
  const { filas, cargando, meta } = useDataset<Cliente>(DS.clientes)
  const ops = useNoEnviados()
  const clientes = useMemo(() => clientesVisibles(filas, ops), [filas, ops])
  return { clientes, cargando, meta }
}

export function useCliente(id: string | undefined) {
  const { clientes, cargando } = useClientes()
  return { cliente: useMemo(() => clientes.find((c) => c.id === id) ?? null, [clientes, id]), cargando }
}

/** Cuenta corriente del cliente (réplica + cobros/devoluciones sin enviar). Con señal se re-lee SOLO ese cliente. */
export function useCuenta(id: string | undefined) {
  const { fila, cargando } = useFila<CuentaCliente>(DS.cc, id)
  const { cliente } = useCliente(id)
  const ops = useNoEnviados()
  useRefrescarFilas(DS.cc, [cliente?.sinEnviar ? undefined : id])
  const cuenta = useMemo(() => {
    const base = fila ?? (cliente ? cuentaVacia(cliente) : null)
    if (!base) return null
    // La ficha (datos editables, saldos) manda desde la cartera: es la que tiene el overlay de ediciones
    const conFicha = cliente ? { ...base, cliente: { ...base.cliente, ...cliente, saldo_actual: base.cliente.saldo_actual ?? cliente.saldo_actual, saldo_proyectado: base.cliente.saldo_proyectado ?? cliente.saldo_proyectado } } : base
    return cuentaVisible(conFicha, ops)
  }, [fila, cliente, ops])
  return { cuenta, cargando, descargada: !!fila }
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

export function usePedidos(): { pedidos: PedidoVista[]; cargando: boolean } {
  const { filas, cargando } = useDataset<PedidoVendedor>(DS.pedidos)
  const ops = useNoEnviados()
  return { pedidos: useMemo(() => pedidosVisibles(filas, ops), [filas, ops]), cargando }
}

export function usePedido(id: string | undefined) {
  const { pedidos, cargando } = usePedidos()
  return { pedido: useMemo(() => pedidos.find((p) => p.id === id) ?? null, [pedidos, id]), cargando }
}

// ─── Viajes ──────────────────────────────────────────────────────────────────

export function useViajes() {
  const { filas, cargando } = useDataset<ViajeVendedor>(DS.viajes)
  const ops = useNoEnviados()
  return { viajes: useMemo(() => viajesVisibles(filas, ops), [filas, ops]), cargando }
}

// ─── Filas sueltas de billetera / inicio ─────────────────────────────────────

export function useFilaBilletera<T>(id: string | undefined) {
  return useFila<T & { id: string }>(DS.billetera, id)
}
export function useMe<T>() {
  return useFila<T & { id: string }>(DS.me, "me")
}
