import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(value)
}

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires'
const AR_OFFSET = '-03:00'

/**
 * Returns the current timestamp as ISO string with explicit Argentina offset.
 * Use for TIMESTAMPTZ DB columns — PostgreSQL stores UTC, offset makes intent explicit.
 */
export function nowArgentina(): string {
  const now = new Date()
  // Format as Argentina local time with explicit -03:00 offset
  const ar = new Date(now.toLocaleString('en-US', { timeZone: ARGENTINA_TZ }))
  const pad = (n: number) => String(n).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${ar.getFullYear()}-${pad(ar.getMonth() + 1)}-${pad(ar.getDate())}T${pad(ar.getHours())}:${pad(ar.getMinutes())}:${pad(ar.getSeconds())}.${ms}${AR_OFFSET}`
}

/**
 * Returns today's date in YYYY-MM-DD format in Argentina timezone.
 */
export function todayArgentina(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ })
}

/**
 * Returns the start of a day in Argentina timezone as an ISO string with offset.
 * Use for .gte() filters on TIMESTAMPTZ columns.
 * e.g. '2026-05-15' → '2026-05-15T00:00:00.000-03:00'
 */
export function startOfDayArgentina(dateStr: string): string {
  return `${dateStr}T00:00:00.000${AR_OFFSET}`
}

/**
 * Returns the end of a day in Argentina timezone as an ISO string with offset.
 * Use for .lte() filters on TIMESTAMPTZ columns.
 * e.g. '2026-05-15' → '2026-05-15T23:59:59.999-03:00'
 */
export function endOfDayArgentina(dateStr: string): string {
  return `${dateStr}T23:59:59.999${AR_OFFSET}`
}

/**
 * Formats a date string for display in Argentina locale and timezone.
 */
export function formatDateAR(date: string | Date): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('es-AR', { timeZone: ARGENTINA_TZ })
}

/**
 * Formats a date string with time for display in Argentina locale and timezone.
 */
export function formatDateTimeAR(date: string | Date): string {
  if (!date) return ''
  return new Date(date).toLocaleString('es-AR', { timeZone: ARGENTINA_TZ })
}

