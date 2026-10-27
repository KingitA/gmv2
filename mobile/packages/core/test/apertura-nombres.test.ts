import { describe, expect, it } from "vitest"
import { nombresCoinciden } from "../../../../lib/apertura/importar"

// R7 (27/10, #7 apertura): el cruce por nombre compara palabras enteras y significativas
describe("nombresCoinciden", () => {
  it("mismo cliente con otro orden o razón social", () => {
    expect(nombresCoinciden("GARRIDO SERGIO", "Sergio Garrido")).toBe(true)
    expect(nombresCoinciden("URQUIZA HNOS S.R.L.", "Urquiza")).toBe(true)
    expect(nombresCoinciden("DISTRIBUIDORA ÑANDÚ", "Distribuidora Ñandu SA", null)).toBe(true)
  })
  it("una palabra suelta en común ya no alcanza ('LA', 'DON', un apellido compartido)", () => {
    expect(nombresCoinciden("LA ESQUINA DE PEDRO", "La Casona")).toBe(false)
    expect(nombresCoinciden("ROSSI FABIAN", "Rossi Pia Carolina")).toBe(false)
  })
  it("prueba los dos nombres de gmv2 (como lo conocemos y razón social)", () => {
    expect(nombresCoinciden("FERRETERIA EL CLAVO", "El Clavo", "Ferreteria El Clavo SRL")).toBe(true)
  })
})
