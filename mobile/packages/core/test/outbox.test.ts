import { describe, expect, it } from "vitest"
import { Outbox, backoffMs } from "../src/sync/outbox"
import { apiFalsa, dbNueva, type Manejador } from "./helpers"

/** Servidor falso con idempotencia real: aplica cada clave UNA vez. */
function servidor(opts: { fallar?: (n: number, body: any) => "red" | number | null } = {}) {
  const aplicadas = new Map<string, number>()
  let n = 0
  const manejador: Manejador = ({ body }) => {
    n++
    const f = opts.fallar?.(n, body)
    if (f === "red") return "red"
    if (typeof f === "number") return { status: f, body: { estado: f === 422 ? "rechazado" : undefined, error: `HTTP ${f}` } }
    const k = body.idempotency_key
    if (aplicadas.has(k)) return { status: 200, body: { estado: "duplicado", resultado: { id: aplicadas.get(k) } } }
    aplicadas.set(k, aplicadas.size + 1)
    return { status: 200, body: { estado: "aplicado", resultado: { id: aplicadas.get(k) } } }
  }
  return { manejador, aplicadas, get requests() { return n } }
}

function crear(db: any, manejador: Manejador, reloj = { t: 1_000_000 }, usuario: { id: string | null } = { id: "u1" }) {
  const { api, llamadas } = apiFalsa(manejador)
  const ob = new Outbox(db, api, { app: "chofer", deviceId: "dev-1", appVersion: "t", usuarioActual: () => usuario.id, autoEnviar: false }, () => reloj.t)
  return { ob, llamadas, reloj, usuario }
}

describe("Outbox", () => {
  it("O1: encolar persiste antes de devolver (sobrevive a un 'reinicio')", async () => {
    const db = await dbNueva()
    const { ob } = crear(db, () => "red")
    const it1 = await ob.encolar({ tipo: "prueba.registrar", payload: { texto: "hola" } })
    // "Reinicio": otra instancia sobre la misma base
    const { ob: ob2 } = crear(db, () => "red")
    await ob2.iniciar()
    const l = await ob2.lista()
    expect(l.map((i) => i.key)).toContain(it1.key)
    expect(ob2.contadores.pendientes).toBe(1)
  })

  it("O2: todos los reintentos mandan la MISMA clave y el servidor aplica una sola vez", async () => {
    const db = await dbNueva()
    const srv = servidor({ fallar: (n) => (n <= 2 ? "red" : null) })
    const { ob, llamadas, reloj } = crear(db, srv.manejador)
    const item = await ob.encolar({ tipo: "t", payload: { a: 1 } })
    await ob.enviar()
    for (let i = 0; i < 5; i++) {
      reloj.t += 10 * 60_000 // pasa el backoff
      await ob.enviar()
    }
    const claves = llamadas.filter((l) => l.path === "/api/mobile/outbox").map((l) => l.body.idempotency_key)
    expect(new Set(claves)).toEqual(new Set([item.key]))
    expect(srv.aplicadas.size).toBe(1)
    expect((await ob.item(item.key))!.estado).toBe("enviado")
  })

  it("O3: FIFO estricto — si el primero falla transitorio, el segundo espera", async () => {
    const db = await dbNueva()
    const srv = servidor({ fallar: (_n, body) => (body.payload.orden === 1 ? 503 : null) })
    const { ob, llamadas } = crear(db, srv.manejador)
    await ob.encolar({ tipo: "t", payload: { orden: 1 } })
    await ob.encolar({ tipo: "t", payload: { orden: 2 } })
    await ob.enviar()
    const enviados = llamadas.filter((l) => l.path === "/api/mobile/outbox").map((l) => l.body.payload.orden)
    expect(enviados.every((o) => o === 1)).toBe(true)
    expect(srv.aplicadas.size).toBe(0)
  })

  it("O3: respeta el backoff (no reintenta antes de tiempo)", async () => {
    const db = await dbNueva()
    const srv = servidor({ fallar: () => "red" })
    const { ob } = crear(db, srv.manejador)
    await ob.encolar({ tipo: "t", payload: {} })
    await ob.enviar()
    const n = srv.requests
    await ob.enviar()
    await ob.enviar()
    expect(srv.requests).toBe(n)
    expect(await ob.proximoReintentoEn()).toBeGreaterThan(0)
  })

  it("O4: rechazo definitivo no se reintenta y no bloquea a los siguientes", async () => {
    const db = await dbNueva()
    const srv = servidor({ fallar: (_n, body) => (body.payload.orden === 1 ? 422 : null) })
    const { ob, reloj } = crear(db, srv.manejador)
    const a = await ob.encolar({ tipo: "t", payload: { orden: 1 } })
    const b = await ob.encolar({ tipo: "t", payload: { orden: 2 } })
    await ob.enviar()
    reloj.t += 3600_000
    await ob.enviar()
    expect((await ob.item(a.key))!.estado).toBe("rechazado")
    expect((await ob.item(b.key))!.estado).toBe("enviado")
    expect(ob.contadores).toMatchObject({ pendientes: 0, rechazados: 1 })
    await ob.descartar(a.key)
    expect(ob.contadores.rechazados).toBe(0)
  })

  it("O4: un 409 reintentable (operación en vuelo en el servidor) se reintenta", async () => {
    const db = await dbNueva()
    let n = 0
    const { ob, reloj } = crear(db, ({ body }) => {
      n++
      if (n === 1) return { status: 409, body: { error: "procesando", reintentable: true } }
      return { status: 200, body: { estado: "aplicado", resultado: { k: body.idempotency_key } } }
    })
    const it = await ob.encolar({ tipo: "t", payload: {} })
    await ob.enviar()
    expect((await ob.item(it.key))!.estado).toBe("pendiente")
    reloj.t += 3600_000
    await ob.enviar()
    expect((await ob.item(it.key))!.estado).toBe("enviado")
  })

  it("O5: envíos concurrentes no duplican requests", async () => {
    const db = await dbNueva()
    const srv = servidor()
    const { ob, llamadas } = crear(db, async (r) => {
      await new Promise((res) => setTimeout(res, 10))
      return srv.manejador(r) as any
    })
    await ob.encolar({ tipo: "t", payload: { x: 1 } })
    await Promise.all([ob.enviar(), ob.enviar(), ob.enviar()])
    await ob.enviar()
    expect(llamadas.filter((l) => l.path === "/api/mobile/outbox").length).toBe(1)
  })

  it("O6: crash con 'enviando' ⇒ vuelve a pendiente y el reenvío se resuelve como duplicado sin duplicar", async () => {
    const db = await dbNueva()
    const srv = servidor()
    const { ob } = crear(db, srv.manejador)
    const it = await ob.encolar({ tipo: "t", payload: {} })
    await ob.enviar()
    // Simular: el servidor aplicó pero el dispositivo murió antes de marcar "enviado"
    await db.put("outbox", { ...(await ob.item(it.key))!, estado: "enviando", enviadoAt: null })
    const { ob: ob2 } = crear(db, srv.manejador)
    await ob2.iniciar()
    expect((await ob2.item(it.key))!.estado).toBe("pendiente")
    await ob2.enviar()
    expect((await ob2.item(it.key))!.estado).toBe("enviado")
    expect(srv.aplicadas.size).toBe(1)
  })

  it("O8: solo envía operaciones del usuario logueado", async () => {
    const db = await dbNueva()
    const srv = servidor()
    const usuario = { id: "u1" as string | null }
    const { ob } = crear(db, srv.manejador, { t: 1_000_000 }, usuario)
    usuario.id = null
    await expect(ob.encolar({ tipo: "t", payload: {} })).rejects.toThrow() // sin sesión no se captura
    usuario.id = "u1"
    const deU1 = await ob.encolar({ tipo: "t", payload: {} })
    const deU1b = await ob.encolar({ tipo: "t", payload: { b: 1 } })
    usuario.id = "u2"
    await ob.enviar()
    expect((await ob.item(deU1b.key))!.estado).toBe("pendiente")
    usuario.id = "u1"
    await ob.enviar()
    expect((await ob.item(deU1b.key))!.estado).toBe("enviado")
    expect((await ob.item(deU1.key))!.estado).toBe("enviado")
  })

  it("O8 (turnos): lo que capturó otro usuario se envía con SU sesión aparcada, sin frenar al actual", async () => {
    const db = await dbNueva()
    const tokens: string[] = []
    const srv = servidor()
    const { api } = apiFalsa((req) => {
      tokens.push(req.headers.Authorization || "(sesión activa)")
      return srv.manejador(req)
    })
    const usuario = { id: "u1" as string | null }
    const aparcadas = new Map<string, string | null>([["u1", "token-u1"], ["u3", null]])
    const ob = new Outbox(
      db, api,
      { app: "deposito", deviceId: "d", appVersion: "t", autoEnviar: false, usuarioActual: () => usuario.id, tokenDe: async (uid) => aparcadas.get(uid) ?? null },
      () => 1_000_000,
    )
    const deU1 = await ob.encolar({ tipo: "t", payload: { de: "u1" } })
    usuario.id = "u3"
    const deU3 = await ob.encolar({ tipo: "t", payload: { de: "u3" } })
    usuario.id = "u2" // cambio de turno: u1 y u3 dejaron pendientes
    const deU2 = await ob.encolar({ tipo: "t", payload: { de: "u2" } })
    await ob.enviar()
    expect((await ob.item(deU1.key))!.estado).toBe("enviado") // con su sesión aparcada
    expect((await ob.item(deU2.key))!.estado).toBe("enviado") // el actual no quedó frenado
    expect((await ob.item(deU3.key))!.estado).toBe("pendiente") // sin sesión aparcada: espera a que vuelva
    expect(tokens).toEqual(["Bearer token-u1", "(sesión activa)"])
    expect(await ob.usuariosConPendientes()).toEqual(new Set(["u3"]))
  })

  it("O9: el parche de réplica (onAplicado) corre ANTES de marcar el item enviado", async () => {
    const db = await dbNueva()
    const { ob } = crear(db, servidor().manejador)
    const it1 = await ob.encolar({ tipo: "t", payload: {} })
    let estadoDurante: string | undefined
    ob.onAplicado(async (item) => {
      await new Promise((r) => setTimeout(r, 5))
      estadoDurante = (await ob.item(item.key))!.estado
    })
    await ob.enviar()
    expect(estadoDurante).toBe("enviando")
    expect((await ob.item(it1.key))!.estado).toBe("enviado")
    expect(ob.noEnviadosSync).toEqual([])
  })

  it("noEnviados: pendientes y rechazados en orden, sin los enviados", async () => {
    const db = await dbNueva()
    const srv = servidor({ fallar: (_n, body) => (body.payload.x === 2 ? 422 : body.payload.x === 3 ? 503 : null) })
    const { ob } = crear(db, srv.manejador)
    for (const x of [1, 2, 3, 4]) await ob.encolar({ tipo: "t", payload: { x } })
    await ob.enviar()
    expect((await ob.noEnviados()).map((i) => [(i.payload as any).x, i.estado])).toEqual([[2, "rechazado"], [3, "pendiente"], [4, "pendiente"]])
    expect(ob.noEnviadosSync.length).toBe(3)
  })

  it("forzar: al volver la señal no se espera el backoff acumulado (y sin forzar, sí)", async () => {
    const db = await dbNueva()
    let caida = true
    const srv = servidor({ fallar: () => (caida ? "red" : null) })
    const { ob, reloj } = crear(db, srv.manejador)
    const item = await ob.encolar({ tipo: "t", payload: {} })
    for (let i = 0; i < 6; i++) { reloj.t += 10 * 60_000; await ob.enviar() } // 6 intentos fallidos ⇒ backoff largo
    caida = false
    await ob.enviar()
    expect((await ob.item(item.key))!.estado).toBe("pendiente") // respeta el backoff
    await ob.enviar({ forzar: true })
    expect((await ob.item(item.key))!.estado).toBe("enviado")
    expect(srv.aplicadas.size).toBe(1)
  })

  it("retirar: una operación que no salió se retira para corregirla; una enviada no", async () => {
    const db = await dbNueva()
    const srv = servidor()
    const { ob } = crear(db, srv.manejador)
    const a = await ob.encolar({ tipo: "pedido.crear", payload: { local_id: "L1", n: 1 } })
    const b = await ob.encolar({ tipo: "pedido.crear", payload: { local_id: "L2", n: 1 } })
    const retirada = await ob.retirar(a.key)
    expect(retirada?.key).toBe(a.key)
    expect(ob.contadores.pendientes).toBe(1)
    await ob.enviar()
    expect(srv.aplicadas.has(a.key)).toBe(false) // nunca viajó
    expect(srv.aplicadas.has(b.key)).toBe(true)
    expect(await ob.retirar(b.key)).toBeNull() // ya enviada: no se toca
    expect((await ob.item(b.key))?.estado).toBe("enviado")
    // La corrección es una operación NUEVA (clave nueva) con el mismo id lógico
    const a2 = await ob.encolar({ tipo: "pedido.crear", payload: { local_id: "L1", n: 2 } })
    expect(a2.key).not.toBe(a.key)
  })

  it("backoff crece exponencial con tope de 5 min", () => {
    expect(backoffMs(1, 0.5)).toBe(2000)
    expect(backoffMs(2, 0.5)).toBe(4000)
    expect(backoffMs(20, 0.5)).toBe(300_000)
  })
})
