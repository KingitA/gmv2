import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import type { MetaDataset, ItemOutbox } from "../db/idb"
import type { Runtime } from "../runtime"

const Ctx = createContext<Runtime | null>(null)

export function GmProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  return <Ctx.Provider value={runtime}>{children}</Ctx.Provider>
}

export function useRuntime(): Runtime {
  const r = useContext(Ctx)
  if (!r) throw new Error("useRuntime fuera de <GmProvider>")
  return r
}

export function useSesion() {
  const { auth } = useRuntime()
  const estado = useSyncExternalStore(auth.suscribir, () => auth.estado)
  const sesion = useSyncExternalStore(auth.suscribir, () => auth.sesion)
  return { estado, sesion }
}

export function useOnline() {
  const { red } = useRuntime()
  return useSyncExternalStore(red.suscribir, () => red.online)
}

export function useContadoresOutbox() {
  const { outbox } = useRuntime()
  return useSyncExternalStore(outbox.suscribir, () => outbox.contadores)
}

export function useItemsOutbox(): ItemOutbox[] {
  const { outbox } = useRuntime()
  const version = useSyncExternalStore(outbox.suscribir, () => outbox.contadores)
  const [items, setItems] = useState<ItemOutbox[]>([])
  useEffect(() => {
    let vivo = true
    void outbox.lista().then((l) => vivo && setItems(l))
    return () => {
      vivo = false
    }
  }, [outbox, version])
  return items
}

/**
 * Operaciones NO enviadas (pendiente / enviando / rechazado), en orden. Es la base
 * del "overlay" optimista: la pantalla muestra la réplica + estas operaciones
 * encima, así lo que el operario marcó sin señal se ve al instante y sobrevive a
 * cerrar la app (sale del outbox, que es durable).
 */
export function useNoEnviados(): ItemOutbox[] {
  const { outbox } = useRuntime()
  return useSyncExternalStore(outbox.suscribir, () => outbox.noEnviadosSync)
}

export function useMetaDataset(ds: string): MetaDataset | null {
  const { replica } = useRuntime()
  const sub = useCallback((fn: () => void) => replica.suscribir(ds, fn), [replica, ds])
  return useSyncExternalStore(sub, () => replica.metaSync(ds))
}

export interface EstadoDataset<T> {
  filas: T[]
  /** true hasta la primera lectura local (milisegundos; no depende de la red) */
  cargando: boolean
  meta: MetaDataset | null
  sincronizando: boolean
  refrescar: () => Promise<void>
}

/** Filas de un dataset desde la réplica local; se actualiza solo al sincronizar. */
export function useDataset<T = Record<string, unknown>>(ds: string): EstadoDataset<T> {
  const { replica, sync } = useRuntime()
  const meta = useMetaDataset(ds)
  const [filas, setFilas] = useState<T[]>([])
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSinc] = useState(false)

  useEffect(() => {
    let vivo = true
    const leer = () =>
      void replica.todas<T>(ds).then((f) => {
        if (!vivo) return
        setFilas(f)
        setCargando(false)
      })
    leer()
    const baja = replica.suscribir(ds, leer)
    return () => {
      vivo = false
      baja()
    }
  }, [replica, ds])

  const refrescar = useCallback(async () => {
    setSinc(true)
    try {
      await sync.dataset(ds)
    } finally {
      setSinc(false)
    }
  }, [sync, ds])

  return { filas, cargando, meta, sincronizando, refrescar }
}

/** Una fila por id (detalle). */
export function useFila<T = Record<string, unknown>>(ds: string, id: string | undefined): { fila: T | null; cargando: boolean } {
  const { replica } = useRuntime()
  const [fila, setFila] = useState<T | null>(null)
  const [cargando, setCargando] = useState(true)
  useEffect(() => {
    if (!id) return
    let vivo = true
    const leer = () =>
      void replica.una<T>(ds, id).then((f) => {
        if (!vivo) return
        setFila(f)
        setCargando(false)
      })
    leer()
    const baja = replica.suscribir(ds, leer)
    return () => {
      vivo = false
      baja()
    }
  }, [replica, ds, id])
  return { fila, cargando }
}
