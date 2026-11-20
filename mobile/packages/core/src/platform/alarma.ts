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

export class RegistroAlarma {
  private emisor = new Emisor()
  private _permiso: boolean | null = null
  private enviando = false
  constructor(private deps: DepsAlarma) {}

  suscribir = (fn: () => void) => this.emisor.suscribir(fn)
  /** null = no se sabe todavía / no aplica (navegador) */
  get permiso() {
    return this._permiso
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

  /** Arranca: permiso + token; y re-manda si Firebase cambia el token. */
  iniciar() {
    void this.revisarPermiso()
    void this.enviarToken()
    if (nativo()) void GmAlarma.addListener("token", (d) => void this.enviarToken(d.token))
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
   * Manda el token al servidor si cambió (o si es otro usuario). Silencioso: sin señal, sin
   * sesión o sin Firebase en el APK no hace nada y se vuelve a probar en la próxima.
   */
  async enviarToken(conocido?: string): Promise<void> {
    const p = this.plat
    const uid = this.deps.usuario()
    if (!p || !uid || !this.deps.online() || this.enviando) return
    this.enviando = true
    try {
      const token = conocido ?? (await p.token())
      const clave = `fcmToken:${uid}`
      if ((await this.deps.leer(clave)) === token) return
      const r = (await this.deps.post("/api/mobile/dispositivos/token", { app: this.deps.app, token })) as { ok?: boolean } | null
      // Solo se da por enviado si el servidor lo guardó (sin la migración contesta ok: false)
      if (r?.ok) await this.deps.guardar(clave, token)
    } catch {
      /* sin Firebase / sin señal: en la próxima */
    } finally {
      this.enviando = false
    }
  }
}

/** Prueba local: suena en ESTE equipo (sin servidor). */
export const probarAlarmaLocal = () => (nativo() ? GmAlarma.probar({ mensaje: "Prueba de alarma" }) : Promise.resolve())
export const detenerAlarmaLocal = () => (nativo() ? GmAlarma.detener() : Promise.resolve())
