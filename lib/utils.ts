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
 * Returns the current date/time as an ISO string adjusted to Argentina timezone.
 * Use this instead of `new Date().toISOString()` for storing dates.
 */
export function nowArgentina(): string {
  const now = new Date()
  const argDate = new Date(now.toLocaleString('en-US', { timeZone: ARGENTINA_TZ }))
  return argDate.toISOString()
}

/**
 * Returns today's date in YYYY-MM-DD format in Argentina timezone.
 * Use this instead of `new Date().toISOString().split('T')[0]`.
 */
export function todayArgentina(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ })
}

/**
 * Formats a date string for display in Argentina locale and timezone.
 * Use this instead of `new Date(date).toLocaleDateString()`.
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

