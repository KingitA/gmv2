import { describe, expect, it } from "vitest"
import { borradorVacio, sanearMetodosRestaurados } from "../../../apps/chofer/src/datos/borrador-cobro"
import { estadoCuentaVacio, separarPorViaje } from "../../../apps/chofer/src/datos/cuenta-cobro"
import type { CuentaCobro } from "../../../apps/chofer/src/datasets"

// App Chofer v0.3.1 (21/10/2026): lo que pidió el dueño después de mirar la pasada con ojos de chofer.

describe("Chofer v0.3.1 · borrador del cobro", () => {
  it("vacío = nada seleccionado, sin agregados y solo un efectivo en 0 (no vale la pena guardarlo)", () => {
    expect(borradorVacio({ cuenta: estadoCuentaVacio(), agregados: [], metodosPago: [{ tipo: "efectivo", monto: 0 }] })).toBe(true)
    expect(borradorVacio({ cuenta: { ...estadoCuentaVacio(), sel: { fa1: 100 } }, agregados: [], metodosPago: [{ tipo: "efectivo", monto: 0 }] })).toBe(false)
    expect(borradorVacio({ cuenta: estadoCuentaVacio(), agregados: [], metodosPago: [{ tipo: "cheque", monto: 0 }] })).toBe(false)
    expect(borradorVacio({ cuenta: estadoCuentaVacio(), agregados: [], metodosPago: [{ tipo: "efectivo", monto: 500 }] })).toBe(false)
    expect(borradorVacio({ cuenta: { ...estadoCuentaVacio(), aCuenta: 10 }, agregados: [], metodosPago: [] })).toBe(false)
  })

  it("al restaurar, una foto que no llegó al bucket se da por perdida (los datos del cheque quedan); una subida se conserva", () => {
    const ocr = (estado: string, foto_url: string | null, foto_local: string | null) => ({ estado, foto_url, foto_local, detalle: null })
    const [leyendo, subida, sinFoto, efectivo] = sanearMetodosRestaurados([
      { tipo: "cheque", monto: 100, numero_cheque: "1", ocr: ocr("leyendo", null, "blob:x") },
      { tipo: "cheque", monto: 200, numero_cheque: "2", ocr: ocr("ok", "https://bucket/foto.jpg", "blob:y") },
      { tipo: "cheque", monto: 300, numero_cheque: "3", ocr: ocr("sin_foto", null, null) },
      { tipo: "efectivo", monto: 400 },
    ] as any[])
    expect(leyendo.ocr.estado).toBe("fallo")
    expect(leyendo.ocr.detalle).toMatch(/sacala de nuevo/)
    expect(leyendo.ocr.foto_local).toBeNull()
    expect(leyendo.numero_cheque).toBe("1")
    expect(subida.ocr).toMatchObject({ estado: "ok", foto_url: "https://bucket/foto.jpg", foto_local: null })
    expect(sinFoto.ocr.estado).toBe("sin_foto")
    expect(efectivo).toEqual({ tipo: "efectivo", monto: 400 })
  })
})

describe("Chofer v0.3.1 · lo de este viaje primero", () => {
  const cobro: CuentaCobro = {
    comprobantes: [],
    pedidos: [
      { id: "viejo1", numero_pedido: "000100", fecha: "2026-05-01", total: 1000, estado: "impreso" },
      { id: "hoy", numero_pedido: "001640", fecha: "2026-10-21", total: 5000, estado: "en_viaje" },
      { id: "viejo2", numero_pedido: "000200", fecha: "2026-06-01", total: 2000, estado: "impreso" },
    ],
    pedidos_facturados: [],
    dtos_hechos: [],
  }
  it("separa el pedido del viaje de los anteriores, conservando el orden", () => {
    const { delViaje, anteriores } = separarPorViaje(cobro, ["hoy"])
    expect(delViaje.map((p) => p.id)).toEqual(["hoy"])
    expect(anteriores.map((p) => p.id)).toEqual(["viejo1", "viejo2"])
  })
  it("sin pedidos del viaje (cliente agregado de afuera), todo es 'anterior'", () => {
    const { delViaje, anteriores } = separarPorViaje(cobro, [])
    expect(delViaje).toEqual([])
    expect(anteriores).toHaveLength(3)
  })
})
