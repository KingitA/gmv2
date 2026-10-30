import { describe, expect, it } from "vitest"
import { abrirPrecioFinal, valorDevolucion, valorDevolucionConOrigen, type OrigenDevolucion } from "../../../../lib/cobranzas/valor-devolucion"

// P2-48 (regla de Juan, 29/10): lo devuelto de una factura del sistema viejo (sin detalle) sale
// por el precio FINAL justo, con neto + IVA + percepciones ADENTRO. Exacto al centavo:
// ARCA valida ImpTotal = ImpNeto + ImpIva + ImpTrib.
const cent = (n: number) => Math.round(n * 100)
const cierra = (v: ReturnType<typeof valorDevolucion>) =>
  cent(v.fiscal.neto) + cent(v.fiscal.iva) + cent(v.fiscal.percepcionIva) + cent(v.fiscal.percepcionIibb) === cent(v.fiscal.total)

const sinRenglon = (o: Partial<OrigenDevolucion> = {}): OrigenDevolucion => ({
  comprobante_venta_id: null, tipo_comprobante: null, numero_comprobante: null, fiscal: true,
  percepcion_iva: false, bonificado_contado: false, exacto: false, precio: null, iva_unitario: null, ...o,
})

describe("NC por devolución de factura del sistema viejo: precio final con todo adentro", () => {
  it("$100 final con IIBB 3 %: la NC da $100 justos, no $100 + percepciones", () => {
    const v = valorDevolucionConOrigen([{ cantidad: 1, precio_venta_original: 100, origen: sinRenglon() }], 3)
    expect(v.fiscal.total).toBe(100)
    expect(v.total).toBe(100)
    // el centavo de redondeo va a la percepción IIBB: el IVA queda 21 % exacto de su neto
    expect(v.fiscal).toMatchObject({ neto: 80.65, iva: 16.94, percepcionIibb: 2.41, percepcionIva: 0 })
    expect(cierra(v)).toBe(true)
  })

  it("con percepción IVA (la factura vieja la llevaba) también cierra al centavo", () => {
    const v = valorDevolucionConOrigen([{ cantidad: 3, precio_venta_original: 1234.57, origen: sinRenglon({ percepcion_iva: true }) }], 3.5)
    expect(v.fiscal.total).toBe(3703.71)
    expect(v.fiscal.percepcionIva).toBeGreaterThan(0)
    expect(v.fiscal.baseIva).toBe(v.fiscal.neto)
    expect(cierra(v)).toBe(true)
  })

  it("barrido: cualquier precio y alícuota cierra exacto", () => {
    for (let c = 1; c < 30000; c += 137) {
      for (const a of [0, 1.5, 3, 4.75]) {
        for (const p of [false, true]) {
          const final = c / 100
          const x = abrirPrecioFinal(final, { percepcionIva: p, alicuotaIIBB: a })
          expect(cent(x.neto) + cent(x.iva) + cent(x.percepcionIva) + cent(x.percepcionIibb)).toBe(c)
          // con alguna percepción el centavo de redondeo va ahí: el IVA es el 21 % de su neto
          if (p || a > 0) expect(x.iva).toBe(Math.round(((x.neto * 21) / 100) * 100) / 100)
        }
      }
    }
  })

  it("10 % contado: el final ya bonificado es el total (900 de 1.000)", () => {
    const v = valorDevolucionConOrigen([{ cantidad: 10, precio_venta_original: 100, origen: sinRenglon({ bonificado_contado: true }) }], 3)
    expect(v.fiscal.total).toBe(900)
    expect(cierra(v)).toBe(true)
  })

  it("mezclado con un renglón facturado en gmv2: ese sigue tal cual facturado (caso c)", () => {
    const exacto = sinRenglon({ exacto: true, percepcion_iva: true, bonificado_contado: true, precio: 100, comprobante_venta_id: "fa1" })
    const soloGmv2 = valorDevolucionConOrigen([{ cantidad: 10, precio_venta_original: 100, origen: exacto }], 3)
    expect(soloGmv2.fiscal.total).toBe(1143) // 900 + 189 + 27 + 27, regla 21/10 sin cambios
    const mixto = valorDevolucionConOrigen(
      [
        { cantidad: 10, precio_venta_original: 100, origen: exacto },
        { cantidad: 1, precio_venta_original: 100, origen: sinRenglon() },
      ],
      3,
    )
    expect(mixto.fiscal.total).toBe(1243)
    expect(cierra(mixto)).toBe(true)
  })
})
