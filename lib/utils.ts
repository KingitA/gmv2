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

/**
 * Returns current UTC timestamp for TIMESTAMPTZ DB columns.
 */
export function nowArgentina(): string {
  return new Date().toISOString()
}

/**
 * Returns today's date in YYYY-MM-DD format in Argentina timezone.
 */
export function todayArgentina(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ })
}

/**
 * Returns start of a given Argentina calendar day expressed in UTC.
 * Argentina is UTC-3 (no DST), so midnight ART = 03:00 UTC.
 * Use for .gte() filters on TIMESTAMPTZ columns.
 * e.g. '2026-05-15' → '2026-05-15T03:00:00.000Z'
 */
export function startOfDayArgentina(dateStr: string): string {
  return `${dateStr}T03:00:00.000Z`
}

/**
 * Returns end of a given Argentina calendar day expressed in UTC.
 * 23:59:59.999 ART = 02:59:59.999 UTC the following day.
 * Use for .lte() filters on TIMESTAMPTZ columns.
 * e.g. '2026-05-15' → '2026-05-16T02:59:59.999Z'
 */
export function endOfDayArgentina(dateStr: string): string {
  const d = new Date(dateStr + 'T03:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCMilliseconds(d.getUTCMilliseconds() - 1)
  return d.toISOString()
}

/**
 * Formats a date string for display in Argentina locale and timezone.
 */
export function formatDateAR(date: string | Date): string {
  if (!date) return ''
  const str = typeof date === 'string' ? date : date.toISOString()
  // DATE-only strings (YYYY-MM-DD) parsed by JS as UTC midnight → shows previous day in Argentina.
  // Using noon UTC avoids the shift entirely (12:00Z = 09:00 ART, same calendar day).
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + 'T12:00:00Z' : str)
  return d.toLocaleDateString('es-AR', { timeZone: ARGENTINA_TZ })
}

/**
 * Formats a date string with time for display in Argentina locale and timezone.
 */
export function formatDateTimeAR(date: string | Date): string {
  if (!date) return ''
  return new Date(date).toLocaleString('es-AR', { timeZone: ARGENTINA_TZ })
}

