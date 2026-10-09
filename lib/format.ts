// Nombres viejos que delegan en lib/formato (formato único del sistema, ver
// docs/FORMATOS.md). ANTES estas funciones eran en-US ("1,000.23") y
// parseFormattedNumber("1.000,50") devolvía 1. Para código nuevo, usar @/lib/formato.
import { numero, parseMonto, cuitDigitos, cuitValido } from "@/lib/formato"

/** "1.000,23" (formato argentino). */
export function formatNumber(value: number | string, decimals = 2): string {
  return numero(value, decimals) || numero(0, decimals)
}

/** Entiende "1.000,23", "1000,23", "1.500" (mil quinientos) y también "1,000.23". */
export function parseFormattedNumber(value: string): number {
  return parseMonto(value) ?? 0
}

/**
 * Máscara progresiva de CUIT mientras se tipea: "2012" → "20-12", "20123456789" → "20-12345678-9".
 */
export function formatCUIT(value: string): string {
  const limited = cuitDigitos(value).slice(0, 11)
  if (limited.length <= 2) return limited
  if (limited.length <= 10) return `${limited.slice(0, 2)}-${limited.slice(2)}`
  return `${limited.slice(0, 2)}-${limited.slice(2, 10)}-${limited.slice(10)}`
}

/** Solo los dígitos ("20-12345678-9" → "20123456789"). */
export function parseCUIT(value: string): string {
  return cuitDigitos(value)
}

/** 11 dígitos y dígito verificador correcto. */
export function isValidCUIT(value: string): boolean {
  return cuitValido(value)
}
