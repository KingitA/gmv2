import { useCallback, useEffect, useMemo } from "react"
import { useDataset, useFila, useMetaDataset, useNoEnviados, useOnline, useRuntime, useSesion, uuidv4, type ItemOutbox } from "@gm/core"
import { DS, idClienteViaje, type Articulo, type BilleteraData, type ChoferMe, type ClienteBusqueda, type ClienteViajeRow, type CuentaBancaria, type ViajeDetalle } from "../datasets"
import { billeteraVisible, clienteDesdeParada, clienteVisible, estadoDescarga, viajeVisible, type ClienteVista, type ViajeVista } from "./overlay"

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

/** Refresco PARCIAL: con señal, re-lee solo esas filas (p. ej. el viaje o la ficha que se abre). */
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
    () => ({ id: sesion?.user.id ?? "", nombre: sesion?.user.nombre || sesion?.user.email?.split("@")[0] || "Chofer", email: sesion?.user.email ?? null }),
    [sesion?.user.id, sesion?.user.nombre, sesion?.user.email],
  )
}

export const rechazosDe = (ops: ItemOutbox[], prefijo: string, viajeId?: string) =>
  ops.filter((o) => o.estado === "rechazado" && o.tipo.startsWith(prefijo) && (!viajeId || (o.payload as { viaje_id?: string } | null)?.viaje_id === viajeId))

// ─── Identidad y viajes ──────────────────────────────────────────────────────

export function useMe() {
  return useFila<ChoferMe>(DS.me, "me")
}

export function useViaje(id: string | undefined): { viaje: ViajeVista | null; cargando: boolean } {
  const { fila, cargando } = useFila<ViajeDetalle>(DS.viajes, id)
  const ops = useNoEnviados()
  return { viaje: useMemo(() => (fila ? viajeVisible(fila, ops) : null), [fila, ops]), cargando }
}

/** Fichas de los clientes de un viaje que YA están en el equipo. */
export function useClientesDelViaje(viajeId: string | undefined) {
  const { filas, cargando } = useDataset<ClienteViajeRow>(DS.clientesViaje)
  return { filas: useMemo(() => filas.filter((f) => f.viaje_id === viajeId), [filas, viajeId]), cargando }
}

/**
 * Ficha del cliente en el viaje (réplica + cobros/devoluciones sin enviar). Si la ficha
 * completa todavía no se descargó, se arma una PARCIAL con lo que trae la hoja de ruta
 * (nombre, dirección, saldo, cobrado): se puede ver y cobrar a cuenta, no imputar.
 */
export function useClienteViaje(viajeId: string | undefined, clienteId: string | undefined): { cliente: ClienteVista | null; cargando: boolean; descargada: boolean } {
  const id = viajeId && clienteId ? idClienteViaje(viajeId, clienteId) : undefined
  const { fila, cargando } = useFila<ClienteViajeRow>(DS.clientesViaje, id)
  const { viaje } = useViaje(viajeId)
  const ops = useNoEnviados()
  const cliente = useMemo(() => {
    if (fila) return clienteVisible(fila, ops)
    const parada = viaje?.paradas.find((p) => p.cliente_id === clienteId)
    if (!viaje || !parada || !viajeId) return null
    // La parada ya lleva los cobros/devoluciones sin enviar (overlay del viaje): no volver a sumarlos
    return { ...clienteDesdeParada(viajeId, parada, viaje.viaje.estado), parcial: true }
  }, [fila, ops, viaje, viajeId, clienteId])
  return { cliente, cargando, descargada: !!fila }
}

/** Estado de descarga del viaje: ¿están en el equipo las fichas de TODAS las paradas? */
export function useDescargaViaje(viajeId: string | undefined) {
  const { fila } = useFila<ViajeDetalle>(DS.viajes, viajeId)
  const { filas } = useClientesDelViaje(viajeId)
  const meta = useMetaDataset(DS.clientesViaje)
  const { replica, sync } = useRuntime()
  const online = useOnline()
  const estado = useMemo(() => estadoDescarga(fila, new Set(filas.map((f) => f.id))), [fila, filas])
  // Con señal, traer lo que falte de a 25 (refresco parcial: no toca el resto del dataset)
  const faltanIds = useMemo(() => (fila ? fila.paradas.map((p) => idClienteViaje(fila.id, p.cliente_id)).filter((id) => !filas.some((f) => f.id === id)) : []), [fila, filas])
  const clave = faltanIds.join(",")
  useEffect(() => {
    if (!online || !clave) return
    const ids = clave.split(",")
    let vivo = true
    void (async () => {
      for (let i = 0; i < ids.length && vivo; i += 25) await replica.refrescarIds(DS.clientesViaje, ids.slice(i, i + 25))
    })()
    return () => {
      vivo = false
    }
  }, [online, clave, replica])
  const descargarTodo = useCallback(async () => {
    await sync.dataset(DS.viajes)
    await sync.dataset(DS.clientesViaje)
  }, [sync])
  return { ...estado, generadoAt: meta?.generadoAt ?? null, descargarTodo }
}

// ─── Billetera ───────────────────────────────────────────────────────────────

export function useBilletera(): { billetera: BilleteraData | null; cargando: boolean } {
  const { fila, cargando } = useFila<BilleteraData>(DS.billetera, "billetera")
  const ops = useNoEnviados()
  return { billetera: useMemo(() => (fila ? billeteraVisible(fila, ops) : null), [fila, ops]), cargando }
}

// ─── Catálogos ───────────────────────────────────────────────────────────────

export function useCuentasBancarias(): CuentaBancaria[] {
  const { fila } = useFila<{ id: string; cuentas: CuentaBancaria[] }>(DS.catalogos, "cuentas")
  return fila?.cuentas ?? VACIO
}
const VACIO: never[] = []

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const palabras = (q: string) => sinAcentos(q).split(/\s+/).filter(Boolean)

/** Búsqueda local: todas las palabras, sin acentos, en cualquier orden. */
export function buscarClientes(clientes: ClienteBusqueda[], q: string, tope = 8): ClienteBusqueda[] {
  const ps = palabras(q)
  if (!ps.length) return []
  const out: ClienteBusqueda[] = []
  for (const c of clientes) {
    const texto = sinAcentos([c.nombre, c.razon_social, c.nombre_razon_social, c.cuit, c.codigo_cliente, c.localidad].filter(Boolean).join(" "))
    if (ps.every((p) => texto.includes(p))) {
      out.push(c)
      if (out.length >= tope) break
    }
  }
  return out
}

export function buscarArticulos(articulos: Articulo[], q: string, tope = 8): Articulo[] {
  const ps = palabras(q)
  if (!ps.length) return []
  const codigo = q.trim()
  const out: Articulo[] = []
  // Código exacto primero (sku / EAN)
  for (const a of articulos) {
    const eans = Array.isArray(a.ean13) ? a.ean13 : a.ean13 ? [a.ean13] : []
    if (a.sku === codigo || eans.includes(codigo)) out.push(a)
  }
  for (const a of articulos) {
    if (out.includes(a)) continue
    const texto = sinAcentos([a.descripcion, a.sku, a.marca, a.proveedor].filter(Boolean).join(" "))
    if (ps.every((p) => texto.includes(p))) {
      out.push(a)
      if (out.length >= tope) break
    }
  }
  return out.slice(0, tope)
}

export function useClientesTodos() {
  return useDataset<ClienteBusqueda>(DS.clientes)
}
export function useArticulos() {
  return useDataset<Articulo>(DS.articulos)
}
