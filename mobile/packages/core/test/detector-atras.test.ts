import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DetectorWedge, esQrOUrl } from "../src/scanner/detector"
import { decidirAtras, padreDe } from "../src/nav/atras"

describe("DetectorWedge (lector keyboard-wedge)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function tipear(det: DetectorWedge, reloj: { t: number }, texto: string, gap: number) {
    for (const ch of texto) {
      reloj.t += gap
      det.tecla({ key: ch })
    }
  }

  it("ráfaga rápida + Enter ⇒ un código", () => {
    const leidos: string[] = []
    const reloj = { t: 0 }
    const det = new DetectorWedge((c) => leidos.push(c), {}, () => reloj.t)
    tipear(det, reloj, "7790001234567", 8)
    reloj.t += 8
    expect(det.tecla({ key: "Enter" })).toBe(true)
    expect(leidos).toEqual(["7790001234567"])
  })

  it("tecleo humano lento no dispara", () => {
    const leidos: string[] = []
    const reloj = { t: 0 }
    const det = new DetectorWedge((c) => leidos.push(c), {}, () => reloj.t)
    tipear(det, reloj, "12345", 250)
    reloj.t += 250
    expect(det.tecla({ key: "Enter" })).toBe(false)
    expect(leidos).toEqual([])
  })

  it("lector sin sufijo Enter: cierra por inactividad", () => {
    const leidos: string[] = []
    const reloj = { t: 0 }
    const det = new DetectorWedge((c) => leidos.push(c), {}, () => reloj.t)
    tipear(det, reloj, "ABC123", 5)
    vi.advanceTimersByTime(200)
    expect(leidos).toEqual(["ABC123"])
  })

  it("código más corto que minLength se descarta", () => {
    const leidos: string[] = []
    const reloj = { t: 0 }
    const det = new DetectorWedge((c) => leidos.push(c), { minLength: 5 }, () => reloj.t)
    tipear(det, reloj, "123", 5)
    det.tecla({ key: "Enter" })
    expect(leidos).toEqual([])
  })

  it("esQrOUrl distingue EAN de QR/URL", () => {
    expect(esQrOUrl("7790001234567")).toBe(false)
    expect(esQrOUrl("https://afip.gob.ar/fe/qr/?p=xyz")).toBe(true)
    expect(esQrOUrl("www.ejemplo.com")).toBe(true)
  })
})

describe("Botón atrás físico", () => {
  it("con historial propio ⇒ back", () => {
    expect(decidirAtras("/viajes/1", 2)).toEqual({ accion: "back" })
  })
  it("detalle abierto directo (sin historial) ⇒ padre lógico, nunca fuera del módulo", () => {
    expect(decidirAtras("/viajes/1/clientes/9", 0)).toEqual({ accion: "padre", a: "/viajes/1/clientes" })
    expect(decidirAtras("/viajes/1", 0)).toEqual({ accion: "padre", a: "/viajes" })
    expect(decidirAtras("/viajes", 0)).toEqual({ accion: "padre", a: "/" })
  })
  it("en la raíz ⇒ minimizar", () => {
    expect(decidirAtras("/", 0)).toEqual({ accion: "minimizar" })
    expect(decidirAtras("", 0)).toEqual({ accion: "minimizar" })
  })
  it("padreDe", () => {
    expect(padreDe("/a/b/c/")).toBe("/a/b")
    expect(padreDe("/a")).toBe("/")
  })
})
