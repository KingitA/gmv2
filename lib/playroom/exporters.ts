import { todayArgentina } from '@/lib/utils'

export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  columns: { key: string; label: string; exportValue?: (value: any, row: T) => string }[],
  filename: string
) {
  const headers = columns.map(c => `"${c.label}"`).join(',')
  const rows = data.map(row =>
    columns.map(col => {
      const raw = row[col.key]
      const val = col.exportValue ? col.exportValue(raw, row) : raw ?? ''
      return `"${String(val).replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [headers, ...rows].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `${filename}_${todayArgentina()}.csv`)
}

// ─── ARCA fiscal formats ──────────────────────────────────────────────────────

export interface FiscalARCARow {
  fecha: string              // YYYY-MM-DD
  cliente_nombre: string
  tm: string                 // '01' | '03'
  punto_venta: string
  numero_comprobante: string
  ti: string                 // 'RI' | 'RM' | 'CF' | 'EX'
  cuit: string
  exento: number
  perciva: number
  percba: number
  percrn: number
  perclp: number
  neto1: number
  neto2: number
  iva1: number
  iva2: number
  total: number
}

function fDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function fMonto(n: number, width = 12): string {
  return n.toFixed(2).padStart(width)
}

function fMontoPerc(n: number, width = 10): string {
  return n.toFixed(2).padStart(width)
}

function fNombre(s: string, width = 31): string {
  return s.toUpperCase().slice(0, width).padEnd(width)
}

function fCuit(cuit: string): string {
  // Ensure XX-XXXXXXXX-X format
  const digits = cuit.replace(/\D/g, '')
  if (digits.length === 11) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
  }
  return cuit
}

/**
 * Libro IVA Ventas — formato exacto IVAV2604.CSV (18 cols, semicolón)
 */
export function exportLibroIVACSV(rows: FiscalARCARow[], filename: string) {
  const header = 'FECHA;NOMBRE;TM;COMPROBANTE;TI;CUIT;EXENTO;PERCIVA;PERCBA;PERCRN;PERCLP;BONREC1;BONREC2;NETO1;NETO 2;IVA1;IVA2;TOTAL '
  const lines = rows.map(r => {
    const fecha = fDate(r.fecha)
    const nombre = fNombre(r.cliente_nombre, 31)
    const tm = `${r.tm} `                                // "01 " 3 chars
    const comp = r.numero_comprobante                    // "0001-00000001"
    const ti = `${r.ti} `                               // "RI " 3 chars
    const cuit = fCuit(r.cuit)
    const exento  = fMonto(r.exento)
    const perciva = fMonto(r.perciva)
    const percba  = fMontoPerc(r.percba)
    const percrn  = fMontoPerc(r.percrn)
    const perclp  = fMontoPerc(r.perclp)
    const bonrec1 = fMonto(0)
    const bonrec2 = fMonto(0)
    const neto1   = fMonto(r.neto1)
    const neto2   = fMonto(r.neto2)
    const iva1    = fMonto(r.iva1)
    const iva2    = fMonto(r.iva2)
    const total   = fMonto(r.total)
    return `${fecha};${nombre};${tm};${comp};${ti};${cuit};${exento};${perciva};${percba};${percrn};${perclp};${bonrec1};${bonrec2};${neto1};${neto2};${iva1};${iva2};${total}`
  })
  const txt = [header, ...lines].join('\r\n')
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' })
  triggerDownload(blob, `${filename}_${todayArgentina()}.csv`)
}

/**
 * Libro IVA Ventas — formato exacto IVAV2604-XX.TXT (ancho fijo con totales)
 */
export function exportLibroIVATXTFormatted(rows: FiscalARCARow[], filename: string, folio = 1) {
  const SEP = '-'.repeat(197)
  const HEADER_LINE =
    '   FECHA   NOMBRE                         TM  COMPROBANTE   TI CUIT                EXENTO    PERCIVA    PERC.BA    PERC.RN    PERC.LP    BONREC1    BONREC2      NETO1      NETO2       IVA1       IVA2      TOTAL '

  const folioStr = `Folio Nro. ${String(folio).padStart(5, '0')}`
  const folioLine = folioStr.padStart(196)

  const dataLines = rows.map(r => {
    const fecha = fDate(r.fecha).padEnd(10)
    const nombre = fNombre(r.cliente_nombre, 31)
    const tm = r.tm.padEnd(4)
    const comp = r.numero_comprobante.padEnd(14)
    const ti = r.ti.padEnd(3)
    const cuit = fCuit(r.cuit).padEnd(20)
    const exento  = fMonto(r.exento, 10)
    const perciva = fMonto(r.perciva, 10)
    const percba  = fMonto(r.percba, 10)
    const percrn  = fMonto(r.percrn, 10)
    const perclp  = fMonto(r.perclp, 10)
    const bonrec1 = fMonto(0, 10)
    const bonrec2 = fMonto(0, 10)
    const neto1   = fMonto(r.neto1, 12)
    const neto2   = fMonto(r.neto2, 12)
    const iva1    = fMonto(r.iva1, 10)
    const iva2    = fMonto(r.iva2, 10)
    const total   = fMonto(r.total, 12)
    return `${fecha} ${nombre} ${tm} ${comp} ${ti} ${cuit} ${exento} ${perciva} ${percba} ${percrn} ${perclp} ${bonrec1} ${bonrec2} ${neto1} ${neto2} ${iva1} ${iva2} ${total}`
  })

  // Totales
  const sum = (fn: (r: FiscalARCARow) => number) => rows.reduce((s, r) => s + fn(r), 0)
  const totalExento  = sum(r => r.exento)
  const totalPerciva = sum(r => r.perciva)
  const totalPercba  = sum(r => r.percba)
  const totalPercrn  = sum(r => r.percrn)
  const totalPerclp  = sum(r => r.perclp)
  const totalNeto1   = sum(r => r.neto1)
  const totalNeto2   = sum(r => r.neto2)
  const totalIva1    = sum(r => r.iva1)
  const totalIva2    = sum(r => r.iva2)
  const totalTotal   = sum(r => r.total)

  const debitos = rows.filter(r => r.tm === '01')
  const creditos = rows.filter(r => r.tm === '03')
  const sumDeb = (fn: (r: FiscalARCARow) => number) => debitos.reduce((s, r) => s + fn(r), 0)
  const sumCred = (fn: (r: FiscalARCARow) => number) => creditos.reduce((s, r) => s + Math.abs(fn(r)), 0)

  const fTot = (n: number) => n.toFixed(2).padStart(12)

  const totalesLine = `TOTALES......................................................................${fTot(totalExento)}${fTot(totalPerciva)}${fTot(totalPercba)}${fTot(totalPercrn)}${fTot(totalPerclp)}${fTot(0)}${fTot(0)}${fTot(totalNeto1)}${fTot(totalNeto2)}${fTot(totalIva1)}${fTot(totalIva2)}${fTot(totalTotal)}`
  const debitosLine = `TOTAL DE DEBITOS.............................................................${fTot(sumDeb(r => r.exento))}${fTot(sumDeb(r => r.perciva))}${fTot(sumDeb(r => r.percba))}${fTot(sumDeb(r => r.percrn))}${fTot(sumDeb(r => r.perclp))}${fTot(0)}${fTot(0)}${fTot(sumDeb(r => r.neto1))}${fTot(sumDeb(r => r.neto2))}${fTot(sumDeb(r => r.iva1))}${fTot(sumDeb(r => r.iva2))}${fTot(sumDeb(r => r.total))}`
  const creditosLine = `TOTAL DE CREDITOS............................................................${fTot(sumCred(r => r.exento))}${fTot(sumCred(r => r.perciva))}${fTot(sumCred(r => r.percba))}${fTot(sumCred(r => r.percrn))}${fTot(sumCred(r => r.perclp))}${fTot(0)}${fTot(0)}${fTot(sumCred(r => r.neto1))}${fTot(sumCred(r => r.neto2))}${fTot(sumCred(r => r.iva1))}${fTot(sumCred(r => r.iva2))}${fTot(sumCred(r => r.total))}`

  const content = [
    folioLine,
    '',
    HEADER_LINE,
    SEP,
    ...dataLines,
    SEP,
    totalesLine,
    ' ',
    debitosLine,
    creditosLine,
  ].join('\r\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' })
  triggerDownload(blob, `${filename}_${todayArgentina()}.txt`)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Legacy TXT export (kept for compatibility)
export function exportLibroIVATXT(
  rows: Record<string, any>[],
  filename: string
) {
  const lines = rows.map(r => {
    const fecha = String(r.fecha ?? '').replace(/-/g, '')
    const tipo = String(r.tipo_comprobante ?? '').padEnd(3)
    const puntoVenta = String(r.punto_venta ?? '').padStart(5, '0')
    const numero = String(r.numero_comprobante ?? '').padStart(8, '0')
    const cuit = String(r.cuit ?? '').padStart(11, '0')
    const neto21 = formatMontoTXT(r.neto_21 ?? 0)
    const neto105 = formatMontoTXT(r.neto_105 ?? 0)
    const exento = formatMontoTXT(r.exento ?? 0)
    const iva21 = formatMontoTXT(r.iva_21 ?? 0)
    const iva105 = formatMontoTXT(r.iva_105 ?? 0)
    const total = formatMontoTXT(r.total ?? 0)
    return `${fecha}${tipo}${puntoVenta}${numero}${cuit}${neto21}${neto105}${exento}${iva21}${iva105}${total}`
  })
  const txt = lines.join('\r\n')
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' })
  triggerDownload(blob, `${filename}_${todayArgentina()}.txt`)
}

function formatMontoTXT(val: number): string {
  return Math.round(val * 100).toString().padStart(15, '0')
}
