import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"
import type { AppMovil } from "@gm/contrato"
import { Emisor } from "../emitter"

// Hacer sonar un equipo perdido (20/11/2026, MOBILE.md → "Hacer sonar un equipo").
// Lo nativo (plugin GmAlarma, mobile/packages/capacitor-alarma) recibe el mensaje de
// Firebase y suena aunque la app esté cerrada. Acá: mandar el token de Firebase al
// servidor (al iniciar sesión y cuando cambia) y pedir el permiso de avisos.

interface GmAlarmaPlugin {
  token(): Promise<{ token: string }>
  permisoNotificaciones(): Promise<{ valor: boolean }>
  pedirPermisoNotificaciones(): Promise<{ valor: boolean }>
  probar(o: { mensaje?: string }): Promise<void>
  detener(): Promise<void>
  addListener(evento: "token", fn: (d: { token: string }) => void): Promise<PluginListenerHandle>
}
const GmAlarma = registerPlugin<GmAlarmaPlugin>("GmAlarma")
const nativo = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("GmAlarma")

export interface DepsAlarma {
  app: AppMovil
  post: (path: string, body: unknown) => Promise<unknown>
  online: () => boolean
  usuario: () => string | null
  /** Último token enviado por usuario (persistido en el equipo) */
  leer: (k: string) => Promise<string | undefined>
  guardar: (k: string, v: string) => Promise<void>
  plataforma?: { token(): Promise<string>; permiso(): Promise<boolean>; pedirPermiso(): Promise<boolean> }
}

/** Cómo va el registro del token (se ve en depósito → "Buscar un equipo" → ESTE EQUIPO). */
export interface DiagAlarma {
  fase: "sin_intentar" | "sin_firebase" | "sin_sesion" | "sin_senal" | "pidiendo_token" | "enviando" | "registrado" | "error"
  detalle: string | null
}

/** Firebase puede tardar o no contestar nunca: el pedido del token se corta a los 20 s. */
export const TOKEN_TIMEOUT_MS = 20_000
/** Mientras el servidor no tenga el token se reintenta cada 3 min (además de los disparadores). */
export const REINTENTO_MS = 3 * 60_000

const conTiempo = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, mal) => setTimeout(() => mal(Object.assign(new Error(`Firebase no contestó en ${ms / 1000} s`), { code: "TIMEOUT" })), ms))])

export class RegistroAlarma {
  private emisor = new Emisor()
  private _permiso: boolean | null = null
  /** Momento en que arrancó el envío en curso (0 = ninguno). Un envío colgado no traba los siguientes. */
  private enviandoDesde = 0
  private registrado = false
  private _diag: DiagAlarma = { fase: "sin_intentar", detalle: null }
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private deps: DepsAlarma) {}

  suscribir = (fn: () => void) => this.emisor.suscribir(fn)
  /** null = no se sabe todavía / no aplica (navegador) */
  get permiso() {
    return this._permiso
  }
  get diag() {
    return this._diag
  }

  private diagnostico(fase: DiagAlarma["fase"], detalle: string | null = null) {
    this._diag = { fase, detalle }
    if (fase !== "registrado" && fase !== "pidiendo_token" && fase !== "enviando") console.warn(`[GmAlarma] token: ${fase}${detalle ? ` — ${detalle}` : ""}`)
    else console.info(`[GmAlarma] token: ${fase}${detalle ? ` — ${detalle}` : ""}`)
    this.emisor.emitir()
  }

  private get plat() {
    if (this.deps.plataforma) return this.deps.plataforma
    if (!nativo()) return null
    return {
      token: async () => (await GmAlarma.token()).token,
      permiso: async () => (await GmAlarma.permisoNotificaciones()).valor,
      pedirPermiso: async () => (await GmAlarma.pedirPermisoNotificaciones()).valor,
    }
  }

  /**
   * Arranca: permiso + token; re-manda si Firebase cambia el token y, mientras el servidor
   * no lo tenga, reintenta cada 3 min (los disparadores de red/sesión solo avisan cuando
   * CAMBIAN: si al arrancar todavía no había señal o sesión, esto lo destraba).
   */
  iniciar() {
    void this.revisarPermiso()
    void this.enviarToken()
    if (nativo()) void GmAlarma.addListener("token", (d) => void this.enviarToken({ conocido: d.token, forzar: true }))
    if (!this.timer) this.timer = setInterval(() => { if (!this.registrado) void this.enviarToken() }, REINTENTO_MS)
  }

  detener() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async revisarPermiso() {
    const p = this.plat
    if (!p) return
    this._permiso = await p.permiso().catch(() => null)
    this.emisor.emitir()
  }

  async pedirPermiso(): Promise<boolean> {
    const p = this.plat
    if (!p) return true
    const ok = await p.pedirPermiso().catch(() => false)
    this._permiso = ok
    this.emisor.emitir()
    void this.enviarToken()
    return ok
  }

  /**
   * Manda el token al servidor si cambió (o si es otro usuario). `forzar`: lo manda aunque
   * el equipo crea que ya lo mandó (botón REGISTRAR AHORA). Nunca tira: sin señal, sin
   * sesión o sin Firebase deja el diagnóstico y se vuelve a probar en la próxima.
   */
  async enviarToken(o: { conocido?: string; forzar?: boolean } = {}): Promise<void> {
    const p = this.plat
    if (!p) return this.diagnostico("sin_firebase", "esta app no tiene el plugin de alarma (navegador)")
    const uid = this.deps.usuario()
    if (!uid) return this.diagnostico("sin_sesion")
    if (!this.deps.online()) return this.diagnostico("sin_senal")
    // Un envío anterior colgado (Firebase sin contestar) no traba para siempre
    if (this.enviandoDesde && Date.now() - this.enviandoDesde < TOKEN_TIMEOUT_MS + 15_000) return
    this.enviandoDesde = Date.now()
    try {
      this.diagnostico("pidiendo_token")
      const token = o.conocido ?? (await conTiempo(p.token(), TOKEN_TIMEOUT_MS))
      const clave = `fcmToken:${uid}`
      if (!o.forzar && (await this.deps.leer(clave)) === token) {
        this.registrado = true
        return this.diagnostico("registrado", "ya estaba enviado")
      }
      this.diagnostico("enviando", token.slice(0, 12) + "…")
      const r = (await this.deps.post("/api/mobile/dispositivos/token", { app: this.deps.app, token })) as { ok?: boolean } | null
      // Solo se da por enviado si el servidor lo guardó (sin la migración contesta ok: false)
      if (r?.ok) {
        await this.deps.guardar(clave, token)
        this.registrado = true
        this.diagnostico("registrado")
      } else {
        this.diagnostico("error", "el servidor no lo guardó")
      }
    } catch (e: any) {
      const codigo = e?.code ? `${e.code}: ` : ""
      this.diagnostico(e?.code === "SIN_FIREBASE" ? "sin_firebase" : "error", codigo + (e?.message || String(e)))
    } finally {
      this.enviandoDesde = 0
    }
  }
}

/** Prueba local: suena en ESTE equipo (sin servidor). */
export const probarAlarmaLocal = () => (nativo() ? GmAlarma.probar({ mensaje: "Prueba de alarma" }) : Promise.resolve())
export const detenerAlarmaLocal = () => (nativo() ? GmAlarma.detener() : Promise.resolve())
