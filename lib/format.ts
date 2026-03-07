/**
 * Formatea un número con punto decimal y coma para miles
 * Ejemplo: 1000.23 -> "1,000.23"
 */
export function formatNumber(value: number | string, decimals = 2): string {
  const num = typeof value === "string" ? Number.parseFloat(value) : value
  if (isNaN(num)) return "0.00"

  const parts = num.toFixed(decimals).split(".")
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return parts.join(".")
}

/**
 * Parsea un string formateado a número
 * Ejemplo: "1,000.23" -> 1000.23
 */
export function parseFormattedNumber(value: string): number {
  const cleaned = value.replace(/,/g, "")
  return Number.parseFloat(cleaned) || 0
}

/**
 * Formatea un CUIT con guiones automáticamente
 * Ejemplo: "20123456789" -> "20-12345678-9"
 */
export function formatCUIT(value: string): string {
  // Remover todo lo que no sea número
  const numbers = value.replace(/\D/g, "")

  // Limitar a 11 dígitos
  const limited = numbers.slice(0, 11)

  // Formatear con guiones
  if (limited.length <= 2) return limited
  if (limited.length <= 10) return `${limited.slice(0, 2)}-${limited.slice(2)}`
  return `${limited.slice(0, 2)}-${limited.slice(2, 10)}-${limited.slice(10)}`
}

/**
 * Parsea un CUIT formateado a solo números
 * Ejemplo: "20-12345678-9" -> "20123456789"
 */
export function parseCUIT(value: string): string {
  return value.replace(/\D/g, "")
}

/**
 * Valida que un CUIT tenga 11 dígitos
 */
export function isValidCUIT(value: string): boolean {
  const numbers = parseCUIT(value)
  return numbers.length === 11
}
