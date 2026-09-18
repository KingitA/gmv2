import type { Auth } from "../auth/auth"
import { ErrorHttp, ErrorRed, ErrorSesion } from "./errores"

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
  constructor(private opts: OpcionesApi) {}

  conAuth(auth: Auth) {
    this.auth = auth
    return this
  }

  get base() {
    return this.opts.base
  }

  async request<T = any>(path: string, o: OpcionesRequest = {}): Promise<T> {
    const r = await this.enviar(path, o)
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
