import type { AppMovil, SesionMovil } from "@gm/contrato"
import { Emisor } from "../emitter"
import type { Api } from "../net/api"
import { ErrorHttp, ErrorRed } from "../net/errores"

/** Almacenamiento seguro (Android Keystore en el dispositivo). */
export interface AlmacenSeguro {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export type EstadoAuth = "cargando" | "anonimo" | "autenticado"

const CLAVE = "gm.sesion"
/** Renovar el access token si vence en menos de esto */
const MARGEN_RENOVACION_S = 120

/**
 * Sesión persistente de dispositivo.
 *
 * - El operario loguea UNA vez: access + refresh token quedan en el almacén
 *   seguro. Al abrir la app (con o sin red) la sesión se restaura sin login.
 * - Offline: se sigue operando con la sesión guardada aunque el access token
 *   esté vencido (todo lo que se escribe va al outbox; al volver la red se
 *   renueva antes de enviar).
 * - Solo se vuelve al login si el servidor RESPONDE que la sesión no sirve
 *   (refresh 401: revocada, usuario sin rol, dispositivo dado de baja). Un
 *   error de red nunca desloguea.
 */
export class Auth {
  private emisor = new Emisor()
  private _estado: EstadoAuth = "cargando"
  private _sesion: SesionMovil | null = null
  private renovando: Promise<boolean> | null = null

  constructor(
    private api: Api,
    private almacen: AlmacenSeguro,
    readonly app: AppMovil,
  ) {
    api.conAuth(this)
  }

  suscribir = this.emisor.suscribir
  get estado() {
    return this._estado
  }
  get sesion() {
    return this._sesion
  }

  async iniciar(): Promise<EstadoAuth> {
    try {
      const raw = await this.almacen.get(CLAVE)
      this._sesion = raw ? (JSON.parse(raw) as SesionMovil) : null
    } catch {
      this._sesion = null
    }
    this.set(this._sesion ? "autenticado" : "anonimo")
    return this._estado
  }

  async ingresar(email: string, password: string): Promise<void> {
    const s = await this.api.post<SesionMovil>("/api/mobile/auth/login", { email, password, app: this.app }, { auth: false })
    await this.guardar(s)
    this.set("autenticado")
  }

  /** Cierra sesión en el dispositivo (y la revoca en el servidor si hay red). */
  async salir(): Promise<void> {
    const token = this._sesion?.access_token
    if (token) {
      await this.api.post("/api/mobile/auth/logout", {}, { auth: false, headers: { Authorization: `Bearer ${token}` }, timeoutMs: 5000 }).catch(() => {})
    }
    await this.sesionInvalida()
  }

  /** El servidor rechazó la sesión: borrar y volver al login. */
  async sesionInvalida(): Promise<void> {
    this._sesion = null
    await this.almacen.remove(CLAVE).catch(() => {})
    this.set("anonimo")
  }

  /** Token para el header Authorization. Renueva si está por vencer (si hay red). */
  async accessToken(): Promise<string | null> {
    const s = this._sesion
    if (!s) return null
    if (s.expires_at - Date.now() / 1000 < MARGEN_RENOVACION_S) await this.renovar(false)
    return this._sesion?.access_token ?? null
  }

  /**
   * Renueva con el refresh token. Una sola renovación en vuelo (single-flight):
   * con rotación de refresh tokens, dos renovaciones paralelas se invalidarían
   * entre sí. Devuelve false solo si el servidor rechazó la sesión.
   */
  renovar(forzar: boolean): Promise<boolean> {
    if (!this._sesion) return Promise.resolve(false)
    if (!forzar && this._sesion.expires_at - Date.now() / 1000 >= MARGEN_RENOVACION_S) return Promise.resolve(true)
    if (!this.renovando) {
      this.renovando = this.hacerRenovacion().finally(() => {
        this.renovando = null
      })
    }
    return this.renovando
  }

  private async hacerRenovacion(): Promise<boolean> {
    const s = this._sesion
    if (!s) return false
    try {
      const nueva = await this.api.post<SesionMovil>(
        "/api/mobile/auth/refresh",
        { refresh_token: s.refresh_token, app: this.app },
        { auth: false, timeoutMs: 15_000 },
      )
      await this.guardar(nueva)
      return true
    } catch (e) {
      if (e instanceof ErrorHttp && e.status === 401) {
        await this.sesionInvalida()
        return false
      }
      if (e instanceof ErrorRed || (e instanceof ErrorHttp && e.reintentable)) return true // seguir con lo que hay
      return true
    }
  }

  private async guardar(s: SesionMovil) {
    this._sesion = s
    await this.almacen.set(CLAVE, JSON.stringify(s))
    this.emisor.emitir()
  }

  private set(e: EstadoAuth) {
    this._estado = e
    this.emisor.emitir()
  }
}
