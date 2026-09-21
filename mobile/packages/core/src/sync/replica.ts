import type { FilaReplica, RespuestaSync, RespuestaParcial } from "@gm/contrato"
import type { Db, MetaDataset } from "../db/idb"
import { Emisor } from "../emitter"
import type { Api } from "../net/api"

/**
 * Réplica local de lectura, por dataset (ver MOBILE.md → "Réplica").
 *
 * Invariantes (cubiertos por test/replica.test.ts):
 *  R1. Un sync se aplica ATÓMICO: filas + cursor en la misma transacción. Si
 *      algo falla, la réplica queda exactamente como estaba (nunca a medias).
 *  R2. snapshot reemplaza el dataset entero; delta solo toca upserts/deletes.
 *  R3. El cursor solo avanza con datos aplicados (nunca se "saltea" un cambio).
 *  R4. Un error de sync NO borra datos: se registra en meta.error y la UI sigue
 *      mostrando la réplica con su frescura real.
 *  R5. Un solo sync en vuelo por dataset (llamadas concurrentes comparten promesa).
 *  R6. La frescura (generadoAt) es la hora del SERVIDOR que produjo los datos,
 *      no la del dispositivo: "precios al 18/09 14:30" es verdad aunque el reloj
 *      del handheld esté corrido.
 */
export class Replica {
  private emisores = new Map<string, Emisor>()
  private enVuelo = new Map<string, Promise<RespuestaSync>>()
  private metas = new Map<string, MetaDataset>()
  private cache = new Map<string, Record<string, unknown>[]>()

  constructor(private db: Db, private api: Api) {}

  private emisor(ds: string) {
    let e = this.emisores.get(ds)
    if (!e) this.emisores.set(ds, (e = new Emisor()))
    return e
  }

  suscribir(ds: string, fn: () => void) {
    return this.emisor(ds).suscribir(fn)
  }

  /** Meta en memoria (sincrónico, para la UI). Cargar antes con cargarMetas(). */
  metaSync(ds: string): MetaDataset | null {
    return this.metas.get(ds) ?? null
  }

  async cargarMetas(): Promise<void> {
    for (const m of await this.db.getAll("meta")) this.metas.set(m.dataset, m)
  }

  async meta(ds: string): Promise<MetaDataset | null> {
    const m = (await this.db.get("meta", ds)) ?? null
    if (m) this.metas.set(ds, m)
    return m
  }

  sincronizar(ds: string): Promise<RespuestaSync> {
    let p = this.enVuelo.get(ds)
    if (!p) {
      p = this.hacerSync(ds).finally(() => this.enVuelo.delete(ds))
      this.enVuelo.set(ds, p)
    }
    return p
  }

  sincronizando(ds: string) {
    return this.enVuelo.has(ds)
  }

  private async hacerSync(ds: string): Promise<RespuestaSync> {
    const previo = await this.meta(ds)
    let r: RespuestaSync
    try {
      const q = previo?.cursor ? `?cursor=${encodeURIComponent(previo.cursor)}` : ""
      r = await this.api.get<RespuestaSync>(`/api/mobile/sync/${encodeURIComponent(ds)}${q}`, { timeoutMs: 60_000 })
      if (!r || r.dataset !== ds || !Array.isArray(r.upserts) || !Array.isArray(r.deletes)) {
        throw new Error("Respuesta de sync inválida")
      }
    } catch (e: any) {
      await this.registrarError(ds, previo, e?.message || String(e))
      throw e
    }
    await this.aplicar(ds, r)
    return r
  }

  /** Aplica una respuesta de sync (público para tests y para datos embebidos). */
  async aplicar(ds: string, r: RespuestaSync): Promise<void> {
    const tx = this.db.transaction(["rows", "meta"], "readwrite")
    const rows = tx.objectStore("rows")
    try {
      if (r.modo === "snapshot" && !r.sin_cambios) {
        let cur = await rows.index("ds").openKeyCursor(IDBKeyRange.only(ds))
        while (cur) {
          await rows.delete(cur.primaryKey)
          cur = await cur.continue()
        }
      }
      for (const f of r.upserts as FilaReplica[]) {
        if (typeof f?.id !== "string" || !f.id) throw new Error(`Fila sin id en ${ds}`)
        await rows.put({ ds, id: f.id, data: f })
      }
      if (r.modo === "delta") for (const id of r.deletes) await rows.delete([ds, id])
      const count = await rows.index("ds").count(IDBKeyRange.only(ds))
      const meta: MetaDataset = {
        dataset: ds,
        cursor: r.cursor,
        generadoAt: r.generado_at,
        syncedAt: new Date().toISOString(),
        error: null,
        count,
      }
      await tx.objectStore("meta").put(meta)
      await tx.done
      this.metas.set(ds, meta)
    } catch (e) {
      try {
        tx.abort()
      } catch {
        /* ya abortada */
      }
      await tx.done.catch(() => {})
      throw e
    }
    if (!r.sin_cambios || r.modo === "delta") this.cache.delete(ds)
    this.emisor(ds).emitir()
  }

  /**
   * Parche local: filas ya actualizadas que devuelve el servidor al aplicar una
   * operación del outbox (resultado.replica). NO toca el cursor ni la frescura
   * (R3/R6 intactos: el próximo sync sigue desde donde estaba y re-trae lo mismo,
   * los upserts son idempotentes). Sirve para que la pantalla no "vuelva atrás"
   * entre que se envía la operación y llega el siguiente sync.
   */
  async parchear(ds: string, upserts: FilaReplica[], deletes: string[] = []): Promise<void> {
    if (!upserts.length && !deletes.length) return
    const tx = this.db.transaction(["rows", "meta"], "readwrite")
    const rows = tx.objectStore("rows")
    for (const f of upserts) {
      if (typeof f?.id === "string" && f.id) await rows.put({ ds, id: f.id, data: f })
    }
    for (const id of deletes) await rows.delete([ds, id])
    const meta = await tx.objectStore("meta").get(ds)
    if (meta) {
      const count = await rows.index("ds").count(IDBKeyRange.only(ds))
      await tx.objectStore("meta").put({ ...meta, count })
      this.metas.set(ds, { ...meta, count })
    }
    await tx.done
    this.cache.delete(ds)
    this.emisor(ds).emitir()
  }

  /**
   * Refresco PARCIAL: re-lee del servidor solo esas filas (GET …?ids=) y las vuelca
   * como parche (no mueve cursor ni frescura). Para datasets caros por fila: al abrir
   * la ficha de un cliente con señal se actualiza ese cliente y nada más. Sin red o
   * con error no hace nada: la pantalla sigue con lo que tenía (R4).
   */
  async refrescarIds(ds: string, ids: string[]): Promise<boolean> {
    if (!ids.length) return false
    try {
      const r = await this.api.get<RespuestaParcial>(`/api/mobile/sync/${encodeURIComponent(ds)}?ids=${ids.map(encodeURIComponent).join(",")}`, { timeoutMs: 30_000 })
      if (!r || r.dataset !== ds || !Array.isArray(r.upserts) || !Array.isArray(r.deletes)) return false
      await this.parchear(ds, r.upserts, r.deletes)
      return true
    } catch {
      return false
    }
  }

  private async registrarError(ds: string, previo: MetaDataset | null, error: string) {
    const meta: MetaDataset = previo
      ? { ...previo, error }
      : { dataset: ds, cursor: null, generadoAt: null, syncedAt: null, error, count: 0 }
    await this.db.put("meta", meta).catch(() => {})
    this.metas.set(ds, meta)
    this.emisor(ds).emitir()
  }

  async todas<T = Record<string, unknown>>(ds: string): Promise<T[]> {
    const c = this.cache.get(ds)
    if (c) return c as T[]
    const filas = await this.db.getAllFromIndex("rows", "ds", IDBKeyRange.only(ds))
    const data = filas.map((f) => f.data)
    this.cache.set(ds, data)
    return data as T[]
  }

  async una<T = Record<string, unknown>>(ds: string, id: string): Promise<T | null> {
    const f = await this.db.get("rows", [ds, id])
    return (f?.data as T) ?? null
  }

  /** Borra un dataset local (logout / cambio de usuario). */
  async limpiar(ds: string) {
    await this.aplicar(ds, {
      dataset: ds, modo: "snapshot", cursor: "", generado_at: new Date(0).toISOString(), sin_cambios: false, upserts: [], deletes: [],
    })
    await this.db.delete("meta", ds)
    this.metas.delete(ds)
    this.emisor(ds).emitir()
  }
}
