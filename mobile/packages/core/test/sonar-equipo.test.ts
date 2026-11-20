import { describe, expect, it, vi } from "vitest"
import { RegistroAlarma } from "../src/platform/alarma"
import { mensajeResultado, motivoNoSuena, puedeSonar } from "../../../../lib/mobile/sonar"
import { enviarFcm } from "../../../../lib/mobile/fcm"

// Hacer sonar un equipo perdido (20/11/2026). MOBILE.md → "Hacer sonar un equipo".

describe("Servidor: quién puede hacer sonar y por qué no suena", () => {
  it("admin cualquiera; depósito solo equipos de depósito; nadie más", () => {
    expect(puedeSonar(["admin"], "vendedor")).toBe(true)
    expect(puedeSonar(["deposito"], "deposito")).toBe(true)
    expect(puedeSonar(["deposito"], "chofer")).toBe(false)
    expect(puedeSonar(["vendedor"], "vendedor")).toBe(false)
  })
  it("sin token explica por qué", () => {
    const base = { device_id: "d", app: "deposito", usuario_id: "u", ultimo_contacto_at: "2026-11-19T10:00:00Z", fcm_token: "t" }
    expect(motivoNoSuena(base)).toBeNull()
    expect(motivoNoSuena({ ...base, fcm_token: null })).toMatch(/no actualizó la app/)
    expect(motivoNoSuena({ ...base, fcm_token: null, usuario_id: null })).toMatch(/Nunca inició sesión/)
    expect(motivoNoSuena({ ...base, revocado: true })).toMatch(/dado de baja/)
  })
  it("sin la cuenta de servicio de Firebase no rompe: avisa que falta configurar", async () => {
    const antes = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    expect(await enviarFcm("tok", { tipo: "sonar" })).toBe("sin_firebase")
    expect(mensajeResultado("sonar", "sin_firebase")).toMatch(/Falta configurar Firebase/)
    if (antes !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = antes
  })
})

describe("App: el token de Firebase va al servidor", () => {
  function armar(o: { respuesta?: unknown; online?: boolean; usuario?: string | null } = {}) {
    const guardado = new Map<string, string>()
    const post = vi.fn(async () => o.respuesta ?? { ok: true })
    let token = "tok-1"
    const r = new RegistroAlarma({
      app: "deposito",
      post,
      online: () => o.online ?? true,
      usuario: () => (o.usuario === undefined ? "u1" : o.usuario),
      leer: async (k) => guardado.get(k),
      guardar: async (k, v) => void guardado.set(k, v),
      plataforma: { token: async () => token, permiso: async () => false, pedirPermiso: async () => true },
    })
    return { r, post, cambiarToken: (t: string) => (token = t) }
  }

  it("lo manda una vez y de nuevo solo si cambia", async () => {
    const { r, post, cambiarToken } = armar()
    await r.enviarToken()
    await r.enviarToken()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith("/api/mobile/dispositivos/token", { app: "deposito", token: "tok-1" })
    cambiarToken("tok-2")
    await r.enviarToken()
    expect(post).toHaveBeenCalledTimes(2)
  })
  it("si el servidor no lo guardó (sin migración) lo vuelve a intentar", async () => {
    const { r, post } = armar({ respuesta: { ok: false } })
    await r.enviarToken()
    await r.enviarToken()
    expect(post).toHaveBeenCalledTimes(2)
  })
  it("sin sesión o sin señal no manda nada", async () => {
    const a = armar({ usuario: null })
    await a.r.enviarToken()
    const b = armar({ online: false })
    await b.r.enviarToken()
    expect(a.post).not.toHaveBeenCalled()
    expect(b.post).not.toHaveBeenCalled()
  })
  it("permiso de avisos: se ve y se pide", async () => {
    const { r } = armar()
    await r.revisarPermiso()
    expect(r.permiso).toBe(false)
    expect(await r.pedirPermiso()).toBe(true)
    expect(r.permiso).toBe(true)
  })
})
