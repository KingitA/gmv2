// Formatos únicos del sistema (lib/formato, alias @gm/formato): fecha dd/mm/aaaa
// en hora argentina, moneda $1.000,32 y CUIT xx-xxxxxxxx-x. Los mismos para el
// ERP y las tres apps.
import { describe, expect, it } from "vitest"
import {
  fecha, fechaHora, hora, fechaISO, parseFecha, sumarDiasISO, inicioDiaAR, finDiaAR, diasEntre, mediodiaAR,
  moneda, numero, porcentaje, entero, parseMonto, redondear, numeroPlano,
  formatCuit, normalizarCuit, cuitValido, errorCuit, mismoCuit, cuitDigitos,
} from "@gm/formato"

describe("fechas: dd/mm/aaaa en hora argentina", () => {
  it("columna date (AAAA-MM-DD) no se corre un día", () => {
    expect(fecha("2026-10-09")).toBe("09/10/2026")
    expect(fecha("2026-01-01")).toBe("01/01/2026")
  })
  it("instante UTC después de las 21 h AR sigue siendo el mismo día argentino", () => {
    expect(fecha("2026-10-10T01:30:00Z")).toBe("09/10/2026")
    expect(fechaHora("2026-10-10T01:30:00Z")).toBe("09/10/2026 22:30")
    expect(fechaISO("2026-10-10T01:30:00Z")).toBe("2026-10-09")
  })
  it("timestamp sin zona (columnas viejas) se lee como UTC, no como hora local", () => {
    expect(fechaHora("2026-10-09T14:00:00")).toBe("09/10/2026 11:00")
    expect(hora("2026-10-09 14:00:00")).toBe("11:00")
  })
  it("vacíos e inválidos → texto vacío", () => {
    expect(fecha(null)).toBe("")
    expect(fecha("")).toBe("")
    expect(fecha("cualquier cosa")).toBe("")
  })
})

describe("parseFecha: siempre día/mes, nunca mes/día", () => {
  it.each([
    ["9/10/2026", "2026-10-09"],
    ["09/10/26", "2026-10-09"],
    ["09-10-2026", "2026-10-09"],
    ["09.10.2026", "2026-10-09"],
    ["09102026", "2026-10-09"],
    ["091026", "2026-10-09"],
    ["2026-10-09", "2026-10-09"],
    ["20261009", "2026-10-09"], // ARCA
    ["2026-10-10T01:30:00Z", "2026-10-09"],
    ["31/12/2026", "2026-12-31"],
  ])("%s → %s", (entrada, esperado) => expect(parseFecha(entrada)).toBe(esperado))

  it("rechaza fechas imposibles (incluido el formato yanqui mes/día)", () => {
    expect(parseFecha("10/13/2026")).toBeNull()
    expect(parseFecha("31/02/2026")).toBeNull()
    expect(parseFecha("hola")).toBeNull()
  })
  it("número de serie de Excel", () => {
    expect(parseFecha(46304)).toBe("2026-10-09")
  })
})

describe("aritmética de fechas", () => {
  it("sumar días cruza meses y años", () => {
    expect(sumarDiasISO("2026-12-30", 3)).toBe("2027-01-02")
    expect(sumarDiasISO("2026-03-01", -1)).toBe("2026-02-28")
  })
  it("límites del día argentino en UTC", () => {
    expect(inicioDiaAR("2026-10-09")).toBe("2026-10-09T03:00:00.000Z")
    expect(finDiaAR("2026-10-09")).toBe("2026-10-10T02:59:59.999Z")
  })
  it("mediodía argentino de un día (para timestamptz) no cae en el día anterior", () => {
    expect(mediodiaAR("2026-10-09")).toBe("2026-10-09T15:00:00.000Z")
    expect(fecha(mediodiaAR("2026-10-09"))).toBe("09/10/2026")
  })
  it("número plano para CSV de Excel", () => {
    expect(numeroPlano(1234.5)).toBe("1234,50")
    expect(numeroPlano(-1234.567)).toBe("-1234,57")
  })
  it("días entre fechas", () => {
    expect(diasEntre("2026-10-01", "2026-10-31")).toBe(30)
  })
})

describe("moneda: $1.000,32", () => {
  it.each([
    [1000.32, "$1.000,32"],
    [1234567.5, "$1.234.567,50"],
    [0, "$0,00"],
    [-1500, "-$1.500,00"],
    [999.999, "$1.000,00"],
    [-0.001, "$0,00"],
    ["2500", "$2.500,00"],
  ])("%s → %s", (n, esperado) => expect(moneda(n)).toBe(esperado))

  it("números, enteros y porcentajes", () => {
    expect(numero(1234.5)).toBe("1.234,50")
    expect(numero(1234.5678, 0, 4)).toBe("1.234,5678")
    expect(entero(1250)).toBe("1.250")
    expect(porcentaje(15.5)).toBe("15,5%")
    expect(porcentaje(10)).toBe("10%")
    expect(moneda(null)).toBe("")
  })
  it("redondeo a centavos sin error de coma flotante", () => {
    expect(redondear(1.005)).toBe(1.01)
    expect(redondear(0.1 + 0.2)).toBe(0.3)
  })
})

describe("parseMonto: formato argentino primero, tolerante con Excel/OCR", () => {
  it.each([
    ["1.000,32", 1000.32],
    ["1000,32", 1000.32],
    ["1.500", 1500],
    ["1.234.567", 1234567],
    ["1.234.567,89", 1234567.89],
    ["$ 2.300", 2300],
    ["$1.000,32", 1000.32],
    ["1,5", 1.5],
    ["1,234.56", 1234.56],
    ["1,234,567", 1234567],
    ["12.5", 12.5],
    ["1234.56", 1234.56],
    ["0.500", 0.5],
    ["-1.200", -1200],
    ["(1.200,00)", -1200],
    ["150", 150],
  ])("%s → %s", (entrada, esperado) => expect(parseMonto(entrada)).toBe(esperado))

  it("no es un número → null", () => {
    expect(parseMonto("")).toBeNull()
    expect(parseMonto("abc")).toBeNull()
    expect(parseMonto(null)).toBeNull()
  })
})

describe("CUIT: xx-xxxxxxxx-x", () => {
  it.each([
    ["30710229240", "30-71022924-0"],
    ["30-71022924-0", "30-71022924-0"],
    ["30.71022924.0", "30-71022924-0"],
    ["30 71022924 0", "30-71022924-0"],
  ])("%s → %s", (entrada, esperado) => {
    expect(formatCuit(entrada)).toBe(esperado)
    expect(normalizarCuit(entrada)).toBe(esperado)
  })
  it("vacío, máscara sin completar o todo ceros (= sin CUIT) → null", () => {
    expect(normalizarCuit("")).toBeNull()
    expect(normalizarCuit("__-________-_")).toBeNull()
    expect(normalizarCuit(null)).toBeNull()
    expect(normalizarCuit("00-00000000-0")).toBeNull()
    expect(errorCuit("00-00000000-0")).toBeNull()
  })
  it("dígito verificador", () => {
    expect(cuitValido("30-71022924-0")).toBe(true)
    expect(cuitValido("30-71022924-1")).toBe(false)
    expect(cuitValido("11-11111111-1")).toBe(false)
    expect(errorCuit("2012345")).toMatch(/11 dígitos/)
    expect(errorCuit("30-71022924-1")).toMatch(/no es válido/)
    expect(errorCuit("")).toBeNull()
  })
  it("comparar sin importar el formato", () => {
    expect(mismoCuit("30-71022924-0", "30710229240")).toBe(true)
    expect(mismoCuit("", "")).toBe(false)
    expect(cuitDigitos("30-71022924-0")).toBe("30710229240")
  })
})
