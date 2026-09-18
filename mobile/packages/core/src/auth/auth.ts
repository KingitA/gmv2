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
/** Sesiones aparcadas (cambio de turno con operaciones sin enviar). Ver aparcar(). */
const CLAVE_APARCADAS = "gm.sesiones.aparcadas"
const claveAparcada = (uid: string) => `gm.sesion.aparcada.${uid}`

export interface UsuarioAparcado {
  id: string
  nombre: string
}
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
  private renovandoAparcada = new Map<string, Promise<string | null>>()

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
      this._sesion = await this.leerSesionGuardada()
    } catch (e) {
      // El almacén falló las N veces (no es "no hay sesión"): no hay forma de
      // operar sin identidad, pero queda registrado para diagnosticar.
      console.error("[auth] no se pudo leer la sesión guardada", e)
      this._sesion = null
    }
    this.set(this._sesion ? "autenticado" : "anonimo")
    return this._estado
  }

  /**
   * Lee la sesión del almacén seguro. Distingue "no hay sesión" (null) de "falló
   * la lectura" (reintenta): tras reiniciar, el Keystore de equipos de gama baja
   * puede tardar o fallar las primeras operaciones, y un error NUNCA debe
   * desloguear a un operario que está sin señal (MOBILE.md §7).
   */
  private async leerSesionGuardada(intentos = 4): Promise<SesionMovil | null> {
    let ultimo: unknown
    for (let i = 0; i < intentos; i++) {
      try {
        const raw = await this.almacen.get(CLAVE)
        return raw ? (JSON.parse(raw) as SesionMovil) : null
      } catch (e) {
        ultimo = e
        await new Promise((r) => setTimeout(r, 250 * (i + 1)))
      }
    }
    throw ultimo
  }

  async ingresar(email: string, password: string): Promise<void> {
    const s = await this.api.post<SesionMovil>("/api/mobile/auth/login", { email, password, app: this.app }, { auth: false })
    // Volvió a ingresar alguien que tenía la sesión aparcada: la nueva la reemplaza
    await this.descartarAparcada(s.user.id)
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

  // ─── Sesiones aparcadas (handheld compartido entre turnos) ────────────────
  //
  // Un operario deja el equipo con operaciones sin enviar (estaba sin señal) y
  // otro necesita ingresar YA. En vez de bloquear la salida, la sesión del que
  // se va queda "aparcada" en el almacén seguro: el outbox la usa SOLO para
  // enviar lo que ESE usuario capturó (invariante O8) y se descarta sola cuando
  // ya no le queda nada pendiente. Nunca se puede "retomar" sin contraseña.

  async aparcadas(): Promise<UsuarioAparcado[]> {
    try {
      const raw = await this.almacen.get(CLAVE_APARCADAS)
      return raw ? (JSON.parse(raw) as UsuarioAparcado[]) : []
    } catch {
      return []
    }
  }

  /** Sale al login SIN revocar la sesión: queda aparcada para terminar de enviar su outbox. */
  async aparcar(): Promise<void> {
    const s = this._sesion
    if (!s) return
    await this.almacen.set(claveAparcada(s.user.id), JSON.stringify(s))
    const lista = (await this.aparcadas()).filter((u) => u.id !== s.user.id)
    lista.push({ id: s.user.id, nombre: s.user.nombre || s.user.email || "Operario" })
    await this.almacen.set(CLAVE_APARCADAS, JSON.stringify(lista))
    this._sesion = null
    await this.almacen.remove(CLAVE).catch(() => {})
    this.set("anonimo")
  }

  /** Borra una sesión aparcada (ya no tiene nada pendiente, o el servidor la rechazó). */
  async descartarAparcada(uid: string, revocar = false): Promise<void> {
    const lista = await this.aparcadas()
    if (!lista.some((u) => u.id === uid)) return
    if (revocar) {
      const raw = await this.almacen.get(claveAparcada(uid)).catch(() => null)
      const token = raw ? (JSON.parse(raw) as SesionMovil).access_token : null
      if (token) {
        await this.api.post("/api/mobile/auth/logout", {}, { auth: false, headers: { Authorization: `Bearer ${token}` }, timeoutMs: 5000 }).catch(() => {})
      }
    }
    await this.almacen.remove(claveAparcada(uid)).catch(() => {})
    await this.almacen.set(CLAVE_APARCADAS, JSON.stringify(lista.filter((u) => u.id !== uid))).catch(() => {})
  }

  /**
   * Access token de una sesión aparcada (renovado si hace falta). null = no hay
   * sesión aparcada de ese usuario o el servidor la rechazó: sus operaciones
   * esperan a que vuelva a ingresar.
   */
  tokenAparcado(uid: string, forzar = false): Promise<string | null> {
    let p = this.renovandoAparcada.get(uid)
    if (!p) {
      p = this.hacerTokenAparcado(uid, forzar).finally(() => this.renovandoAparcada.delete(uid))
      this.renovandoAparcada.set(uid, p)
    }
    return p
  }

  private async hacerTokenAparcado(uid: string, forzar: boolean): Promise<string | null> {
    let s: SesionMovil | null = null
    try {
      const raw = await this.almacen.get(claveAparcada(uid))
      s = raw ? (JSON.parse(raw) as SesionMovil) : null
    } catch {
      return null
    }
    if (!s) return null
    const vence = s.expires_at - Date.now() / 1000
    if (!forzar && vence >= MARGEN_RENOVACION_S) return s.access_token
    try {
      const nueva = await this.api.post<SesionMovil>(
        "/api/mobile/auth/refresh",
        { refresh_token: s.refresh_token, app: this.app },
        { auth: false, timeoutMs: 15_000 },
      )
      await this.almacen.set(claveAparcada(uid), JSON.stringify(nueva))
      return nueva.access_token
    } catch (e) {
      if (e instanceof ErrorHttp && e.status === 401) {
        await this.descartarAparcada(uid)
        return null
      }
      // Sin red / transitorio: usar el token que hay si todavía no venció
      return vence > 0 && !forzar ? s.access_token : null
    }
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
