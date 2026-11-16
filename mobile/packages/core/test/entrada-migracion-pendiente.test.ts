// Caer al camino viejo SOLO cuando falta la migración esperada; cualquier otro error se propaga.
import { describe, expect, it } from "vitest"
import { faltaLaColumna, faltaLaFuncion } from "../../../../lib/utils/migracion-pendiente"

describe("faltaLaFuncion", () => {
  const F = "recepcion_aplicar_stock"
  it("PostgREST no encuentra la función llamada (migración sin aplicar)", () => {
    expect(faltaLaFuncion({ code: "PGRST202", message: "Could not find the function public.recepcion_aplicar_stock(p_recepcion_id) in the schema cache" }, F)).toBe(true)
  })
  it("Postgres dice que ESA función no existe", () => {
    expect(faltaLaFuncion({ code: "42883", message: "function public.recepcion_aplicar_stock(uuid) does not exist" }, F)).toBe(true)
    expect(faltaLaFuncion({ code: "42883", message: "function recepcion_aplicar_stock(uuid) does not exist" }, F)).toBe(true)
  })
  it("42883 por OTRA función que falta ADENTRO de la nuestra: no es migración pendiente", () => {
    expect(faltaLaFuncion({ code: "42883", message: "function round(text, integer) does not exist" }, F)).toBe(false)
    expect(faltaLaFuncion({ code: "42883", message: "function public.comprobante_compra_marcar_validador(uuid, uuid) does not exist" }, "comprobante_compra_validar")).toBe(false)
    // un nombre que solo EMPIEZA igual tampoco
    expect(faltaLaFuncion({ code: "42883", message: "function recepcion_aplicar_stock_v2(uuid) does not exist" }, F)).toBe(false)
  })
  it("otros errores (regla de negocio, red, permisos) nunca cuentan", () => {
    expect(faltaLaFuncion({ code: "P0001", message: "La recepción está cancelada" }, F)).toBe(false)
    expect(faltaLaFuncion({ code: "42501", message: "permission denied for function recepcion_aplicar_stock" }, F)).toBe(false)
    expect(faltaLaFuncion({ message: "fetch failed" }, F)).toBe(false)
    expect(faltaLaFuncion(null, F)).toBe(false)
  })
})

describe("faltaLaColumna", () => {
  it("solo los códigos de columna inexistente", () => {
    expect(faltaLaColumna({ code: "42703" })).toBe(true)
    expect(faltaLaColumna({ code: "PGRST204" })).toBe(true)
    expect(faltaLaColumna({ message: "fetch failed" })).toBe(false)
    expect(faltaLaColumna({ code: "42501" })).toBe(false)
    expect(faltaLaColumna(null)).toBe(false)
  })
})
