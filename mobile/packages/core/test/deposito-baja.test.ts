import { describe, expect, it } from "vitest"
import { crearIndice, hayActivoConCodigo, pareceCodigo } from "../../../apps/deposito/src/datos/busqueda"

// App Depósito · artículos dados de baja (MOBILE.md §17): la réplica solo tiene activos;
// estas funciones deciden cuándo preguntarle al servidor si un código es de uno dado de baja.

const ix = crearIndice([
  { id: "a1", sku: "062216", descripcion: "Jabón", ean13: ["7790000000017"], codigo_bulto: "17790000000014" },
  { id: "a2", sku: "AB-12", descripcion: "Esponja", ean13: null, codigo_bulto: null },
])

describe("Depósito · dado de baja", () => {
  it("un código con algún activo exacto (EAN, bulto o SKU con/sin ceros) no consulta", () => {
    expect(hayActivoConCodigo(ix, "7790000000017")).toBe(true)
    expect(hayActivoConCodigo(ix, "17790000000014")).toBe(true)
    expect(hayActivoConCodigo(ix, "062216")).toBe(true)
    expect(hayActivoConCodigo(ix, "62216")).toBe(true)
    expect(hayActivoConCodigo(ix, "ab-12")).toBe(true)
  })

  it("un código que ningún activo tiene sí consulta (aunque sea parte de otro)", () => {
    expect(hayActivoConCodigo(ix, "0622")).toBe(false)
    expect(hayActivoConCodigo(ix, "999999")).toBe(false)
    expect(hayActivoConCodigo(ix, "")).toBe(false)
  })

  it("solo lo que parece un código (una palabra con dígitos) dispara la consulta", () => {
    expect(pareceCodigo("062216")).toBe(true)
    expect(pareceCodigo(" 7790000000017 ")).toBe(true)
    expect(pareceCodigo("AB-12")).toBe(true)
    expect(pareceCodigo("jabon")).toBe(false)
    expect(pareceCodigo("jabon x20")).toBe(false)
    expect(pareceCodigo("12")).toBe(false)
  })
})
