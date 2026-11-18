import type { AppMovil, RespuestaActualizacion } from "@gm/contrato"
import { Emisor } from "../emitter"

/**
 * Actualización de la app con un botón (17/11/2026, MOBILE.md → "Actualización desde la app").
 *
 * La app pregunta GET /api/mobile/actualizacion?app=X (manda su versionCode en el header
 * X-App-Version-Code) al abrir, al volver a primer plano y cada 30 min con señal. Si hay
 * una versión nueva, la franja del inicio ofrece ACTUALIZAR: baja el APK de una URL
 * firmada (nunca pasa por Vercel), verifica el sha256 y abre el instalador de Android.
 * El usuario solo toca ACTUALIZAR → INSTALAR. Instalar encima (misma firma) conserva
 * sesión, réplica y outbox.
 */

export type FaseActualizacion =
  | "nada" // al día (o todavía no se sabe)
  | "disponible" // hay versión nueva: botón ACTUALIZAR
  | "permiso" // Android pide permitir "instalar apps desconocidas" (una sola vez)
  | "bajando" // barra de progreso
  | "instalando" // se abrió el cartel de Android: tocar INSTALAR
  | "error"

export interface EstadoActualizacion {
  fase: FaseActualizacion
  info: RespuestaActualizacion | null
  /** 0..1 mientras baja (null = sin total conocido) */
  progreso: number | null
  error: string | null
  /** "Más tarde": se oculta hasta el próximo arranque (nunca si es obligatoria) */
  pospuesta: boolean
}

/** Lo nativo (plugin GmArchivos) o su reemplazo en el navegador. */
export interface PlataformaActualizacion {
  puedeInstalar(): Promise<boolean>
  abrirPermisoInstalar(): Promise<void>
  /** Devuelve la ruta del APK ya verificado. Rechaza con codigo "SHA" si no coincide el sha256. */
  descargar(o: { url: string; sha256: string; nombre: string }, alAvanzar: (bajado: number, total: number) => void): Promise<string>
  instalar(ruta: string): Promise<void>
}

export interface DepsActualizador {
  app: AppMovil
  get: (path: string) => Promise<RespuestaActualizacion>
  online: () => boolean
  autenticado: () => boolean
  plataforma: PlataformaActualizacion
  ahora?: () => number
}

export const MSJ_SIN_SENAL = "No se pudo bajar la actualización. Probá con señal."
export const MSJ_INCOMPLETA = "La actualización llegó incompleta. Probá de nuevo con señal."
export const MSJ_INSTALADOR = "No se pudo abrir el instalador. Avisá a la oficina."

export const CADA_MS = 30 * 60_000
/** Mínimo entre dos consultas automáticas (abrir + volver a primer plano seguidos) */
const MIN_ENTRE_CONSULTAS_MS = 60_000

const INICIAL: EstadoActualizacion = { fase: "nada", info: null, progreso: null, error: null, pospuesta: false }

export class Actualizador {
  private emisor = new Emisor()
  private _estado: EstadoActualizacion = INICIAL
  private ultimaConsulta = -Infinity
  private consultando: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** versionCode que el usuario pospuso ("Más tarde") */
  private pospuestaCode: number | null = null

  constructor(private deps: DepsActualizador) {}

  suscribir = (fn: () => void) => this.emisor.suscribir(fn)
  get estado() {
    return this._estado
  }

  private set(cambios: Partial<EstadoActualizacion>) {
    this._estado = { ...this._estado, ...cambios }
    this.emisor.emitir()
  }

  private get ahora() {
    return (this.deps.ahora ?? Date.now)()
  }

  /** Consulta inicial + cada 30 min (solo con señal y sesión). */
  iniciar() {
    void this.chequear()
    if (!this.timer) this.timer = setInterval(() => void this.chequear(), CADA_MS)
  }

  detener() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** ¿Hay versión nueva? Silencioso: un error de red no muestra nada. */
  chequear(forzar = false): Promise<void> {
    if (this.consultando) return this.consultando
    if (!this.deps.online() || !this.deps.autenticado()) return Promise.resolve()
    if (!forzar && this.ahora - this.ultimaConsulta < MIN_ENTRE_CONSULTAS_MS) return Promise.resolve()
    this.ultimaConsulta = this.ahora
    this.consultando = (async () => {
      try {
        const info = await this.deps.get(`/api/mobile/actualizacion?app=${this.deps.app}`)
        const ocupado = ["permiso", "bajando", "instalando"].includes(this._estado.fase)
        if (!info?.hay) {
          if (!ocupado) this.set({ fase: "nada", info: null, error: null, progreso: null })
          return
        }
        const pospuesta = !info.obligatoria && this.pospuestaCode === info.version_code
        if (ocupado) this.set({ info, pospuesta })
        else this.set({ fase: this._estado.fase === "error" ? "error" : "disponible", info, pospuesta })
      } catch {
        /* sin señal / servidor caído: se vuelve a probar en la próxima */
      } finally {
        this.consultando = null
      }
    })()
    return this.consultando
  }

  /** Volvió a primer plano: re-consulta y retoma el flujo (permiso dado, instalador cancelado). */
  async alVolver() {
    const fase = this._estado.fase
    if (fase === "permiso") {
      if (await this.deps.plataforma.puedeInstalar().catch(() => false)) return this.actualizar()
      return
    }
    // Volvió del cartel de Android sin instalar (canceló): se puede reintentar
    if (fase === "instalando") this.set({ fase: "disponible" })
    await this.chequear()
  }

  posponer() {
    const info = this._estado.info
    if (!info || info.obligatoria) return
    this.pospuestaCode = info.version_code
    this.set({ pospuesta: true })
  }

  /** ACTUALIZAR: permiso → bajar (con barra) → verificar sha256 → instalador de Android. */
  async actualizar(): Promise<void> {
    if (this._estado.fase === "bajando") return
    if (!(await this.deps.plataforma.puedeInstalar().catch(() => false))) {
      this.set({ fase: "permiso", error: null })
      return
    }
    // URL nueva (la firmada vence a los 15 min) y datos frescos
    let info: RespuestaActualizacion
    try {
      info = await this.deps.get(`/api/mobile/actualizacion?app=${this.deps.app}`)
    } catch {
      this.set({ fase: "error", error: MSJ_SIN_SENAL, progreso: null })
      return
    }
    if (!info?.hay || !info.url || !info.sha256) {
      this.set({ fase: "nada", info: null, error: null, progreso: null })
      return
    }
    this.set({ fase: "bajando", info, progreso: 0, error: null })
    let ruta: string
    try {
      ruta = await this.deps.plataforma.descargar(
        { url: info.url, sha256: info.sha256, nombre: `${this.deps.app}-${info.version_code}.apk` },
        (bajado, total) => {
          const t = total > 0 ? total : info.tamano_bytes ?? 0
          this.set({ progreso: t > 0 ? Math.min(1, bajado / t) : null })
        },
      )
    } catch (e: any) {
      this.set({ fase: "error", error: e?.code === "SHA" ? MSJ_INCOMPLETA : MSJ_SIN_SENAL, progreso: null })
      return
    }
    this.set({ progreso: 1 })
    try {
      await this.deps.plataforma.instalar(ruta)
      this.set({ fase: "instalando" })
    } catch (e: any) {
      this.set({ fase: "error", error: e?.mensajeUsuario || MSJ_INSTALADOR, progreso: null })
    }
  }

  abrirPermiso() {
    return this.deps.plataforma.abrirPermisoInstalar().catch(() => {
      this.set({ fase: "error", error: "No se pudo abrir el ajuste. Avisá a la oficina." })
    })
  }
}
