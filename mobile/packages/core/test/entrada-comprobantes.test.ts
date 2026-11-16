// E-36 — detectar la misma factura de proveedor aunque el número venga escrito distinto.
import { describe, expect, it } from "vitest"
import { claseComprobante, esNumeroProvisorio, normalizarNumeroComprobante } from "../../../../lib/services/numero-comprobante"

describe("número de comprobante comparable", () => {
  it("la misma factura escrita de varias formas da la misma clave", () => {
    const formas = ["0001-00000123", "A 0001-00000123", "0001 - 00000123", "1-123", "FA A 0001-00000123", "000100000123", "N° 0001-00000123"]
    for (const f of formas) expect(normalizarNumeroComprobante(f)).toBe("1-123")
  })

  it("punto de venta de 5 dígitos pegado al número", () => {
    expect(normalizarNumeroComprobante("0000300001234")).toBe("3-1234")
    expect(normalizarNumeroComprobante("00003-00001234")).toBe("3-1234")
  })

  it("facturas distintas dan claves distintas", () => {
    expect(normalizarNumeroComprobante("0001-00000123")).not.toBe(normalizarNumeroComprobante("0002-00000123"))
    expect(normalizarNumeroComprobante("0001-00000123")).not.toBe(normalizarNumeroComprobante("0001-00000124"))
    // un número suelto no se confunde con punto de venta + número
    expect(normalizarNumeroComprobante("123")).toBe("-123")
    expect(normalizarNumeroComprobante("123")).not.toBe(normalizarNumeroComprobante("1-123"))
  })

  it("sin número real no hay clave (nunca se trata como duplicado)", () => {
    for (const v of [null, undefined, "", "   ", "PENDIENTE-1731766000000", "GMAIL-1731766000000", "GMAIL-ADD-1731766000000"]) {
      expect(normalizarNumeroComprobante(v)).toBe("")
    }
    expect(esNumeroProvisorio("PENDIENTE-1")).toBe(true)
    expect(esNumeroProvisorio("0001-00000123")).toBe(false)
  })

  it("números sin dígitos: se comparan por letras", () => {
    expect(normalizarNumeroComprobante("s/n abc")).toBe("SNABC")
  })
})

describe("clase del comprobante (cada clase tiene su numeración)", () => {
  it("factura y adquisición son la misma clase: una misma factura leída de las dos formas es duplicada", () => {
    for (const t of ["FA", "FB", "FC", "Adquisicion"]) expect(claseComprobante(t)).toBe("factura")
  })
  it("nota de crédito, nota de débito y remito van aparte", () => {
    for (const t of ["NC", "NCA", "NCB", "NCC", "Reversa"]) expect(claseComprobante(t)).toBe("credito")
    for (const t of ["ND", "NDA", "NDB", "NDC"]) expect(claseComprobante(t)).toBe("debito")
    expect(claseComprobante("Remito")).toBe("remito")
  })
})
