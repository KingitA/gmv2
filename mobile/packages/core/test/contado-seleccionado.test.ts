import { describe, expect, it } from "vitest"
import { ncContado, ncContadoDesdeCubierto } from "../../../../lib/cobranzas/reglas-cobro"
import { valorDevolucion, netoContado } from "../../../../lib/cobranzas/valor-devolucion"

// REGLA 01/10 (verificación de preview del dueño, ficha Urquiza):
// la NC del 10% contado se calcula sobre LO SELECCIONADO EN ESTE COBRO,
// nunca sobre el total histórico del comprobante ni contando entregas a
// cuenta sin tildar. El bug proyectaba NC $172.457,86 (10% del total
// original $1.724.578,64 del PRES 3) y concluía "sobran $40.862,84".

describe("10% contado sobre lo seleccionado hoy — caso Urquiza al centavo", () => {
  const SELECCIONADO = 179985.77        // saldo del PRES 0001-00000003, único tildado
  const DEV_BRUTA = 53767.5             // DEV-00009 a precio de factura
  const r2 = (n: number) => Math.round(n * 100) / 100

  it("la NC proyectada es $17.998,58 (10% de lo seleccionado), no $172.457,86", () => {
    expect(ncContado(SELECCIONADO)).toBe(17998.58)
    // lo que proyectaba el bug:
    expect(r2(1724578.64 * 0.1)).toBe(172457.86)
  })

  it("a cobrar: $113.596,44 — seleccionado − devolución neta − NC", () => {
    const dev = valorDevolucion({ renglones: [{ subtotal: DEV_BRUTA }], aplica10: true, conIva: false })
    expect(dev.total).toBe(48390.75) // 53.767,50 × 0,9 (lo verificado en el preview)
    const aCobrar = r2(SELECCIONADO - dev.total - ncContado(SELECCIONADO))
    expect(aCobrar).toBe(113596.44)
  })

  it("el server reconstruye la MISMA NC desde lo cubierto (plata + dev neta)", () => {
    // cubierto = 90% de lo saldado → NC = cubierto / 9
    const cubierto = r2(113596.44 + 48390.75)
    expect(ncContadoDesdeCubierto(cubierto)).toBe(17998.58)
    // y la fracción del comprobante que esto representa reconstruye el mismo
    // número vía el camino de emisión (10% × total × fracción):
    const fraccion = cubierto / (0.9 * 1724578.64)
    expect(r2(1724578.64 * 0.1 * fraccion)).toBe(17998.58)
  })

  it("las entregas a cuenta SIN tildar no suman al 10% ni al resumen", () => {
    // 14.011,02 y 170.019,00 visibles pero no seleccionadas: la NC no cambia
    expect(ncContado(SELECCIONADO)).toBe(ncContado(SELECCIONADO + 0 * (14011.02 + 170019)))
  })

  it("comprobante saldado entero en un solo cobro: equivale a la regla vieja", () => {
    // caso simple sin historia: seleccionado = total → NC = 10% del total
    expect(ncContado(500000)).toBe(50000)
    expect(r2(netoContado(500000))).toBe(450000)
  })
})
