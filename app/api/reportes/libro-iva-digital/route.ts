/**
 * GET /api/reportes/libro-iva-digital
 *
 * Export con el formato oficial de ARCA para el Libro IVA Digital (RG 4597) — Ventas.
 * Genera los archivos de importación de registro de ancho fijo:
 *   LIBRO_IVA_DIGITAL_VENTAS_CBTE      (266 posiciones por registro)
 *   LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS (62 posiciones por registro)
 * Diseño según libro-iva-digital-especificaciones.pdf (rev. 30/07/2025) y los
 * diseños de registro publicados por ARCA.
 *
 * Solo incluye comprobantes fiscales (FA/FB/NCA/NCB/NDA/NDB) con CAE.
 * PRES/REM/REV son documentos internos y quedan excluidos.
 * Todo a alícuota 21% (código 0005) — la empresa no opera con 10,5% ni exentos,
 * salvo clientes exento_iva (operación exenta: código de operación 'E').
 *
 * Query params:
 *   mes      MM    requerido (01-12)
 *   anio     YYYY  requerido
 *   archivo  cbte | alicuotas   default: cbte
 *
 * Importes en valores positivos (las NC restan por su tipo de comprobante).
 * Codificación de salida latin1 (ISO 8859-1, compatible ANSI/Windows-1252).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'

// Tipo de comprobante según tabla Comprobantes Ventas del Libro IVA Digital (3 dígitos)
const TIPO_LID: Record<string, string> = {
  FA: '001', NDA: '002', NCA: '003',
  FB: '006', NDB: '007', NCB: '008',
}

const ALICUOTA_21 = '0005'  // código de alícuota 21% según tabla del sistema
const ALICUOTA_0  = '0003'  // código de alícuota 0%

// Importe: 15 posiciones, 13 enteros + 2 decimales, sin punto, ceros a la izquierda.
// Valores positivos siempre (el signo lo da el tipo de comprobante).
function imp15(n: number): string {
  const centavos = Math.round(Math.abs(n) * 100)
  return String(centavos).padStart(15, '0')
}

// Numérico de ancho fijo con ceros a la izquierda
function num(val: string | number, width: number): string {
  return String(val).replace(/\D/g, '').padStart(width, '0').slice(-width)
}

// Alfanumérico de ancho fijo: blancos a la derecha, sin caracteres fuera de latin1
function alfa(val: string, width: number): string {
  const limpio = (val ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .replace(/[^\x20-\xFF]/g, ' ')                      // solo latin1 imprimible
  return limpio.slice(0, width).padEnd(width, ' ')
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const mes     = searchParams.get('mes')
    const anio    = searchParams.get('anio')
    const archivo = (searchParams.get('archivo') ?? 'cbte').toLowerCase()

    if (!mes || !anio || !/^\d{2}$/.test(mes) || !/^\d{4}$/.test(anio)) {
      return NextResponse.json(
        { error: "Parámetros requeridos: mes (MM) y anio (YYYY). Opcional: archivo=cbte|alicuotas" },
        { status: 400 },
      )
    }

    const desde = `${anio}-${mes}-01`
    const hastaDate = new Date(parseInt(anio), parseInt(mes), 0) // último día del mes
    const hasta = `${anio}-${mes}-${String(hastaDate.getDate()).padStart(2, '0')}`

    const { data: comprobantes, error } = await supabase
      .from('comprobantes_venta')
      .select(`
        id, tipo_comprobante, numero_comprobante, punto_venta, fecha,
        total_neto, total_iva, percepcion_iva, percepcion_iibb, total_factura, cae,
        clientes(nombre_razon_social, nombre, cuit, condicion_iva, exento_iva)
      `)
      .in('tipo_comprobante', ['FA', 'FB', 'NCA', 'NCB', 'NDA', 'NDB'])
      .not('cae', 'is', null)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('numero_comprobante', { ascending: true })

    if (error) throw error

    const lineasCbte: string[] = []
    const lineasAlic: string[] = []

    for (const comp of comprobantes ?? []) {
      const cli = (comp as any).clientes
      const tipoLid = TIPO_LID[comp.tipo_comprobante]
      if (!tipoLid) continue

      const fecha   = (comp.fecha ?? '').replace(/-/g, '')             // AAAAMMDD
      const ptoVta  = num(comp.numero_comprobante?.split('-')[0] ?? comp.punto_venta ?? '', 5)
      const nroCbte = num(comp.numero_comprobante?.split('-')[1] ?? '', 20)
      const cuit    = num((cli?.cuit ?? '').replace(/\D/g, ''), 20)
      const nombre  = alfa(cli?.nombre_razon_social ?? cli?.nombre ?? '', 30)

      const neto    = Math.abs(Number(comp.total_neto ?? 0))
      const iva     = Math.abs(Number(comp.total_iva ?? 0))
      const percIva = Math.abs(Number(comp.percepcion_iva ?? 0))
      const percIibb= Math.abs(Number(comp.percepcion_iibb ?? 0))
      const total   = Math.abs(Number(comp.total_factura ?? 0))

      const esExenta = iva === 0  // operación exenta (cliente exento_iva): neto va a campo 12

      // ── Registro CBTE (266 posiciones) ──
      const linea =
        fecha +                                  //  1: fecha (8)
        tipoLid +                                //  2: tipo comprobante (3)
        ptoVta +                                 //  3: punto de venta (5)
        nroCbte +                                //  4: número de comprobante (20)
        nroCbte +                                //  5: número hasta (20) — igual al 4
        '80' +                                   //  6: código documento comprador: CUIT (2)
        cuit +                                   //  7: nro identificación comprador (20)
        nombre +                                 //  8: razón social (30)
        imp15(total) +                           //  9: importe total operación (15)
        imp15(0) +                               // 10: conceptos que no integran neto (15)
        imp15(0) +                               // 11: percepción a no categorizados (15)
        imp15(esExenta ? neto : 0) +             // 12: operaciones exentas (15)
        imp15(percIva) +                         // 13: percepciones imp. nacionales — Percep. IVA RG 5329 (15)
        imp15(percIibb) +                        // 14: percepciones IIBB (15)
        imp15(0) +                               // 15: percepciones municipales (15)
        imp15(0) +                               // 16: impuestos internos (15)
        'PES' +                                  // 17: código moneda (3)
        '0001000000' +                           // 18: tipo de cambio 1.000000 (10)
        '1' +                                    // 19: cantidad de alícuotas (1)
        (esExenta ? 'E' : ' ') +                 // 20: código de operación (1)
        imp15(0) +                               // 21: otros tributos (15)
        '00000000'                               // 22: fecha vencimiento o pago (8)

      lineasCbte.push(linea)

      // ── Registro ALICUOTAS (62 posiciones) — mismo orden que CBTE ──
      const lineaAlic =
        tipoLid +                                // 1: tipo comprobante (3)
        ptoVta +                                 // 2: punto de venta (5)
        nroCbte +                                // 3: número de comprobante (20)
        imp15(esExenta ? 0 : neto) +             // 4: importe neto gravado (15)
        (esExenta ? ALICUOTA_0 : ALICUOTA_21) +  // 5: alícuota (4)
        imp15(iva)                               // 6: impuesto liquidado (15)

      lineasAlic.push(lineaAlic)
    }

    const esAlicuotas = archivo === 'alicuotas'
    const contenido = (esAlicuotas ? lineasAlic : lineasCbte).join('\r\n') + '\r\n'
    const nombreArchivo = esAlicuotas
      ? `LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${mes}${anio}.txt`
      : `LIBRO_IVA_DIGITAL_VENTAS_CBTE_${mes}${anio}.txt`

    // ANSI (latin1) según especificación — los importadores de ARCA no aceptan UTF-8
    const buffer = Buffer.from(contenido, 'latin1')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'text/plain; charset=iso-8859-1',
        'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
        'X-Registros': String(esAlicuotas ? lineasAlic.length : lineasCbte.length),
      },
    })
  } catch (err: any) {
    console.error('[libro-iva-digital] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando Libro IVA Digital' }, { status: 500 })
  }
}
