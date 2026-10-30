import type { EstadoSync } from "@gm/contrato"
import { Emisor } from "../emitter"
import type { Api } from "../net/api"
import { ErrorRed, ErrorSesion } from "../net/errores"
import type { Conectividad } from "../platform/conectividad"
import type { Outbox } from "./outbox"
import type { Replica } from "./replica"
import type { Reloj } from "./reloj"
import { esperaPorFallos, momentoResync } from "./freno"

export interface DefDataset {
  nombre: string
  /** Menor = se sincroniza antes (precios primero: son livianos y críticos) */
  prioridad: number
  /**
   * true ⇒ se re-sincroniza apenas /sync/estado muestra cambios en el log
   * (invalidación en segundos). Usar para insumos de precio.
   */
  invalidable?: boolean
  /** Refresco periódico en background, ms (default 10 min) */
  cadaMs?: number
}

export interface OpcionesSincronizador {
  datasets: DefDataset[]
  /** Sondeo de /sync/estado con la app en primer plano (default 15 s) */
  sondeoMs?: number
}

/**
 * Orquesta cuándo se sincroniza (ver MOBILE.md → "Cuándo sincroniza"):
 *  - al abrir la app y al volver a primer plano
 *  - al recuperar la red
 *  - sondeo liviano cada 15 s en primer plano → si cambió el log de cambios,
 *    re-sincroniza los datasets `invalidable` (precios) en segundos
 *  - refresco periódico de cada dataset (cadaMs)
 *  - reintentos del outbox según su backoff
 * Orden siempre: primero se ENVÍA el outbox, después se LEE (así la réplica ya
 * refleja lo que el operario acaba de hacer).
 */
export class Sincronizador {
  private emisor = new Emisor()
  private timers: ReturnType<typeof setTimeout>[] = []
  private timerOutbox: ReturnType<typeof setTimeout> | null = null
  private ultimoSeq: string | null = null
  private enPrimerPlano = true
  private corriendo = false
  private _ultimoError: string | null = null
  private bajas: Array<() => void> = []
  /** P2-49: fallos seguidos de sync (espera creciente) y re-sincronización diferida por cambios */
  private fallosSeguidos = 0
  private primerCambio: number | null = null
  private ultimoCambio = 0
  private timerCambios: ReturnType<typeof setTimeout> | null = null

  constructor(
    private api: Api,
    private replica: Replica,
    private outbox: Outbox,
    private red: Conectividad,
    private reloj: Reloj,
    private opts: OpcionesSincronizador,
  ) {}

  suscribir = (fn: () => void) => this.emisor.suscribir(fn)
  get ultimoError() {
    return this._ultimoError
  }

  iniciar() {
    if (this.corriendo) return
    this.corriendo = true
    this.bajas.push(
      this.red.suscribir(() => {
        if (this.red.online) void this.todo()
      }),
      this.outbox.suscribir(() => this.agendarOutbox()),
    )
    const sondeo = this.opts.sondeoMs ?? 15_000
    const tick = () => {
      if (this.enPrimerPlano && this.red.online) void this.sondear()
      this.timers.push(setTimeout(tick, sondeo))
    }
    this.timers.push(setTimeout(tick, sondeo))
    for (const d of this.opts.datasets) {
      const cada = d.cadaMs ?? 10 * 60_000
      const t = () => {
        if (this.red.online) void this.dataset(d.nombre)
        this.timers.push(setTimeout(t, cada))
      }
      this.timers.push(setTimeout(t, cada))
    }
    void this.todo()
  }

  detener() {
    this.corriendo = false
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    if (this.timerOutbox) clearTimeout(this.timerOutbox)
    if (this.timerCambios) clearTimeout(this.timerCambios)
    this.timerCambios = null
    this.primerCambio = null
    for (const b of this.bajas) b()
    this.bajas = []
  }

  /** Llamar desde el listener de ciclo de vida (App.appStateChange) */
  setPrimerPlano(activo: boolean) {
    const volvio = activo && !this.enPrimerPlano
    this.enPrimerPlano = activo
    if (volvio) void this.todo()
  }

  /** Envía el outbox y sincroniza todos los datasets por prioridad. */
  async todo(): Promise<void> {
    if (!this.red.online) return
    try {
      await this.outbox.enviar({ forzar: true }) // hay red: no esperar el backoff acumulado sin señal
      await this.sondear(false)
      const orden = [...this.opts.datasets].sort((a, b) => a.prioridad - b.prioridad)
      for (const d of orden) await this.dataset(d.nombre)
    } catch (e) {
      if (e instanceof ErrorSesion) return
    }
  }

  async dataset(nombre: string): Promise<boolean> {
    // P2-49: frenado (503 del servidor o fallos seguidos): no se intenta, ni se cuenta como fallo
    if (this.api.syncFrenadoMs > 0) return false
    try {
      await this.replica.sincronizar(nombre)
      this.fallosSeguidos = 0
      this.setError(null)
      return true
    } catch (e: any) {
      this.setError(e?.message || String(e))
      // Sin señal no es culpa del servidor (lo resuelve la vuelta de la red). Con señal, un
      // timeout (servidor que no llega a contestar) o un 5xx sí: se espacia el próximo intento
      if (!(e instanceof ErrorSesion) && (!(e instanceof ErrorRed) || this.red.online)) {
        this.fallosSeguidos++
        this.api.frenarSync(esperaPorFallos(this.fallosSeguidos))
      }
      return false
    }
  }

  /** Sondeo de invalidación. `resync`=false solo mide reloj/seq (lo usa todo()). */
  private async sondear(resync = true) {
    try {
      const t0 = Date.now()
      const est = await this.api.get<EstadoSync>("/api/mobile/sync/estado", { timeoutMs: 10_000 })
      await this.reloj.medir(est.server_time, t0, Date.now())
      const cambio = est.cambios_seq !== null && this.ultimoSeq !== null && est.cambios_seq !== this.ultimoSeq
      this.ultimoSeq = est.cambios_seq
      // P2-49: no re-sincronizar a los 15 s de cada cambio: esperar a que se calmen
      if (resync && cambio) this.agendarPorCambios()
      // Hay red: aprovechar para empujar el outbox si quedó algo
      // El servidor acaba de responder: empujar el outbox ya, sin esperar su backoff
      if (this.outbox.contadores.pendientes > 0) void this.outbox.enviar({ forzar: true })
    } catch {
      /* sin red: el próximo tick reintenta */
    }
  }

  /** Re-sincroniza los datasets `invalidable` cuando los cambios del servidor se calman. */
  private agendarPorCambios() {
    const ahora = Date.now()
    this.primerCambio ??= ahora
    this.ultimoCambio = ahora
    if (this.timerCambios) clearTimeout(this.timerCambios)
    const en = Math.max(this.api.syncFrenadoMs, momentoResync(this.primerCambio, this.ultimoCambio) - ahora)
    this.timerCambios = setTimeout(() => {
      this.timerCambios = null
      this.primerCambio = null
      if (!this.corriendo || !this.red.online) return
      void (async () => {
        for (const d of this.opts.datasets.filter((x) => x.invalidable).sort((a, b) => a.prioridad - b.prioridad)) {
          if (!(await this.dataset(d.nombre))) break
        }
      })()
    }, en)
  }

  private agendarOutbox() {
    if (this.timerOutbox || !this.corriendo) return
    void this.outbox.proximoReintentoEn().then((ms) => {
      if (ms === null || this.timerOutbox || !this.corriendo) return
      this.timerOutbox = setTimeout(() => {
        this.timerOutbox = null
        if (this.red.online) void this.outbox.enviar()
      }, Math.max(1000, ms))
    })
  }

  private setError(e: string | null) {
    if (e !== this._ultimoError) {
      this._ultimoError = e
      this.emisor.emitir()
    }
  }
}
