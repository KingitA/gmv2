import { describe, expect, it } from "vitest"
import { normalizarDecisiones, validarDecisiones } from "../../../../lib/viajes/gastos-rendicion"

// #43 (prueba integral de salida): la nafta de $25.000 quedó "a revisar en oficina" para siempre.
// Regla de Juan (26/10): los gastos se aprueban o rechazan AL ACEPTAR la rendición.

describe("#43 decisiones sobre los gastos al aceptar la rendición", () => {
  it("normaliza: descarta lo que no tiene id o aprobar, y conceptos desconocidos", () => {
    expect(
      normalizarDecisiones([
        { id: "a", aprobar: true, categoria: "camion", vehiculo_id: "v1" },
        { id: "b", aprobar: false, categoria: "inventado", motivo: "  sin ticket  " },
        { id: "c" },
        null,
      ]),
    ).toEqual([
      { id: "a", aprobar: true, categoria: "camion", vehiculo_id: "v1", motivo: null },
      { id: "b", aprobar: false, categoria: undefined, vehiculo_id: null, motivo: "sin ticket" },
    ])
    expect(normalizarDecisiones(undefined)).toBeNull()
  })

  it("cada gasto declarado necesita su decisión", () => {
    expect(validarDecisiones(["a", "b"], [{ id: "a", aprobar: true }])).toBe("Falta aprobar o rechazar 1 gasto(s) del viaje")
  })

  it("rechazar pide motivo", () => {
    expect(validarDecisiones(["a"], [{ id: "a", aprobar: false, motivo: "" }])).toBe("Para rechazar un gasto hace falta el motivo")
    expect(validarDecisiones(["a"], [{ id: "a", aprobar: false, motivo: "no trajo ticket" }])).toBeNull()
  })

  it("sin gastos pendientes no hay nada que validar", () => {
    expect(validarDecisiones([], [])).toBeNull()
  })
})
