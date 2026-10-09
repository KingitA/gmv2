import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { moneda, fecha, fechaHora, ahoraISO, hoyISO, inicioDiaAR, finDiaAR } from '@/lib/formato'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Las funciones de formato de abajo son nombres viejos que se mantienen porque
// los usan cientos de pantallas: todas delegan en lib/formato (formato único
// del sistema, ver docs/FORMATOS.md). Para código nuevo, importar de @/lib/formato.

/** "$1.000,32" (sin espacio después del $, siempre 2 decimales). */
export function formatCurrency(value: number | string | null | undefined) {
  return moneda(Number(value) || 0)
}

/**
 * Returns current UTC timestamp for TIMESTAMPTZ DB columns.
 */
export function nowArgentina(): string {
  return ahoraISO()
}

/**
 * Returns today's date in YYYY-MM-DD format in Argentina timezone.
 */
export function todayArgentina(): string {
  return hoyISO()
}

/**
 * Returns start of a given Argentina calendar day expressed in UTC.
 * Argentina is UTC-3 (no DST), so midnight ART = 03:00 UTC.
 * Use for .gte() filters on TIMESTAMPTZ columns.
 * e.g. '2026-05-15' → '2026-05-15T03:00:00.000Z'
 */
export function startOfDayArgentina(dateStr: string): string {
  return inicioDiaAR(dateStr)
}

/**
 * Returns end of a given Argentina calendar day expressed in UTC.
 * 23:59:59.999 ART = 02:59:59.999 UTC the following day.
 * Use for .lte() filters on TIMESTAMPTZ columns.
 * e.g. '2026-05-15' → '2026-05-16T02:59:59.999Z'
 */
export function endOfDayArgentina(dateStr: string): string {
  return finDiaAR(dateStr)
}

/** "09/10/2026" en hora argentina (una columna date no se corre de día). */
export function formatDateAR(date: string | Date | null | undefined): string {
  return fecha(date)
}

/** "09/10/2026 14:05" en hora argentina. */
export function formatDateTimeAR(date: string | Date | null | undefined): string {
  return fechaHora(date)
}
