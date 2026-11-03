import { describe, expect, it } from "vitest"
import { haySegsPedido, resumirSegmentos, segsAOverrides, segsDesdeServidor, segsParaServidor } from "../../../apps/vendedor/src/datos/segmentos"

// Lista y método POR SEGMENTO solo este pedido, desde "Confirmar pedido" (Juan, 03/11/2026).

const nombres: Record<string, string> = { neco: "Neco", viaj: "Viajante" }
const nombre = (id: string) => nombres[id] ?? null

describe("Segmentación solo este pedido", () => {
  it("lo elegido por segmento le gana a la ficha y no toca los demás segmentos", () => {
    const ficha = { lista_precio_id: "neco", metodo_facturacion: "Presupuesto" }
    const ov = segsAOverrides({ perf_plus: { metodo: "Factura" } })
    expect(ov).toEqual({ metodo_perf_plus_pedido: "Factura" })
    const r = resumirSegmentos(ficha, ov, nombre)
    expect(r.filas.map((f) => `${f.listaNombre} ${f.metodo} ${f.delPedido}`)).toEqual([
      "Neco Presupuesto false",
      "Neco Presupuesto false",
      "Neco Factura true",
    ])
    expect(r.uniforme).toBe(false)
  })

  it("sin segmentar, los tres van igual (el cuadro muestra una sola línea)", () => {
    const r = resumirSegmentos({ lista_precio_id: "neco", metodo_facturacion: "Presupuesto" }, {}, nombre)
    expect(r.uniforme).toBe(true)
    expect(r.incompleto).toBe(false)
  })

  it("al servidor viajan las 6 columnas solo si se tocó la segmentación", () => {
    expect(segsParaServidor(undefined)).toEqual({})
    expect(segsParaServidor({})).toEqual({
      lista_limpieza_pedido_id: null, metodo_limpieza_pedido: null,
      lista_perf0_pedido_id: null, metodo_perf0_pedido: null,
      lista_perf_plus_pedido_id: null, metodo_perf_plus_pedido: null,
    })
    const ida = segsParaServidor({ limpieza: { lista: "viaj" }, perf_plus: { metodo: "Factura" } })
    expect(ida.lista_limpieza_pedido_id).toBe("viaj")
    expect(ida.metodo_perf_plus_pedido).toBe("Factura")
    // y vuelve igual al retomar un pedido sin enviar
    expect(segsDesdeServidor(ida)).toEqual({ limpieza: { lista: "viaj" }, perf_plus: { metodo: "Factura" } })
    expect(segsDesdeServidor({ metodo_facturacion_pedido: "Final" })).toBeUndefined()
    expect(haySegsPedido({})).toBe(false)
    expect(haySegsPedido({ perf0: { metodo: "Final" } })).toBe(true)
  })
})
