import { describe, expect, it } from "vitest"
import { parseMonto } from "@gm/formato"
import { cursorMonto, entradaMonto, mascaraMonto } from "../src/ui/monto"
import { altoTeclado, quedoTapado, viewportConTeclado } from "../src/ui/teclado"

// Core de las 3 apps (29/10/2026): CampoMonto (P2-30) y teclado (P2-14 / P2-17).

describe("CampoMonto — puntos de miles mientras se escribe (P2-30)", () => {
  it("pone los puntos de miles al tipear", () => {
    expect(mascaraMonto("3784286")).toBe("3.784.286")
    expect(mascaraMonto("3.784.2865")).toBe("37.842.865")
    expect(mascaraMonto("100")).toBe("100")
    expect(mascaraMonto("")).toBe("")
  })
  it("la coma separa centavos (máximo 2) y el número sale de parseMonto", () => {
    expect(mascaraMonto("3784286,8")).toBe("3.784.286,8")
    expect(mascaraMonto("3784286,899")).toBe("3.784.286,89")
    expect(parseMonto(mascaraMonto("3784286,89"))).toBe(3784286.89)
    expect(mascaraMonto(",5")).toBe("0,5")
    expect(mascaraMonto("1,2,3")).toBe("1,23")
  })
  it("sin decimales no hay coma; sin ceros a la izquierda", () => {
    expect(mascaraMonto("1234,5", 0)).toBe("12.345")
    expect(mascaraMonto("0005")).toBe("5")
    expect(mascaraMonto("0")).toBe("0")
  })
  it("un punto recién tipeado (teclado sin coma) es la coma decimal; borrar no inventa decimales", () => {
    expect(entradaMonto("1.234", "1.234.", 6)).toBe("1.234,")
    expect(mascaraMonto(entradaMonto("1.234", "1.234.", 6))).toBe("1.234,")
    // Borrar el último dígito de "1.234" deja "1.23": son miles, no decimales → "123"
    expect(mascaraMonto(entradaMonto("1.234", "1.23", 4))).toBe("123")
    // Con coma ya escrita, otro punto se ignora
    expect(entradaMonto("1,5", "1,5.", 4)).toBe("1,5.")
  })
  it("el cursor queda donde estaba respecto de los dígitos", () => {
    // "1234" con el cursor al final → "1.234", cursor al final
    expect(cursorMonto("1234", 4, "1.234")).toBe(5)
    // insertar un 9 después del 1 en "1.234" → "19.234" con el cursor después del 9
    expect(cursorMonto("19.234", 2, mascaraMonto("19.234"))).toBe(2)
  })
})

describe("Teclado en pantalla (P2-14 / P2-17)", () => {
  it("alto que tapa el teclado; menos de 80 px no cuenta", () => {
    expect(altoTeclado(800, 480)).toBe(320)
    expect(altoTeclado(800, 760)).toBe(0)
  })
  it("un campo de la mitad de abajo queda tapado; uno arriba no", () => {
    expect(quedoTapado({ top: 600, bottom: 640 }, 0, 480)).toBe(true)
    expect(quedoTapado({ top: 100, bottom: 140 }, 0, 480)).toBe(false)
  })
  it("le pide al WebView achicar el contenido con el teclado, sin duplicar", () => {
    const base = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
    expect(viewportConTeclado(base)).toBe(`${base}, interactive-widget=resizes-content`)
    expect(viewportConTeclado(viewportConTeclado(base))).toBe(`${base}, interactive-widget=resizes-content`)
  })
})
