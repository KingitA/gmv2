// Vincular renglones de factura con artículos de la orden de compra (lib/compras/coincidencia-oc.ts).
// Datos reales de la OC-000014 (La Mariposa, factura 0006-00026190): los 6 coinciden con uno solo.
import { describe, expect, it } from "vitest"
import { articulosQueCoinciden, coincidencia, precioParecido, vinculosAutomaticos } from "../../../../lib/compras/coincidencia-oc"

const OC = [
  { articulo_id: "tricolor", cantidad_pedida: 90, tipo_cantidad: "bulto", unidades_por_bulto: 20, precio_unitario: 767.33 },
  { articulo_id: "blanco200", cantidad_pedida: 60, tipo_cantidad: "bulto", unidades_por_bulto: 40, precio_unitario: 433.05 },
  { articulo_id: "crema", cantidad_pedida: 54, tipo_cantidad: "bulto", unidades_por_bulto: 20, precio_unitario: 805.61 },
  { articulo_id: "flores", cantidad_pedida: 14, tipo_cantidad: "bulto", unidades_por_bulto: 20, precio_unitario: 1193.58 },
  { articulo_id: "maxima", cantidad_pedida: 40, tipo_cantidad: "bulto", unidades_por_bulto: 48, precio_unitario: 363.91 },
  { articulo_id: "neutro", cantidad_pedida: 18, tipo_cantidad: "bulto", unidades_por_bulto: 20, precio_unitario: 1111.34 },
]
const FACTURA = [
  { id: "r1", cantidad: 90, precio: 15346.61, esperado: "tricolor" },
  { id: "r2", cantidad: 60, precio: 17322.13, esperado: "blanco200" },
  { id: "r3", cantidad: 54, precio: 16112.19, esperado: "crema" },
  { id: "r4", cantidad: 14, precio: 23871.55, esperado: "flores" },
  { id: "r5", cantidad: 40, precio: 17467.84, esperado: "maxima" },
  { id: "r6", cantidad: 18, precio: 22226.73, esperado: "neutro" },
]

describe("coincidencia con la orden de compra", () => {
  it("tolerancia de precio: 0,5 % o $1, lo que sea mayor", () => {
    expect(precioParecido(15346.61, 15346.6)).toBe(true)
    expect(precioParecido(100, 100.99)).toBe(true) // $1 gana sobre 0,5 % ($0,50)
    expect(precioParecido(100, 101.5)).toBe(false)
    expect(precioParecido(10000, 10049)).toBe(true) // 0,5 % = $50
    expect(precioParecido(10000, 10051)).toBe(false)
    expect(precioParecido(0, 0)).toBe(false)
  })

  it("OC-000014: cada renglón coincide con un solo artículo, por bulto", () => {
    for (const r of FACTURA) {
      const c = articulosQueCoinciden(r, OC)
      expect(c.map((a) => a.articulo_id)).toEqual([r.esperado])
      expect(coincidencia(r, c[0])).toBe("bulto")
    }
    const auto = vinculosAutomaticos(FACTURA, OC)
    expect(auto.size).toBe(6)
    for (const r of FACTURA) expect(auto.get(r.id)).toBe(r.esperado)
  })

  it("factura en unidades y precio por unidad", () => {
    expect(coincidencia({ cantidad: 1800, precio: 767.4 }, OC[0])).toBe("unidad")
    // cantidad en unidades pero precio por bulto: no coincide
    expect(coincidencia({ cantidad: 1800, precio: 15346.6 }, OC[0])).toBeNull()
  })

  it("renglón de la orden pedido en unidades", () => {
    const a = { articulo_id: "x", cantidad_pedida: 240, tipo_cantidad: "unidad", unidades_por_bulto: 12, precio_unitario: 100 }
    expect(coincidencia({ cantidad: 20, precio: 1200 }, a)).toBe("bulto")
    expect(coincidencia({ cantidad: 240, precio: 100 }, a)).toBe("unidad")
  })

  it("no se vincula solo si coincide con más de uno, si dos renglones van al mismo o si ya está vinculado", () => {
    const dobles = [...OC, { articulo_id: "tricolor-bis", cantidad_pedida: 90, tipo_cantidad: "bulto", unidades_por_bulto: 20, precio_unitario: 767.33 }]
    expect(vinculosAutomaticos([FACTURA[0]], dobles).size).toBe(0)
    expect(vinculosAutomaticos([FACTURA[0], { ...FACTURA[0], id: "r1b" }], OC).size).toBe(0)
    expect(vinculosAutomaticos([FACTURA[0]], OC, ["tricolor"]).size).toBe(0)
    expect(vinculosAutomaticos([{ id: "z", cantidad: 7, precio: 99 }], OC).size).toBe(0)
  })
})
