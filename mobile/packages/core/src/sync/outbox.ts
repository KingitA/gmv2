import type { AppMovil, MutacionOutbox, ResultadoOutbox } from "@gm/contrato"
import type { Db, ItemOutbox } from "../db/idb"
import { Emisor, uuidv4 } from "../emitter"
import type { Api } from "../net/api"
import { ErrorHttp, ErrorSesion } from "../net/errores"

export interface ContextoOutbox {
  app: AppMovil
  deviceId: string
  appVersion: string
  /** Usuario de la sesión actual (null = sin sesión: no se envía nada) */
  usuarioActual: () => string | null
  /** Enviar apenas se encola (default true; los tests lo apagan para controlar el orden) */
  autoEnviar?: boolean
}

export interface ContadoresOutbox {
  pendientes: number
  rechazados: number
  enviando: boolean
}

/** Retención de enviados para el historial visible */
const RETENCION_ENVIADOS_MS = 7 * 24 * 3600_000

export function backoffMs(intentos: number, azar = Math.random()): number {
  const base = Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, intentos - 1))
  return Math.round(base * (0.75 + azar * 0.5))
}

/**
 * Outbox de escrituras (ver MOBILE.md → "Outbox").
 *
 * Invariantes (test/outbox.test.ts):
 *  O1. encolar() persiste en IndexedDB ANTES de devolver: si la app muere
 *      después, la operación sigue ahí. Nunca se pierde una escritura aceptada.
 *  O2. La idempotency_key se genera una vez al encolar y NUNCA cambia: todos
 *      los reintentos mandan la misma ⇒ el servidor la aplica una sola vez.
 *  O3. Envío FIFO estricto por seq. Si el primero falla por error transitorio,
 *      los siguientes esperan (preserva causalidad: cliente nuevo → su pedido).
 *  O4. Un rechazo definitivo (422 / conflicto de clave) se marca "rechazado" y
 *      no se reintenta nunca; no bloquea a los siguientes. El usuario lo ve y lo
 *      descarta (o corrige y genera una operación NUEVA, con clave nueva).
 *  O5. Un solo envío en vuelo (single-flight).
 *  O6. Tras un crash, los "enviando" vuelven a "pendiente" (misma clave ⇒ si el
 *      servidor ya la había aplicado, responde "duplicado" y queda enviado).
 *  O7. Error de sesión (401 sin poder renovar) detiene el envío sin tocar los items.
 *  O8. Cada item guarda el usuario que lo capturó y solo se envía con ESA sesión.
 */
export class Outbox {
  private emisor = new Emisor()
  private enVuelo: Promise<void> | null = null
  private _contadores: ContadoresOutbox = { pendientes: 0, rechazados: 0, enviando: false }
  private alAplicar = new Set<(item: ItemOutbox) => void>()

  constructor(
    private db: Db,
    private api: Api,
    private ctx: ContextoOutbox,
    private ahora: () => number = Date.now,
  ) {}

  suscribir = (fn: () => void) => this.emisor.suscribir(fn)
  get contadores() {
    return this._contadores
  }

  /** Se llama con cada item aplicado en el servidor (p. ej. para re-sincronizar un dataset). */
  onAplicado(fn: (item: ItemOutbox) => void) {
    this.alAplicar.add(fn)
    return () => void this.alAplicar.delete(fn)
  }

  /** Recuperación de arranque (O6) + limpieza de enviados viejos. */
  async iniciar(): Promise<void> {
    const tx = this.db.transaction("outbox", "readwrite")
    let cur = await tx.store.openCursor()
    while (cur) {
      const it = cur.value
      if (it.estado === "enviando") await cur.update({ ...it, estado: "pendiente" })
      else if (it.estado === "enviado" && it.enviadoAt && this.ahora() - Date.parse(it.enviadoAt) > RETENCION_ENVIADOS_MS) await cur.delete()
      cur = await cur.continue()
    }
    await tx.done
    await this.recontar()
  }

  async encolar<P>(args: { tipo: string; payload: P; etiqueta?: string }): Promise<ItemOutbox> {
    const usuarioId = this.ctx.usuarioActual()
    if (!usuarioId) throw new Error("No hay sesión: no se puede registrar la operación")
    const tx = this.db.transaction("outbox", "readwrite")
    const ultimo = await tx.store.index("seq").openCursor(null, "prev")
    const item: ItemOutbox = {
      key: uuidv4(),
      seq: (ultimo?.value.seq ?? 0) + 1,
      tipo: args.tipo,
      payload: args.payload,
      capturadoAt: new Date(this.ahora()).toISOString(),
      estado: "pendiente",
      intentos: 0,
      proximoIntentoAt: 0,
      error: null,
      resultado: null,
      enviadoAt: null,
      etiqueta: args.etiqueta ?? null,
      usuarioId,
    }
    await tx.store.add(item)
    await tx.done // O1: recién acá está durable
    await this.recontar()
    if (this.ctx.autoEnviar !== false) void this.enviar().catch(() => {})
    return item
  }

  async lista(): Promise<ItemOutbox[]> {
    return this.db.getAllFromIndex("outbox", "seq")
  }

  async item(key: string) {
    return (await this.db.get("outbox", key)) ?? null
  }

  /** Descarta un rechazado (el usuario ya lo vio). Pendientes no se pueden descartar. */
  async descartar(key: string): Promise<void> {
    const it = await this.db.get("outbox", key)
    if (it?.estado === "rechazado") await this.db.delete("outbox", key)
    await this.recontar()
  }

  /** Envía todo lo pendiente en orden. Seguro de llamar muchas veces (O5). */
  enviar(): Promise<void> {
    if (!this.enVuelo) {
      this._contadores = { ...this._contadores, enviando: true }
      this.emisor.emitir()
      this.enVuelo = this.bucle().finally(async () => {
        this.enVuelo = null
        await this.recontar()
      })
    }
    return this.enVuelo
  }

  private async bucle(): Promise<void> {
    for (;;) {
      const usuario = this.ctx.usuarioActual()
      if (!usuario) return // O7: sin sesión no se envía
      // O8: solo las operaciones del usuario logueado (otro usuario en el mismo
      // equipo nunca envía lo que capturó el anterior)
      const siguiente = (await this.lista()).find((i) => i.estado === "pendiente" && i.usuarioId === usuario)
      if (!siguiente) return
      if (siguiente.proximoIntentoAt > this.ahora()) return // O3: espera su backoff
      const seguir = await this.enviarUno(siguiente)
      if (!seguir) return
    }
  }

  /** true = seguir con el próximo; false = cortar el bucle (transitorio) */
  private async enviarUno(it: ItemOutbox): Promise<boolean> {
    await this.db.put("outbox", { ...it, estado: "enviando" })
    const m: MutacionOutbox = {
      idempotency_key: it.key, // O2
      tipo: it.tipo,
      payload: it.payload,
      capturado_at: it.capturadoAt,
      device_id: this.ctx.deviceId,
      app: this.ctx.app,
      app_version: this.ctx.appVersion,
    }
    try {
      const r = await this.api.post<ResultadoOutbox>("/api/mobile/outbox", m, { timeoutMs: 45_000 })
      const final: ItemOutbox = {
        ...it,
        estado: "enviado",
        intentos: it.intentos + 1,
        error: null,
        resultado: r && "resultado" in r ? r.resultado : null,
        enviadoAt: new Date(this.ahora()).toISOString(),
      }
      await this.db.put("outbox", final)
      for (const fn of this.alAplicar) {
        try {
          fn(final)
        } catch (e) {
          console.error(e)
        }
      }
      return true
    } catch (e: any) {
      const definitivo = e instanceof ErrorHttp && !e.reintentable && e.status !== 401
      if (definitivo) {
        await this.db.put("outbox", { ...it, estado: "rechazado", intentos: it.intentos + 1, error: e.message })
        return true // O4
      }
      const intentos = it.intentos + 1
      await this.db.put("outbox", {
        ...it,
        estado: "pendiente",
        intentos,
        error: e instanceof ErrorSesion ? "Sesión vencida: se enviará al volver a ingresar" : e?.message || String(e),
        proximoIntentoAt: e instanceof ErrorSesion ? 0 : this.ahora() + backoffMs(intentos),
      })
      return false // O3 / O7
    }
  }

  /** ms hasta el próximo reintento programado (para el scheduler), o null */
  async proximoReintentoEn(): Promise<number | null> {
    const p = (await this.lista()).find((i) => i.estado === "pendiente")
    if (!p) return null
    return Math.max(0, p.proximoIntentoAt - this.ahora())
  }

  private async recontar() {
    let pendientes = 0
    let rechazados = 0
    for (const i of await this.lista()) {
      if (i.estado === "pendiente" || i.estado === "enviando") pendientes++
      else if (i.estado === "rechazado") rechazados++
    }
    this._contadores = { pendientes, rechazados, enviando: !!this.enVuelo }
    this.emisor.emitir()
  }
}
