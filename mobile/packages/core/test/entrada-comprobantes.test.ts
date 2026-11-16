// E-36 — detectar la misma factura de proveedor aunque el número venga escrito distinto.
import { describe, expect, it } from "vitest"
import { esNumeroProvisorio, normalizarNumeroComprobante, tiposCompatibles } from "../../../../lib/services/numero-comprobante"

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

describe("tipos compatibles (cada tipo tiene su numeración; la letra es parte del tipo)", () => {
  const mismo = (a: string, b: string) => tiposCompatibles(a).includes(b)
  it("factura A y factura B con el mismo número NO son la misma", () => {
    expect(mismo("FA", "FB")).toBe(false)
    expect(mismo("FB", "FA")).toBe(false)
    expect(mismo("FA", "FC")).toBe(false)
    expect(mismo("FA", "FA")).toBe(true)
  })
  it("una factura leída sin datos fiscales (Adquisicion) puede ser la FA/FB/FC", () => {
    for (const t of ["FA", "FB", "FC"]) {
      expect(mismo("Adquisicion", t)).toBe(true)
      expect(mismo(t, "Adquisicion")).toBe(true)
    }
  })
  it("NC / ND sin letra cruzan con las que tienen letra; entre letras no", () => {
    expect(mismo("NC", "NCA")).toBe(true)
    expect(mismo("NCA", "NC")).toBe(true)
    expect(mismo("NCA", "NCB")).toBe(false)
    expect(mismo("ND", "NDB")).toBe(true)
    expect(mismo("NDA", "NDB")).toBe(false)
  })
  it("factura, nota de crédito, nota de débito, remito y reversa nunca se cruzan", () => {
    for (const [a, b] of [["FA", "NCA"], ["FA", "NDA"], ["FA", "Remito"], ["NC", "ND"], ["Remito", "Adquisicion"], ["Reversa", "NC"]]) {
      expect(mismo(a, b)).toBe(false)
      expect(mismo(b, a)).toBe(false)
    }
    expect(tiposCompatibles("")).toEqual([])
  })
})
