import { abrirDb } from "../src/db/idb"
import { Api } from "../src/net/api"

let n = 0
/** Base nueva y aislada por test (fake-indexeddb en memoria). */
export async function dbNueva() {
  return abrirDb(`test-${Date.now()}-${n++}`)
}

export type Manejador = (req: { method: string; path: string; body: any; headers: Record<string, string> }) =>
  | { status: number; body: unknown }
  | Promise<{ status: number; body: unknown }>
  | "red"

/** Api con fetch falso: el manejador decide la respuesta o simula caída de red ("red"). */
export function apiFalsa(manejador: Manejador) {
  const llamadas: Array<{ method: string; path: string; body: any }> = []
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace("http://test", "")
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    llamadas.push({ method: String(init.method), path, body })
    const r = await manejador({ method: String(init.method), path, body, headers: init.headers as Record<string, string> })
    if (r === "red") throw new TypeError("Failed to fetch")
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } })
  }) as unknown as typeof fetch
  const api = new Api({ base: "http://test", deviceId: "dev-1", appVersion: "0.0.0-test", fetch: f })
  return { api, llamadas }
}
