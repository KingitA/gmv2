/**
 * GET /api/reportes/iva-ventas
 *
 * Genera el reporte IVA Ventas en formato CSV o TXT, con la misma estructura
 * del sistema anterior (IVAV{MMYY}.CSV / IVAV{MMYY}.TXT).
 *
 * Query params:
 *   mes      MM         requerido  (01-12)
 *   anio     YYYY       requerido  (ej: 2026)
 *   formato  csv | txt  default: csv
 *   provincia all | BSAS | RN | LP  default: all
 *
 * Códigos TM (Tipo de Movimiento = tipo de comprobante ARCA):
 *   FA=01  NDA=02  NCA=03  FB=06  NDB=07  NCB=08
 *
 * Códigos TI (condición IVA del receptor):
 *   RI = Responsable Inscripto
 *   RM = Responsable Monotributista (Ley 27618)
 *   SE = Sujeto Exento / resto
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'

// ── Constantes ──────────────────────────────────────────────────────────────

const TM_CODE: Record<string, string> = {
  FA: '01', NDA: '02', NCA: '03',
  FB: '06', NDB: '07', NCB: '08',
}

// Tipos que requieren ser incluidos en el reporte fiscal
const TIPOS_FISCALES = new Set(['FA', 'FB', 'NCA', 'NCB', 'NDA', 'NDB'])

function tiCode(condicion_iva: string | null | undefined): string {
  const c = (condicion_iva ?? '').toLowerCase()
  if (c.includes('monotributo')) return 'RM'
  if (c.includes('responsable inscripto')) return 'RI'
  return 'SE'
}

function provinciaKey(provincia: string | null | undefined): 'BSAS' | 'RN' | 'LP' | null {
  const p = (provincia ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (p.includes('buenos aires') || p === 'ba' || p === 'bsas') return 'BSAS'
  if (p.includes('rio negro') || p === 'rn') return 'RN'
  if (p.includes('la pampa') || p === 'lp') return 'LP'
  return null
}

// Formato decimal con 2 decimales, sin separador de miles
function fmt(n: number): string {
  return n.toFixed(2)
}

// Padding derecha en campo de ancho fijo (right-aligned)
function pad(val: string, width: number): string {
  return val.padStart(width)
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const mes     = searchParams.get('mes')
    const anio    = searchParams.get('anio')
    const formato = (searchParams.get('formato') ?? 'csv').toLowerCase()
    const prov    = (searchParams.get('provincia') ?? 'all').toUpperCase()

    if (!mes || !anio) {
      return NextResponse.json(
        { error: "Los parámetros 'mes' y 'anio' son requeridos" },
        { status: 400 },
      )
    }

    const mesNum  = parseInt(mes, 10)
    const anioNum = parseInt(anio, 10)
    if (isNaN(mesNum) || mesNum < 1 || mesNum > 12 || isNaN(anioNum)) {
      return NextResponse.json({ error: 'Mes o año inválido' }, { status: 400 })
    }

    // Rango del período
    const desde = `${anio}-${mes.padStart(2, '0')}-01`
    const lastDay = new Date(anioNum, mesNum, 0).getDate()
    const hasta   = `${anio}-${mes.padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    // ── Consulta de comprobantes fiscales del período ─────────────────────
    const { data: rows, error } = await supabase
      .from('comprobantes_venta')
      .select(`
        tipo_comprobante,
        numero_comprobante,
        punto_venta,
        fecha,
        total_neto,
        total_iva,
        total_factura,
        percepcion_iva,
        percepcion_iibb,
        clientes (
          nombre_razon_social,
          cuit,
          condicion_iva,
          provincia
        )
      `)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .in('tipo_comprobante', [...TIPOS_FISCALES])
      .order('fecha', { ascending: true })
      .order('numero_comprobante', { ascending: true })

    if (error) throw new Error('Error consultando comprobantes: ' + error.message)

    // ── Estructurar filas ──────────────────────────────────────────────────
    type Fila = {
      fecha:     string   // DD/MM/YYYY
      nombre:    string   // 30 chars
      tm:        string   // 2 chars
      cbte:      string   // PPPP-NNNNNNNN
      ti:        string   // 2 chars
      cuit:      string
      exento:    number
      perciva:   number
      percba:    number
      percrn:    number
      perclp:    number
      bonrec1:   number
      bonrec2:   number
      neto1:     number
      neto2:     number
      iva1:      number
      iva2:      number
      total:     number
    }

    const filas: Fila[] = []

    for (const row of rows ?? []) {
      const tipo = row.tipo_comprobante
      const tm   = TM_CODE[tipo]
      if (!tm) continue

      const cliente = Array.isArray(row.clientes) ? row.clientes[0] : row.clientes
      const ti      = tiCode(cliente?.condicion_iva)
      const provKey = provinciaKey(cliente?.provincia)

      // Filtrar por provincia si se pidió
      if (prov !== 'ALL' && provKey !== prov) continue

      // Fecha → DD/MM/YYYY
      const fechaObj  = new Date(row.fecha + 'T00:00:00-03:00')
      const fechaFmt  = [
        String(fechaObj.getDate()).padStart(2, '0'),
        String(fechaObj.getMonth() + 1).padStart(2, '0'),
        String(fechaObj.getFullYear()),
      ].join('/')

      // Nombre truncado/padded a 30 chars
      const nombre30 = (cliente?.nombre_razon_social ?? '').substring(0, 30).padEnd(30)

      // Totales (NC ya vienen negativos de la DB)
      const neto1  = Number(row.total_neto    ?? 0)
      const iva1   = Number(row.total_iva     ?? 0)
      const perciva = Number(row.percepcion_iva  ?? 0)
      const perciibb = Number(row.percepcion_iibb ?? 0)

      // Distribuir percepción IIBB a la columna de provincia del cliente
      const percba  = provKey === 'BSAS' ? perciibb : 0
      const percrn  = provKey === 'RN'   ? perciibb : 0
      const perclp  = provKey === 'LP'   ? perciibb : 0

      // Total = neto + iva + percepciones (con el signo correcto según tipo)
      const totalCalc = neto1 + iva1 + perciva + percba + percrn + perclp

      filas.push({
        fecha:   fechaFmt,
        nombre:  nombre30,
        tm,
        cbte:    row.numero_comprobante ?? '',
        ti,
        cuit:    cliente?.cuit ?? '',
        exento:  0,
        perciva,
        percba,
        percrn,
        perclp,
        bonrec1: 0,
        bonrec2: 0,
        neto1,
        neto2:   0,
        iva1,
        iva2:    0,
        total:   totalCalc,
      })
    }

    // ── Nombre de archivo sugerido ─────────────────────────────────────────
    const sufProv  = prov === 'ALL' ? '' : ` - ${prov}`
    const nombreArchivo = `IVAV${mes.padStart(2,'0')}${String(anioNum).slice(-2)}${sufProv}`

    // ── Generar CSV ────────────────────────────────────────────────────────
    if (formato === 'csv') {
      const lines: string[] = []
      // Header — idéntico al sistema anterior
      lines.push('FECHA;NOMBRE;TM;COMPROBANTE;TI;CUIT;EXENTO;PERCIVA;PERCBA;PERCRN;PERCLP;BONREC1;BONREC2;NETO1;NETO 2;IVA1;IVA2;TOTAL ')

      for (const f of filas) {
        const cols = [
          f.fecha,
          f.nombre,
          f.tm + ' ',                     // TM + trailing space (ej: "01 ")
          f.cbte,
          f.ti + ' ',                     // TI + trailing space (ej: "RI ")
          f.cuit,
          pad(fmt(f.exento),  12),
          pad(fmt(f.perciva), 12),
          pad(fmt(f.percba),  10),
          pad(fmt(f.percrn),  10),
          pad(fmt(f.perclp),  10),
          pad(fmt(f.bonrec1), 12),
          pad(fmt(f.bonrec2), 12),
          pad(fmt(f.neto1),   12),
          pad(fmt(f.neto2),   12),
          pad(fmt(f.iva1),    12),
          pad(fmt(f.iva2),    12),
          pad(fmt(f.total),   12),
        ]
        lines.push(cols.join(';'))
      }

      const csv = lines.join('\r\n')
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${nombreArchivo}.CSV"`,
        },
      })
    }

    // ── Generar TXT ────────────────────────────────────────────────────────
    const SEP = '-'.repeat(211)

    // Header TXT con folio
    const HEADER_TXT = [
      ' '.repeat(197) + 'Folio Nro. 00001',
      '',
      '   FECHA   NOMBRE                         TM  COMPROBANTE   TI CUIT                EXENTO    PERCIVA    PERC.BA    PERC.RN    PERC.LP    BONREC1    BONREC2      NETO1      NETO2       IVA1       IVA2      TOTAL ',
      SEP,
    ]

    // Función para formatear una fila en TXT (columnas fijas, 211 chars)
    function formatFilaTXT(f: Fila): string {
      const p = (v: number, w: number) => fmt(v).padStart(w)
      return [
        f.fecha,                          // 10
        ' ',                              //  1
        f.nombre,                         // 30
        ' ',                              //  1
        f.tm,                             //  2
        '  ',                             //  2
        f.cbte,                           // 13
        ' ',                              //  1
        f.ti,                             //  2
        ' ',                              //  1
        f.cuit.padEnd(20),                // 20
        p(f.exento,  10),                 // 10
        p(f.perciva, 11),                 // 11
        p(f.percba,  10),                 // 10
        p(f.percrn,  10),                 // 10
        p(f.perclp,  10),                 // 10
        p(f.bonrec1,  9),                 //  9
        p(f.bonrec2,  9),                 //  9
        p(f.neto1,   13),                 // 13
        p(f.neto2,   12),                 // 12
        p(f.iva1,    12),                 // 12
        p(f.iva2,    10),                 // 10
        p(f.total,   12),                 // 12
      ].join('')
    }

    // Totales
    const totales = filas.reduce(
      (acc, f) => {
        acc.exento  += f.exento
        acc.perciva += f.perciva
        acc.percba  += f.percba
        acc.percrn  += f.percrn
        acc.perclp  += f.perclp
        acc.bonrec1 += f.bonrec1
        acc.bonrec2 += f.bonrec2
        acc.neto1   += f.neto1
        acc.neto2   += f.neto2
        acc.iva1    += f.iva1
        acc.iva2    += f.iva2
        acc.total   += f.total
        return acc
      },
      { exento: 0, perciva: 0, percba: 0, percrn: 0, perclp: 0, bonrec1: 0, bonrec2: 0, neto1: 0, neto2: 0, iva1: 0, iva2: 0, total: 0 },
    )

    // Débitos = FA + FB + NDA + NDB (positivos)
    const debitos = filas.filter(f => ['01','02','06','07'].includes(f.tm))
    const creditos = filas.filter(f => ['03','08'].includes(f.tm))

    const sumFila = (arr: Fila[]) =>
      arr.reduce(
        (acc, f) => {
          acc.exento  += Math.abs(f.exento)
          acc.perciva += Math.abs(f.perciva)
          acc.percba  += Math.abs(f.percba)
          acc.percrn  += Math.abs(f.percrn)
          acc.perclp  += Math.abs(f.perclp)
          acc.bonrec1 += Math.abs(f.bonrec1)
          acc.bonrec2 += Math.abs(f.bonrec2)
          acc.neto1   += Math.abs(f.neto1)
          acc.neto2   += Math.abs(f.neto2)
          acc.iva1    += Math.abs(f.iva1)
          acc.iva2    += Math.abs(f.iva2)
          acc.total   += Math.abs(f.total)
          return acc
        },
        { exento: 0, perciva: 0, percba: 0, percrn: 0, perclp: 0, bonrec1: 0, bonrec2: 0, neto1: 0, neto2: 0, iva1: 0, iva2: 0, total: 0 },
      )

    const totDeb  = sumFila(debitos)
    const totCred = sumFila(creditos)

    function totRow(label: string, t: typeof totales): string {
      const p = (v: number, w: number) => fmt(v).padStart(w)
      const prefix = label.padEnd(76)
      return prefix +
        p(t.exento,  10) + p(t.perciva, 11) + p(t.percba,  10) +
        p(t.percrn,  10) + p(t.perclp,  10) + p(t.bonrec1,  9) +
        p(t.bonrec2,  9) + p(t.neto1,   13) + p(t.neto2,   12) +
        p(t.iva1,    12) + p(t.iva2,    10) + p(t.total,   12)
    }

    const TOTALES_LABEL  = 'TOTALES' + '.'.repeat(69)
    const DEBITOS_LABEL  = 'TOTAL DE DEBITOS' + '.'.repeat(60)
    const CREDITOS_LABEL = 'TOTAL DE CREDITOS' + '.'.repeat(59)

    const lines: string[] = [
      ...HEADER_TXT,
      ...filas.map(formatFilaTXT),
      SEP,
      totRow(TOTALES_LABEL,  totales),
      '',
      totRow(DEBITOS_LABEL,  totDeb),
      totRow(CREDITOS_LABEL, totCred),
    ]

    const txt = lines.join('\r\n')
    return new Response(txt, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombreArchivo}.TXT"`,
      },
    })
  } catch (err: any) {
    console.error('[IVA Ventas Export] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Error generando reporte' },
      { status: 500 },
    )
  }
}
