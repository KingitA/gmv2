import { describe, expect, it } from "vitest"
import { valorDevolucion, netoContado, valorDevolucionConOrigen, elegirOrigenDevolucion, origenDesdeComprado, type OrigenDevolucion } from "../../../../lib/cobranzas/valor-devolucion"

// Regla del dueño (29/09/2026): en cobro contado con 10%, la mercadería
// devuelta se computa NETA del mismo 10%, para coincidir al centavo con la
// NC futura. Los dos casos documentados de sus pruebas, al centavo.

describe("valorDevolucion — regla del 10% contado", () => {
  it("caso (a): factura $500.000 contado, devolución $10.000 → vale $9.000 y se cobran $441.000", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10000 }], aplica10: true, conIva: false })
    expect(v.total).toBe(9000)
    const aCobrar = Math.round((netoContado(500000) - v.total) * 100) / 100
    expect(aCobrar).toBe(441000) // el sistema viejo mostraba 440.000
  })

  it("caso (b): pedido $260.930,88 contado, devolución $10.491,36 → a cobrar $225.395,57", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10491.36 }], aplica10: true, conIva: false })
    expect(v.total).toBe(9442.22) // 10.491,36 × 0,9
    const aCobrar = Math.round((netoContado(260930.88) - v.total) * 100) / 100
    expect(aCobrar).toBe(225395.57) // (260.930,88 − 10.491,36) × 0,9; el sistema hacía 224.346,43
  })

  it("sin 10%: la devolución vale el precio pleno de factura", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10000 }], aplica10: false, conIva: false })
    expect(v.total).toBe(10000)
  })

  it("fiscal: IVA discriminado sobre el neto YA bonificado, por renglón", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 1000 }, { subtotal: 2000 }], aplica10: true, conIva: true })
    expect(v.netoPorRenglon).toEqual([900, 1800])
    expect(v.neto).toBe(2700)
    expect(v.iva).toBe(567) // 21% de 2.700
    expect(v.total).toBe(3267)
  })

  it("redondeo por renglón (como el detalle de la NC), no sobre la suma", () => {
    // 3 renglones de $33,33: por renglón 0,9×33,33 = 29,997 → 30,00 c/u
    const v = valorDevolucion({ renglones: [{ subtotal: 33.33 }, { subtotal: 33.33 }, { subtotal: 33.33 }], aplica10: true, conIva: false })
    expect(v.netoPorRenglon).toEqual([30, 30, 30])
    expect(v.total).toBe(90)
  })
})

// Regla del dueño (21/10/2026): la NC/REV de una devolución sale TAL CUAL FUE FACTURADA,
// ni un centavo más ni uno menos. Cada renglón según SU comprobante de origen.
const fa = (o: Partial<OrigenDevolucion> = {}): OrigenDevolucion => ({
  comprobante_venta_id: "fa1", tipo_comprobante: "FA", numero_comprobante: "0007-00000001",
  fiscal: true, percepcion_iva: true, bonificado_contado: true, exacto: true, precio: 100, iva_unitario: 21, ...o,
})

describe("valorDevolucionConOrigen — tal cual fue facturado (21/10/2026)", () => {
  it("caso del dueño: $100 neto + 21% IVA + 3% perc. IVA + 3% IIBB − 10% contado, 10 unidades = $1.143", () => {
    const v = valorDevolucionConOrigen([{ cantidad: 10, precio_venta_original: 100, origen: fa() }], 3)
    expect(v.fiscal).toMatchObject({ neto: 900, iva: 189, percepcionIva: 27, percepcionIibb: 27, total: 1143 })
    expect(v.total).toBe(1143)
  })

  it("percepción IVA: va aunque la NC sea chica si la factura la llevó; no va si la factura no la llevó", () => {
    expect(valorDevolucionConOrigen([{ cantidad: 1, precio_venta_original: 100, origen: fa({ bonificado_contado: false }) }], 0).fiscal.percepcionIva).toBe(3)
    expect(valorDevolucionConOrigen([{ cantidad: 1, precio_venta_original: 100, origen: fa({ percepcion_iva: false }) }], 0).fiscal.percepcionIva).toBe(0)
  })

  it("IVA del renglón facturado (precio final − neto), no 21% del neto: coincide al centavo", () => {
    // Factura: final $100 → neto 82,64 + IVA 17,36 por unidad. 21% de 826,40 daría 173,54
    const v = valorDevolucionConOrigen([{ cantidad: 10, precio_venta_original: 82.64, origen: fa({ bonificado_contado: false, percepcion_iva: false, iva_unitario: 17.36 }) }], 0)
    expect(v.fiscal.iva).toBe(173.6)
    expect(v.total).toBe(1000)
  })

  it("sin IVA del renglón (comprobante importado): 21% del neto", () => {
    const v = valorDevolucionConOrigen([{ cantidad: 10, precio_venta_original: 82.64, origen: fa({ exacto: false, bonificado_contado: false, percepcion_iva: false, iva_unitario: null }) }], 0)
    expect(v.fiscal.iva).toBe(173.54)
  })

  it("devolución mixta: lo de factura va en NC (con IVA y percepciones), lo de presupuesto en REV (precio final, sin nada)", () => {
    const pres: OrigenDevolucion = { comprobante_venta_id: "p1", tipo_comprobante: "PRES", numero_comprobante: "0001-00000009", fiscal: false, percepcion_iva: false, bonificado_contado: false, exacto: true, precio: 121, iva_unitario: null }
    const v = valorDevolucionConOrigen([
      { cantidad: 10, precio_venta_original: 100, origen: fa() },
      { cantidad: 2, precio_venta_original: 121, origen: pres },
    ], 3)
    expect(v.fiscal.total).toBe(1143)
    expect(v.rev.total).toBe(242)
    expect(v.total).toBe(1385)
    expect(v.ivaPorRenglon).toEqual([189, 0])
  })

  it("asociación: comprado exacto gana; si no, el más reciente del tipo que corresponde (cliente todo facturado ⇒ fiscal)", () => {
    const ctx = { alicuota_iibb: 3, ultimo_fiscal: fa({ comprobante_venta_id: "fa-ult", exacto: false, precio: null }), ultimo_presupuesto: fa({ comprobante_venta_id: "pres-ult", tipo_comprobante: "PRES", fiscal: false }) }
    expect(elegirOrigenDevolucion(fa(), ctx, "presupuesto").comprobante_venta_id).toBe("fa1")
    const f = elegirOrigenDevolucion(null, ctx, "factura")
    expect(f).toMatchObject({ comprobante_venta_id: "fa-ult", fiscal: true, exacto: false, precio: null })
    expect(elegirOrigenDevolucion(null, ctx, "presupuesto")).toMatchObject({ comprobante_venta_id: "pres-ult", fiscal: false })
    expect(elegirOrigenDevolucion(null, null, "factura")).toMatchObject({ comprobante_venta_id: null, fiscal: true })
  })

  it("#28: negro sin comprobante con el artículo → PRES de respaldo 0002-00000001 (sin 10%, sin id hasta guardarse)", () => {
    const respaldo = { comprobante_venta_id: null, tipo_comprobante: "PRES", numero_comprobante: "0002-00000001", fiscal: false, percepcion_iva: false, bonificado_contado: false, exacto: false, precio: null, iva_unitario: null }
    // El servidor ya no manda "última factura": blanco va sin asociado (NC con período a ARCA)
    const ctx = { alicuota_iibb: 3, ultimo_fiscal: null, ultimo_presupuesto: respaldo }
    expect(elegirOrigenDevolucion(null, ctx, "presupuesto")).toMatchObject({ numero_comprobante: "0002-00000001", fiscal: false, bonificado_contado: false })
    expect(elegirOrigenDevolucion(null, ctx, "factura")).toMatchObject({ comprobante_venta_id: null, fiscal: true, percepcion_iva: false, bonificado_contado: false })
  })

  it("réplica vieja de comprados (sin campos de origen): fiscal por tipo, exacto, 21%", () => {
    const o = origenDesdeComprado({ comprobante_venta_id: "x", tipo_comprobante: "FB", numero_comprobante: "0007-1", ultimo_precio: 50, bonificado_contado: true })
    expect(o).toMatchObject({ fiscal: true, exacto: true, precio: 50, iva_unitario: null, bonificado_contado: true, percepcion_iva: false })
  })
})
