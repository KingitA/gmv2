import { describe, expect, it } from "vitest"
import type { RespuestaSync } from "@gm/contrato"
import { Replica } from "../src/sync/replica"
import { apiFalsa, dbNueva } from "./helpers"

const snap = (upserts: any[], cursor = "s:1"): RespuestaSync => ({
  dataset: "ds", modo: "snapshot", cursor, generado_at: "2026-09-18T17:30:00.000Z", sin_cambios: false, upserts, deletes: [],
})
const delta = (upserts: any[], deletes: string[], cursor: string): RespuestaSync => ({
  dataset: "ds", modo: "delta", cursor, generado_at: "2026-09-18T17:35:00.000Z", sin_cambios: false, upserts, deletes,
})

describe("Replica", () => {
  it("R2: snapshot reemplaza el dataset entero", async () => {
    const db = await dbNueva()
    const { api } = apiFalsa(() => ({ status: 500, body: {} }))
    const r = new Replica(db, api)
    await r.aplicar("ds", snap([{ id: "a", v: 1 }, { id: "b", v: 1 }]))
    await r.aplicar("ds", snap([{ id: "c", v: 2 }], "s:2"))
    expect((await r.todas("ds")).map((x: any) => x.id)).toEqual(["c"])
    expect((await r.meta("ds"))!.count).toBe(1)
  })

  it("R2: delta aplica solo upserts y deletes", async () => {
    const db = await dbNueva()
    const r = new Replica(db, apiFalsa(() => ({ status: 500, body: {} })).api)
    await r.aplicar("ds", snap([{ id: "a", v: 1 }, { id: "b", v: 1 }]))
    await r.aplicar("ds", delta([{ id: "a", v: 9 }, { id: "z", v: 1 }], ["b", "no-existe"], "d:10:"))
    const filas = (await r.todas<any>("ds")).sort((x, y) => x.id.localeCompare(y.id))
    expect(filas).toEqual([{ id: "a", v: 9 }, { id: "z", v: 1 }])
    expect((await r.meta("ds"))!.cursor).toBe("d:10:")
  })

  it("R1/R3: una respuesta inválida no deja la réplica a medias ni mueve el cursor", async () => {
    const db = await dbNueva()
    const r = new Replica(db, apiFalsa(() => ({ status: 500, body: {} })).api)
    await r.aplicar("ds", snap([{ id: "a", v: 1 }], "s:ok"))
    // Fila sin id en medio del lote ⇒ la transacción entera se aborta
    await expect(r.aplicar("ds", snap([{ id: "x", v: 2 }, { v: 3 } as any], "s:malo"))).rejects.toThrow()
    expect(await r.todas("ds")).toEqual([{ id: "a", v: 1 }])
    expect((await r.meta("ds"))!.cursor).toBe("s:ok")
  })

  it("R4: un error de red no borra datos y queda registrado en meta.error", async () => {
    const db = await dbNueva()
    const { api } = apiFalsa(() => "red")
    const r = new Replica(db, api)
    await r.aplicar("ds", snap([{ id: "a", v: 1 }]))
    await expect(r.sincronizar("ds")).rejects.toThrow()
    expect(await r.todas("ds")).toEqual([{ id: "a", v: 1 }])
    const m = await r.meta("ds")
    expect(m!.error).toBeTruthy()
    expect(m!.generadoAt).toBe("2026-09-18T17:30:00.000Z")
  })

  it("R3: manda el cursor guardado y avanza con la respuesta", async () => {
    const db = await dbNueva()
    const { api, llamadas } = apiFalsa(({ path }) =>
      path.includes("cursor=d%3A5%3A")
        ? { status: 200, body: delta([{ id: "b" }], [], "d:7:") }
        : { status: 200, body: { ...snap([{ id: "a" }], "d:5:"), dataset: "ds" } },
    )
    const r = new Replica(db, api)
    await r.sincronizar("ds")
    await r.sincronizar("ds")
    expect(llamadas[0].path).toBe("/api/mobile/sync/ds")
    expect(llamadas[1].path).toBe("/api/mobile/sync/ds?cursor=d%3A5%3A")
    expect((await r.meta("ds"))!.cursor).toBe("d:7:")
    expect((await r.todas<any>("ds")).map((f) => f.id).sort()).toEqual(["a", "b"])
  })

  it("R5: syncs concurrentes del mismo dataset comparten un solo request", async () => {
    const db = await dbNueva()
    const { api, llamadas } = apiFalsa(async () => {
      await new Promise((res) => setTimeout(res, 20))
      return { status: 200, body: snap([{ id: "a" }]) }
    })
    const r = new Replica(db, api)
    await Promise.all([r.sincronizar("ds"), r.sincronizar("ds"), r.sincronizar("ds")])
    expect(llamadas.length).toBe(1)
  })

  it("R6: la frescura es la hora del servidor, sin_cambios la renueva sin tocar filas", async () => {
    const db = await dbNueva()
    const r = new Replica(db, apiFalsa(() => ({ status: 500, body: {} })).api)
    await r.aplicar("ds", snap([{ id: "a" }], "s:h"))
    await r.aplicar("ds", { ...snap([], "s:h"), sin_cambios: true, generado_at: "2026-09-18T18:00:00.000Z" })
    expect(await r.todas("ds")).toEqual([{ id: "a" }])
    expect((await r.meta("ds"))!.generadoAt).toBe("2026-09-18T18:00:00.000Z")
  })

  it("los datasets son independientes", async () => {
    const db = await dbNueva()
    const r = new Replica(db, apiFalsa(() => ({ status: 500, body: {} })).api)
    await r.aplicar("uno", { ...snap([{ id: "a" }]), dataset: "uno" })
    await r.aplicar("dos", { ...snap([{ id: "a" }, { id: "b" }]), dataset: "dos" })
    await r.aplicar("uno", { ...snap([]), dataset: "uno" })
    expect(await r.todas("uno")).toEqual([])
    expect((await r.todas("dos")).length).toBe(2)
  })

  it("parchear: aplica filas del servidor sin mover el cursor ni la frescura (R3/R6)", async () => {
    const db = await dbNueva()
    const r = new Replica(db, apiFalsa(() => ({ status: 500, body: {} })).api)
    await r.aplicar("ds", snap([{ id: "a", v: 1 }, { id: "b", v: 1 }], "d:7:h"))
    const antes = (await r.meta("ds"))!
    let avisos = 0
    r.suscribir("ds", () => avisos++)
    await r.parchear("ds", [{ id: "a", v: 2 }], ["b"])
    expect(await r.todas<any>("ds")).toEqual([{ id: "a", v: 2 }])
    const despues = (await r.meta("ds"))!
    expect(despues.cursor).toBe(antes.cursor)
    expect(despues.generadoAt).toBe(antes.generadoAt)
    expect(despues.count).toBe(1)
    expect(avisos).toBe(1)
  })
})

