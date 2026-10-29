import type { Auth } from "../auth/auth"
import { ErrorHttp, ErrorRed, ErrorSesion } from "./errores"
import { esperaPedida, esRutaSync } from "../sync/freno"

export interface OpcionesApi {
  /** URL base del ERP, ej. https://gmv2.vercel.app */
  base: string
  deviceId: string
  appVersion: string
  /** fetch inyectable (tests) */
  fetch?: typeof fetch
}

export interface OpcionesRequest {
  method?: string
  body?: unknown
  /** multipart (fotos): se manda tal cual, sin Content-Type (lo pone el navegador). Solo operaciones online-only. */
  form?: FormData
  /** default true: manda Authorization: Bearer */
  auth?: boolean
  timeoutMs?: number
  headers?: Record<string, string>
}

/**
 * Cliente HTTP de las apps. Todo pasa por acá:
 * - Bearer automático (y un reintento tras renovar si el servidor dice 401)
 * - Timeout (el NuStar en 3G/EDGE puede colgar un request minutos)
 * - Errores tipados: ErrorRed (reintentable), ErrorHttp, ErrorSesion
 */
export class Api {
  private auth: Auth | null = null
  /** P2-49: hasta cuándo (epoch ms) no se le pega a /api/mobile/sync/* (sync/freno.ts) */
  private syncFrenadoHasta = 0
  constructor(private opts: OpcionesApi) {}

  /** Frena las lecturas de sync `ms` (se queda con la espera más larga). */
  frenarSync(ms: number) {
    if (ms > 0) this.syncFrenadoHasta = Math.max(this.syncFrenadoHasta, Date.now() + ms)
  }
  /** ms que faltan para poder volver a sincronizar (0 = ya). */
  get syncFrenadoMs() {
    return Math.max(0, this.syncFrenadoHasta - Date.now())
  }

  conAuth(auth: Auth) {
    this.auth = auth
    return this
  }

  get base() {
    return this.opts.base
  }

  async request<T = any>(path: string, o: OpcionesRequest = {}): Promise<T> {
    // P2-49: el servidor pidió esperar ⇒ no se lo vuelve a llamar antes (ni con otro dataset)
    if (esRutaSync(path) && this.syncFrenadoMs > 0) {
      throw new ErrorHttp(503, { error: "El servidor está con mucha carga. La app vuelve a sincronizar sola en un rato.", frenado: true })
    }
    const r = await this.enviar(path, o)
    if (r.status === 503 && esRutaSync(path)) {
      // Se lee el cuerpo acá para tomar la espera; leer() vuelve a armar el error
      const copia = r.clone()
      const body = await copia.json().catch(() => null)
      const s = esperaPedida(r.headers.get("Retry-After"), body)
      // Un poco de azar: que los equipos no vuelvan todos juntos
      if (s) this.frenarSync(s * 1000 + Math.round(Math.random() * 15_000))
    }
    if (r.status === 401 && o.auth !== false && this.auth) {
      const ok = await this.auth.renovar(true)
      if (!ok) throw new ErrorSesion()
      const r2 = await this.enviar(path, o)
      if (r2.status === 401) {
        await this.auth.sesionInvalida()
        throw new ErrorSesion()
      }
      return this.leer<T>(r2)
    }
    return this.leer<T>(r)
  }

  get<T = any>(path: string, o: Omit<OpcionesRequest, "method" | "body"> = {}) {
    return this.request<T>(path, { ...o, method: "GET" })
  }

  post<T = any>(path: string, body: unknown, o: Omit<OpcionesRequest, "method" | "body"> = {}) {
    return this.request<T>(path, { ...o, method: "POST", body })
  }

  /** POST multipart (subir una foto). Online-only: nunca pasa por el outbox. */
  postForm<T = any>(path: string, form: FormData, o: Omit<OpcionesRequest, "method" | "body" | "form"> = {}) {
    return this.request<T>(path, { timeoutMs: 120_000, ...o, method: "POST", form })
  }

  delete<T = any>(path: string, body?: unknown, o: Omit<OpcionesRequest, "method" | "body"> = {}) {
    return this.request<T>(path, { ...o, method: "DELETE", body })
  }

  private async enviar(path: string, o: OpcionesRequest): Promise<Response> {
    const headers: Record<string, string> = {
      "X-Device-Id": this.opts.deviceId,
      "X-App-Version": this.opts.appVersion,
      ...o.headers,
    }
    if (o.body !== undefined && !o.form) headers["Content-Type"] = "application/json"
    if (o.auth !== false && this.auth) {
      const token = await this.auth.accessToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 20_000)
    try {
      return await (this.opts.fetch ?? fetch)(this.opts.base + path, {
        method: o.method ?? "GET",
        headers,
        body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
        signal: ctrl.signal,
        cache: "no-store",
      })
    } catch (e: any) {
      throw new ErrorRed(e?.name === "AbortError" ? "El servidor tardó demasiado en responder" : undefined)
    } finally {
      clearTimeout(t)
    }
  }

  private async leer<T>(r: Response): Promise<T> {
    const texto = await r.text()
    let body: any = null
    try {
      body = texto ? JSON.parse(texto) : null
    } catch {
      body = { error: texto.slice(0, 200) }
    }
    if (!r.ok) throw new ErrorHttp(r.status, body)
    return body as T
  }
}
