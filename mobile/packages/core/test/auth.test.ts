import { describe, expect, it } from "vitest"
import { Auth, type AlmacenSeguro } from "../src/auth/auth"
import { crearAlmacenSeguro } from "../src/platform/almacen-seguro"
import { apiFalsa } from "./helpers"

const SESION = {
  access_token: "a", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "u1", email: "chofer@test" }, roles: ["chofer"],
}

/**
 * Plugin falso con la misma semántica que @aparajita/capacitor-secure-storage:
 * el prefijo es estado JS que se aplica de forma ASÍNCRONA (el plugin se carga
 * lazy en el arranque en frío) y get/set lo usan al momento de ejecutarse.
 */
function pluginFalso(datos: Map<string, string>, demoraPrefijoMs: number) {
  let prefijo = "capacitor-storage_"
  return {
    setKeyPrefix: (p: string) => new Promise<void>((r) => setTimeout(() => { prefijo = p; r() }, demoraPrefijoMs)),
    get: async (k: string) => datos.get(prefijo + k) ?? null,
    set: async (k: string, v: any) => void datos.set(prefijo + k, v),
    remove: async (k: string) => datos.delete(prefijo + k),
  } as any
}

describe("Sesión persistente", () => {
  it("regresión NuStar: en arranque en frío el get espera al prefijo (no busca con el prefijo por defecto)", async () => {
    const disco = new Map([["gm.chofer.gm.sesion", JSON.stringify(SESION)]]) // guardada en un login anterior
    const almacen = crearAlmacenSeguro("gm.chofer", pluginFalso(disco, 30))
    expect(await almacen.get("gm.sesion")).toBe(JSON.stringify(SESION))
  })

  it("restaura la sesión SIN red: no hace ningún request al iniciar", async () => {
    const disco = new Map([["gm.chofer.gm.sesion", JSON.stringify(SESION)]])
    const { api, llamadas } = apiFalsa(() => "red")
    const auth = new Auth(api, crearAlmacenSeguro("gm.chofer", pluginFalso(disco, 20)), "chofer")
    expect(await auth.iniciar()).toBe("autenticado")
    expect(auth.sesion?.user.id).toBe("u1")
    expect(llamadas.length).toBe(0)
  })

  it("una falla transitoria del Keystore se reintenta en vez de desloguear", async () => {
    let fallas = 2
    const almacen: AlmacenSeguro = {
      get: async () => {
        if (fallas-- > 0) throw new Error("KeyStore ocupado")
        return JSON.stringify(SESION)
      },
      set: async () => {},
      remove: async () => {},
    }
    const auth = new Auth(apiFalsa(() => "red").api, almacen, "chofer")
    expect(await auth.iniciar()).toBe("autenticado")
  })

  it("un token vencido offline NO desloguea (sigue operando con la sesión guardada)", async () => {
    const vencida = { ...SESION, expires_at: Math.floor(Date.now() / 1000) - 60 }
    const disco = new Map([["gm.chofer.gm.sesion", JSON.stringify(vencida)]])
    const auth = new Auth(apiFalsa(() => "red").api, crearAlmacenSeguro("gm.chofer", pluginFalso(disco, 0)), "chofer")
    await auth.iniciar()
    expect(await auth.accessToken()).toBe("a")
    expect(auth.estado).toBe("autenticado")
  })

  it("solo un 401 del servidor al renovar vuelve al login", async () => {
    const vencida = { ...SESION, expires_at: Math.floor(Date.now() / 1000) - 60 }
    const disco = new Map([["gm.chofer.gm.sesion", JSON.stringify(vencida)]])
    const auth = new Auth(apiFalsa(() => ({ status: 401, body: { error: "revocada" } })).api, crearAlmacenSeguro("gm.chofer", pluginFalso(disco, 0)), "chofer")
    await auth.iniciar()
    await auth.accessToken()
    expect(auth.estado).toBe("anonimo")
  })
})
