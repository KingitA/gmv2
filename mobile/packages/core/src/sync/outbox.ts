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
  /**
   * Token de OTRO usuario del mismo equipo cuya sesión quedó aparcada (cambio de
   * turno con pendientes, ver Auth.aparcar). null ⇒ sus operaciones esperan a que
   * vuelva a ingresar. Sin esta función, solo se envía lo del usuario logueado.
   */
  tokenDe?: (usuarioId: string, forzar?: boolean) => Promise<string | null>
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
 *  O8. Cada item guarda el usuario que lo capturó y solo se envía con la sesión
 *      de ESE usuario: la activa, o la suya aparcada (ctx.tokenDe). El FIFO es
 *      por usuario: lo trabado de uno no frena lo de otro.
 *  O9. Los callbacks onAplicado (parche de réplica) corren ANTES de marcar el
 *      item "enviado": la UI nunca ve el item enviado sin su efecto en la réplica.
 */
export class Outbox {
  private emisor = new Emisor()
  private enVuelo: Promise<void> | null = null
  private _contadores: ContadoresOutbox = { pendientes: 0, rechazados: 0, enviando: false }
  private _noEnviados: ItemOutbox[] = []
  private alAplicar = new Set<(item: ItemOutbox) => void | Promise<void>>()

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
  /** Copia en memoria de noEnviados() (se refresca en cada cambio): lectura sincrónica para la UI. */
  get noEnviadosSync(): ItemOutbox[] {
    return this._noEnviados
  }

  /** Se llama con cada item aplicado en el servidor (p. ej. para re-sincronizar un dataset). */
  onAplicado(fn: (item: ItemOutbox) => void | Promise<void>) {
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

  /** Todo lo que NO está enviado (pendiente, enviando, rechazado), en orden. Barato: va por índice. */
  async noEnviados(): Promise<ItemOutbox[]> {
    const tx = this.db.transaction("outbox", "readonly")
    const idx = tx.store.index("estado")
    const [a, b, c] = await Promise.all([idx.getAll("pendiente"), idx.getAll("enviando"), idx.getAll("rechazado")])
    await tx.done
    return [...a, ...b, ...c].sort((x, y) => x.seq - y.seq)
  }

  /** Usuarios con operaciones sin enviar (para saber qué sesiones aparcadas siguen haciendo falta). */
  async usuariosConPendientes(): Promise<Set<string>> {
    const out = new Set<string>()
    for (const i of await this.noEnviados()) if (i.estado !== "rechazado" && i.usuarioId) out.add(i.usuarioId)
    return out
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

  /**
   * Envía todo lo pendiente en orden. Seguro de llamar muchas veces (O5).
   * `forzar`: ignora el backoff en esta pasada. Lo usa el sincronizador cuando
   * SABE que el servidor responde (volvió la red, la app volvió a primer plano, el
   * sondeo contestó): tras 10 minutos sin señal en un pasillo el backoff llega a
   * 5 min, y el operario no tiene por qué esperarlo al recuperar el WiFi.
   */
  enviar(opts: { forzar?: boolean } = {}): Promise<void> {
    if (!this.enVuelo) {
      this._contadores = { ...this._contadores, enviando: true }
      this.emisor.emitir()
      this.enVuelo = this.bucle(!!opts.forzar).finally(async () => {
        this.enVuelo = null
        await this.recontar()
      })
    }
    return this.enVuelo
  }

  private async bucle(forzar = false): Promise<void> {
    // FIFO por usuario (O3 + O8): el primer pendiente de cada usuario frena a los
    // siguientes DE ESE usuario, no a los de otro.
    const frenados = new Set<string>()
    for (;;) {
      const usuario = this.ctx.usuarioActual()
      if (!usuario) return // O7: sin sesión no se envía
      const siguiente = (await this.noEnviados()).find((i) => i.estado === "pendiente" && !frenados.has(i.usuarioId ?? ""))
      if (!siguiente) return
      const duenio = siguiente.usuarioId ?? ""
      if (!forzar && siguiente.proximoIntentoAt > this.ahora()) {
        frenados.add(duenio) // O3: espera su backoff
        continue
      }
      let token: string | null | undefined
      if (duenio !== usuario) {
        // O8: lo capturó otro usuario ⇒ solo con SU sesión aparcada
        token = this.ctx.tokenDe ? await this.ctx.tokenDe(duenio).catch(() => null) : null
        if (!token) {
          frenados.add(duenio)
          continue
        }
      }
      const seguir = await this.enviarUno(siguiente, token ?? undefined)
      if (!seguir) frenados.add(duenio)
      await this.recontar() // la UI ve bajar el contador operación por operación
    }
  }

  /** true = seguir con el próximo; false = cortar el bucle (transitorio) */
  private async enviarUno(it: ItemOutbox, tokenAparcado?: string): Promise<boolean> {
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
      const post = (token?: string) =>
        this.api.post<ResultadoOutbox>("/api/mobile/outbox", m, {
          timeoutMs: 45_000,
          ...(token ? { auth: false, headers: { Authorization: `Bearer ${token}` } } : {}),
        })
      let r: ResultadoOutbox
      try {
        r = await post(tokenAparcado)
      } catch (e) {
        // Sesión aparcada con el token vencido: renovar una vez y reintentar
        if (!(tokenAparcado && e instanceof ErrorHttp && e.status === 401 && this.ctx.tokenDe && it.usuarioId)) throw e
        const nuevo = await this.ctx.tokenDe(it.usuarioId, true)
        if (!nuevo) throw new ErrorSesion("Se enviará cuando ese usuario vuelva a ingresar")
        r = await post(nuevo)
      }
      const final: ItemOutbox = {
        ...it,
        estado: "enviado",
        intentos: it.intentos + 1,
        error: null,
        resultado: r && "resultado" in r ? r.resultado : null,
        enviadoAt: new Date(this.ahora()).toISOString(),
      }
      // O9: primero el efecto en la réplica, después "enviado"
      for (const fn of this.alAplicar) {
        try {
          await fn(final)
        } catch (e) {
          console.error(e)
        }
      }
      await this.db.put("outbox", final)
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
    const p = (await this.noEnviados()).find((i) => i.estado === "pendiente")
    if (!p) return null
    return Math.max(0, p.proximoIntentoAt - this.ahora())
  }

  private async recontar() {
    let pendientes = 0
    let rechazados = 0
    const lista = await this.noEnviados()
    for (const i of lista) {
      if (i.estado === "pendiente" || i.estado === "enviando") pendientes++
      else if (i.estado === "rechazado") rechazados++
    }
    this._noEnviados = lista
    this._contadores = { pendientes, rechazados, enviando: !!this.enVuelo }
    this.emisor.emitir()
  }
}
