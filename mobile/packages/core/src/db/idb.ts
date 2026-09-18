// Base local del dispositivo (IndexedDB vía `idb`). Una base por app.
//
// Por qué IndexedDB y no SQLite (decisión documentada en MOBILE.md):
// - Sin plugin nativo: el mismo código corre en el WebView, en el navegador
//   (npm run dev) y en los tests (fake-indexeddb). Menos superficie que mantener.
// - Volumen chico: miles de artículos/clientes (pocos MB). IndexedDB en Chromium
//   (WebView 127 del NuStar) va sobrado para lecturas por clave/índice.
// - Transacciones atómicas: un sync se aplica entero o no se aplica.
// - En una app Capacitor el storage vive en el directorio de datos de la app:
//   no lo purga el navegador; se pide igual navigator.storage.persist().

import { openDB, type DBSchema, type IDBPDatabase } from "idb"

export interface MetaDataset {
  dataset: string
  cursor: string | null
  /** Hora del SERVIDOR en que se generaron los datos (base del indicador de frescura) */
  generadoAt: string | null
  /** Hora del dispositivo del último sync exitoso */
  syncedAt: string | null
  /** Último error de sync (se limpia en el próximo éxito) */
  error: string | null
  count: number
}

export interface FilaGuardada {
  ds: string
  id: string
  data: Record<string, unknown>
}

export type EstadoOutbox = "pendiente" | "enviando" | "enviado" | "rechazado"

export interface ItemOutbox {
  /** idempotency_key (UUID v4 del dispositivo). Nunca cambia entre reintentos. */
  key: string
  /** Orden de encolado (FIFO estricto) */
  seq: number
  tipo: string
  payload: unknown
  capturadoAt: string
  estado: EstadoOutbox
  intentos: number
  /** epoch ms; no se reintenta antes */
  proximoIntentoAt: number
  error: string | null
  resultado: unknown
  enviadoAt: string | null
  /** Usuario que la capturó: solo se envía con la sesión de ese usuario */
  usuarioId: string | null
  /** Texto para la UI ("Pedido Almacén Don José") */
  etiqueta: string | null
}

interface GmDb extends DBSchema {
  meta: { key: string; value: MetaDataset }
  rows: { key: [string, string]; value: FilaGuardada; indexes: { ds: string } }
  outbox: { key: string; value: ItemOutbox; indexes: { seq: number; estado: EstadoOutbox } }
  kv: { key: string; value: unknown }
}

export type Db = IDBPDatabase<GmDb>

export const DB_VERSION = 1

export async function abrirDb(nombre: string): Promise<Db> {
  const db = await openDB<GmDb>(nombre, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("meta", { keyPath: "dataset" })
        const rows = db.createObjectStore("rows", { keyPath: ["ds", "id"] })
        rows.createIndex("ds", "ds")
        const ob = db.createObjectStore("outbox", { keyPath: "key" })
        ob.createIndex("seq", "seq", { unique: true })
        ob.createIndex("estado", "estado")
        db.createObjectStore("kv")
      }
      // Migraciones futuras: `if (oldVersion < 2) { ... }` — nunca borrar el outbox.
    },
    blocking() {
      // Otra pestaña (dev) abrió una versión nueva: cerrar para no bloquearla.
      db.close()
    },
  })
  try {
    await (globalThis.navigator as any)?.storage?.persist?.()
  } catch {
    /* no soportado */
  }
  return db
}

export async function kvGet<T>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get("kv", key)) as T | undefined
}

export async function kvSet(db: Db, key: string, value: unknown): Promise<void> {
  await db.put("kv", value, key)
}
