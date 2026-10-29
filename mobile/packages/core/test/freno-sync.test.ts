import { describe, expect, it } from "vitest"
import { Api } from "../src/net/api"
import { ErrorHttp } from "../src/net/errores"
import { esperaPedida, esperaPorFallos, esRutaSync, momentoResync } from "../src/sync/freno"

// P2-49 (29/10/2026): la base se saturaba; el servidor de sync contesta 503 "esperá X s".

describe("Freno de la sincronización — reglas", () => {
  it("frena solo las lecturas de sync, no el outbox", () => {
    expect(esRutaSync("/api/mobile/sync/vendedor_cc")).toBe(true)
    expect(esRutaSync("/api/mobile/sync/estado")).toBe(true)
    expect(esRutaSync("/api/mobile/outbox")).toBe(false)
  })
  it("toma la espera del header Retry-After o de reintentar_en_s", () => {
    expect(esperaPedida("120", null)).toBe(120)
    expect(esperaPedida(null, { reintentar_en_s: 90 })).toBe(90)
    expect(esperaPedida(null, { error: "x" })).toBeNull()
  })
  it("espera creciente entre fallos seguidos, con tope de 10 min", () => {
    expect(esperaPorFallos(0)).toBe(0)
    expect(esperaPorFallos(1, 0.5)).toBe(30_000)
    expect(esperaPorFallos(2, 0.5)).toBe(60_000)
    expect(esperaPorFallos(3, 0.5)).toBe(120_000)
    expect(esperaPorFallos(20, 0.5)).toBe(600_000)
    expect(esperaPorFallos(20, 1)).toBe(720_000) // +20 % de azar como máximo
  })
  it("re-sincroniza 60-90 s después del último cambio, nunca más de 5 min después del primero", () => {
    expect(momentoResync(0, 0, 0)).toBe(60_000)
    expect(momentoResync(0, 0, 1)).toBe(90_000)
    expect(momentoResync(0, 40_000, 0)).toBe(100_000) // siguieron llegando cambios: se corre
    expect(momentoResync(0, 290_000, 0)).toBe(300_000) // tope
  })
})

describe("Freno de la sincronización — cliente HTTP", () => {
  const respuesta503 = () => new Response(JSON.stringify({ error: "carga", reintentar_en_s: 60 }), { status: 503, headers: { "Retry-After": "60" } })

  it("tras un 503 no vuelve a llamar al servidor de sync hasta que pase la espera", async () => {
    let llamadas = 0
    const api = new Api({ base: "http://erp", deviceId: "d", appVersion: "t", fetch: (async () => { llamadas++; return respuesta503() }) as typeof fetch })
    await expect(api.get("/api/mobile/sync/vendedor_cc")).rejects.toBeInstanceOf(ErrorHttp)
    expect(api.syncFrenadoMs).toBeGreaterThanOrEqual(59_000)
    // Otro dataset: tampoco sale (el servidor está cargado, no el dataset)
    await expect(api.get("/api/mobile/sync/vendedor_pedidos")).rejects.toMatchObject({ status: 503 })
    expect(llamadas).toBe(1)
  })
  it("el outbox (escrituras) no se frena", async () => {
    let llamadas = 0
    const api = new Api({
      base: "http://erp", deviceId: "d", appVersion: "t",
      fetch: (async (url: string) => { llamadas++; return String(url).includes("/sync/") ? respuesta503() : new Response("{}", { status: 200 }) }) as unknown as typeof fetch,
    })
    await expect(api.get("/api/mobile/sync/x")).rejects.toBeInstanceOf(ErrorHttp)
    await expect(api.post("/api/mobile/outbox", {})).resolves.toEqual({})
    expect(llamadas).toBe(2)
  })
})
