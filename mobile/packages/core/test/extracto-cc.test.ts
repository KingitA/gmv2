import { describe, expect, it } from "vitest"
import { armarExtracto, esComprobanteConPdf, etiquetaMovimiento, type MovimientoCC } from "@gm/vendedor"

// Resumen de cuenta de la app (Cobrar → Resumen) = extracto del ERP: MISMO archivo
// (lib/cuenta-corriente/extracto.ts). Pedido del dueño 14/10/2026.
const mov = (m: Partial<MovimientoCC>): MovimientoCC => ({ fecha: "2026-10-01", tipo_movimiento: "factura", debe: 0, haber: 0, ...m })

describe("Extracto de cuenta (ERP y app)", () => {
  it("ordena por fecha y acumula debe − haber", () => {
    const e = armarExtracto([
      mov({ fecha: "2026-10-05", tipo_movimiento: "pago", haber: 400 }),
      mov({ fecha: "2026-10-01", debe: 1000 }),
      mov({ fecha: "2026-10-07", tipo_movimiento: "nota_credito", haber: 100 }),
    ])
    expect(e.map((m) => m.saldo_acumulado)).toEqual([1000, 600, 500])
  })

  it("rotula con el tipo REAL del comprobante (REV no es una NC fiscal) y la anulación de pago", () => {
    expect(etiquetaMovimiento(mov({ tipo_movimiento: "nota_credito", comprobante_tipo: "REV" }))).toBe("Reversa")
    expect(etiquetaMovimiento(mov({ tipo_movimiento: "nota_credito", comprobante_tipo: "NCA" }))).toBe("Nota de crédito A")
    expect(etiquetaMovimiento(mov({ tipo_movimiento: "presupuesto", comprobante_tipo: "PRES" }))).toBe("Presupuesto")
    expect(etiquetaMovimiento(mov({ tipo_movimiento: "ajuste", referencia_tipo: "pago_anulacion" }))).toBe("Anulación de pago")
    expect(etiquetaMovimiento(mov({ tipo_movimiento: "pago" }))).toBe("Pago")
  })

  it("solo los comprobantes de venta tienen PDF para abrir/compartir", () => {
    expect(esComprobanteConPdf(mov({ referencia_tipo: "comprobante_venta", referencia_id: "c1" }))).toBe(true)
    expect(esComprobanteConPdf(mov({ referencia_tipo: "pago", referencia_id: "p1" }))).toBe(false)
  })
})
