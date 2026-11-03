import { describe, expect, it } from "vitest"
import { diaSemana, mesesNavegables, nombreMes, semanasDelMes, sumarMeses, viajeEnDia, viajeEnMes } from "../../../apps/vendedor/src/datos/calendario"

// Mis Viajes = calendario de reparto de la oficina (pedido de Juan, 03/11/2026).

describe("Calendario de viajes del vendedor", () => {
  it("semanas de lunes a domingo, con casilleros vacíos fuera del mes", () => {
    // Noviembre 2026 arranca un domingo
    expect(diaSemana("2026-11-01")).toBe(6)
    const sem = semanasDelMes("2026-11")
    expect(sem[0]).toEqual([null, null, null, null, null, null, "2026-11-01"])
    expect(sem.flat().filter(Boolean)).toHaveLength(30)
    expect(sem.every((s) => s.length === 7)).toBe(true)
  })
  it("un viaje de varios días aparece en cada día y en los meses que toca", () => {
    const v = { fecha: "2026-11-30", fecha_fin: "2026-12-02" }
    expect(viajeEnDia(v, "2026-12-01")).toBe(true)
    expect(viajeEnDia(v, "2026-12-03")).toBe(false)
    expect(viajeEnMes(v, "2026-11")).toBe(true)
    expect(viajeEnMes(v, "2026-12")).toBe(true)
    expect(viajeEnMes(v, "2027-01")).toBe(false)
  })
  it("se mira de 3 meses atrás (historial) al mes que viene (calendario)", () => {
    expect(mesesNavegables("2026-11-03")).toEqual({ desde: "2026-08", hasta: "2026-12" })
    expect(mesesNavegables("2026-01-15")).toEqual({ desde: "2025-10", hasta: "2026-02" })
    expect(sumarMeses("2026-12", 1)).toBe("2027-01")
    expect(nombreMes("2026-11")).toBe("Noviembre 2026")
  })
})
