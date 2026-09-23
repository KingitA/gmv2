// Ejecutar un route handler de la web EN PROCESO desde un handler del outbox, con la
// sesión (bearer) del request original. Compartido por los handlers de las apps
// (vendedor, chofer): 2xx ⇒ body · 4xx ⇒ RechazoNegocio (definitivo) · 5xx ⇒ transitorio.

import { RechazoNegocio, type CtxOutbox } from "./tipos"

export async function llamarRuta(
  handler: (...a: any[]) => Promise<Response>,
  ctx: CtxOutbox,
  o: {
    ruta: string
    method: string
    body?: unknown
    params?: Record<string, string>
    headers?: Record<string, string>
    rechazo?: (status: number, body: any) => string | null
  },
): Promise<any> {
  const headers = new Headers(ctx.request.headers)
  headers.set("content-type", "application/json")
  headers.delete("content-length")
  for (const [k, v] of Object.entries(o.headers || {})) headers.set(k, v)
  const req = new Request(new URL(o.ruta, ctx.request.url), {
    method: o.method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  })
  const res = await handler(req, { params: Promise.resolve(o.params || {}) })
  const body = await res.json().catch(() => null)
  if (res.ok) return body
  if (res.status >= 400 && res.status < 500) throw new RechazoNegocio(o.rechazo?.(res.status, body) || body?.mensaje || body?.error || `Rechazado (${res.status})`, body?.codigo)
  throw new Error(body?.error || `HTTP ${res.status}`)
}

/** Llama a un GET del ERP con la sesión del request original (para parches de réplica). */
export async function llamarGET(
  handler: (...a: any[]) => Promise<Response>,
  ctx: { request: Request },
  ruta = "/",
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<any> {
  const h = new Headers(ctx.request.headers)
  for (const [k, v] of Object.entries(headers)) h.set(k, v)
  const req = new Request(new URL(ruta, ctx.request.url), { headers: h })
  const res = await handler(req, { params: Promise.resolve(params) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status })
  return body
}
