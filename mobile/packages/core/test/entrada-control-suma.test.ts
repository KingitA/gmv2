// E-46 — regla de Juan (17/11): los renglones tienen que sumar el neto, y neto + impuestos el total.
import { describe, expect, it } from "vitest"
import { controlSuma, TOLERANCIA_SUMA_PESOS } from "../../../../lib/compras/control-suma"

const fa = (extra: Record<string, unknown> = {}) => ({ tipo_comprobante: "FA", numero_comprobante: "0001-1", total_factura_declarado: 24.2, total_neto: 20, total_iva: 4.2, ...extra })
const ren = (cantidad: number, precio: number, d1 = 0) => ({ cantidad_facturada: cantidad, precio_unitario: precio, descuento1: d1 })

describe("los renglones suman el neto", () => {
  it("dos ítems de $10 suman $20: cierra", () => {
    expect(controlSuma(fa(), [ren(1, 10), ren(1, 10)]).ok).toBe(true)
  })
  it("el subtotal dice $21: NO cierra, y dice cuánto falta", () => {
    const r = controlSuma(fa({ total_neto: 21, total_iva: 4.41, total_factura_declarado: 25.41 }), [ren(1, 10), ren(1, 10)])
    expect(r.ok).toBe(false)
    expect(r.faltas[0]).toBe("Los renglones suman $20,00 y la factura dice $21,00 neto: falta $1,00. Revisá los renglones leídos.")
    expect([r.neto_renglones, r.neto_comprobante]).toEqual([20, 21])
  })
  it("centavos de redondeo se toleran; un peso entero ya no", () => {
    expect(TOLERANCIA_SUMA_PESOS).toBe(1)
    expect(controlSuma(fa({ total_neto: 20.4, total_iva: 4.28, total_factura_declarado: 24.68 }), [ren(1, 10), ren(1, 10)]).ok).toBe(true)
    expect(controlSuma(fa({ total_neto: 21.01, total_iva: 4.41, total_factura_declarado: 25.42 }), [ren(1, 10), ren(1, 10)]).ok).toBe(false)
  })
  it("sobra un renglón (leído dos veces)", () => {
    const r = controlSuma(fa(), [ren(1, 10), ren(1, 10), ren(1, 10)])
    expect(r.faltas[0]).toMatch(/sobra \$10,00/)
  })
  it("el flete marcado 'no es mercadería' también suma: $100 + 3 de flete = $103 neto", () => {
    const c = fa({ total_neto: 103, total_iva: 21.63, total_factura_declarado: 124.63 })
    expect(controlSuma(c, [ren(1, 100), ren(1, 3)]).ok).toBe(true)
    expect(controlSuma(c, [ren(1, 100)]).ok).toBe(false)
  })
  it("descuentos de línea y caso real (48 × 1.812,50 − 20 %)", () => {
    const c = fa({ total_neto: 69600, total_iva: 14616, total_factura_declarado: 84216 })
    expect(controlSuma(c, [ren(48, 1812.5, 20)]).ok).toBe(true)
  })
  it("factura sin renglones: no se puede validar", () => {
    const r = controlSuma(fa(), [])
    expect(r.ok).toBe(false)
    expect(r.faltas[0]).toMatch(/no tiene renglones/)
  })
  it("descuento al pie en %: cierra contra el neto ya descontado", () => {
    const c = fa({ total_neto: 18, total_iva: 3.78, total_factura_declarado: 21.78, descuento_fuera_factura: 10 })
    expect(controlSuma(c, [ren(1, 10), ren(1, 10)]).ok).toBe(true)
  })
})

describe("neto + impuestos = total", () => {
  it("con percepciones", () => {
    const c = fa({ total_neto: 1000, total_iva: 210, percepcion_iva_monto: 30, percepcion_iibb_monto: 25, total_factura_declarado: 1265 })
    expect(controlSuma(c, [ren(10, 100)]).ok).toBe(true)
  })
  it("el total no da: lo dice con los dos números", () => {
    const r = controlSuma(fa({ total_neto: 1000, total_iva: 210, total_factura_declarado: 1300 }), [ren(10, 100)])
    expect(r.ok).toBe(false)
    expect(r.faltas[0]).toMatch(/da \$1\.210,00 y el total del comprobante dice \$1\.300,00: falta \$90,00/)
  })
  it("adquisición (sin IVA): neto = total", () => {
    expect(controlSuma({ tipo_comprobante: "Adquisicion", total_factura_declarado: 500, total_neto: 500, total_iva: 0 }, [ren(5, 100)]).ok).toBe(true)
  })
  it("sin neto cargado: se deduce del total menos los impuestos", () => {
    expect(controlSuma({ tipo_comprobante: "FA", total_factura_declarado: 121, total_neto: 0, total_iva: 21 }, [ren(1, 100)]).ok).toBe(true)
  })
  it("nota de crédito sin renglones: solo se controla el total", () => {
    expect(controlSuma({ tipo_comprobante: "NC", total_factura_declarado: 121, total_neto: 100, total_iva: 21 }, []).ok).toBe(true)
    expect(controlSuma({ tipo_comprobante: "NC", total_factura_declarado: 150, total_neto: 100, total_iva: 21 }, []).ok).toBe(false)
  })
  it("remito: no se controla nada", () => {
    expect(controlSuma({ tipo_comprobante: "Remito", total_factura_declarado: 0 }, [ren(4, 0)]).ok).toBe(true)
  })
})
