import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { PlanillaRetencionesPDF, type PlanillaRetencionesData } from '@/lib/pdf/planilla-retenciones-template'

/**
 * GET /api/retenciones/export?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&formato=txt|planilla
 *
 * El paquete mensual del contador:
 *   · formato=planilla → PDF "Planilla de Retenciones a las Ganancias"
 *   · formato=txt      → archivo de importación SICORE, CLONADO AL BYTE del
 *     sistema anterior (RET_OP_GAN_YYYYMM.TXT, registro fijo de 145 chars,
 *     ingeniería inversa del archivo real de junio 2026):
 *       [0:2]    código de comprobante '06' (orden de pago)
 *       [2:12]   fecha del comprobante DD/MM/YYYY
 *       [12:28]  N° comprobante: dígitos de la OP, 16 posiciones con ceros
 *       [28:44]  importe del comprobante (= base), 16 pos., 2 dec. con punto
 *       [44:52]  impuesto+régimen ('0217'+'0021', desde retencion_regimenes)
 *       [52:66]  base de cálculo, 14 posiciones
 *       [66:76]  fecha de la retención DD/MM/YYYY
 *       [76:93]  importe retenido, 17 posiciones
 *       [93:109] porcentaje de exclusión '  0.00' + 10 espacios
 *       [109:111] código de condición '80'
 *       [111:131] CUIT con guiones, 20 posiciones (pad derecha)
 *       [131:145] N° de certificado + espacio final
 *     Línea terminada en CRLF.
 */

const pad0 = (s: string, w: number) => s.padStart(w, '0')
const fmtImporte = (n: number, w: number) => pad0(n.toFixed(2), w)
const fmtFechaAR = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export async function GET(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const desde = searchParams.get('desde')
    const hasta = searchParams.get('hasta')
    const formato = searchParams.get('formato') || 'planilla'
    if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json({ error: 'desde y hasta (YYYY-MM-DD) son obligatorios' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: certs, error } = await supabase
      .from('retenciones_emitidas')
      .select('*, proveedores(nombre, cuit), ordenes_pago(numero_op, fecha), retencion_regimenes(codigo_impuesto_txt, codigo_regimen_txt)')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
    if (error) throw error

    const emitidas = (certs ?? []).filter((c: any) => c.estado === 'emitida')

    if (formato === 'txt') {
      const lineas = emitidas.map((c: any) => {
        const nroOpDigits = String(c.ordenes_pago?.numero_op ?? '').replace(/\D/g, '')
        const cuit = String(c.proveedores?.cuit ?? '').trim()
        const base = Number(c.base_calculo ?? 0)
        const monto = Number(c.monto ?? 0)
        return (
          '06' +
          fmtFechaAR(c.ordenes_pago?.fecha ?? c.fecha) +
          pad0(nroOpDigits, 16) +
          fmtImporte(base, 16) +
          (c.retencion_regimenes?.codigo_impuesto_txt ?? '0217') +
          (c.retencion_regimenes?.codigo_regimen_txt ?? '0021') +
          fmtImporte(base, 14) +
          fmtFechaAR(c.fecha) +
          fmtImporte(monto, 17) +
          '  0.00' + ' '.repeat(10) +
          '80' +
          cuit.padEnd(20, ' ') +
          (String(c.numero_certificado ?? '').padEnd(13, ' ')) + ' '
        )
      })
      const contenido = lineas.map((l) => l + '\r\n').join('')
      const nombre = `RET_OP_GAN_${desde.slice(0, 7).replace('-', '')}.TXT`
      return new NextResponse(contenido, {
        headers: {
          'Content-Type': 'text/plain; charset=ascii',
          'Content-Disposition': `attachment; filename="${nombre}"`,
        },
      })
    }

    // Planilla PDF (incluye anuladas tachadas para trazabilidad de la serie)
    const data: PlanillaRetencionesData = {
      empresa: await supabase.from('configuracion_empresa').select('razon_social, cuit, direccion').limit(1).single()
        .then((r) => ({ razon_social: r.data?.razon_social ?? '—', cuit: r.data?.cuit ?? '—', direccion: r.data?.direccion })),
      desde, hasta,
      filas: (certs ?? []).map((c: any) => ({
        fecha: c.fecha,
        numero_op: c.ordenes_pago?.numero_op ?? '—',
        numero_certificado: c.numero_certificado,
        proveedor: c.proveedores?.nombre ?? '—',
        cuit: c.proveedores?.cuit ?? '—',
        base: Number(c.base_calculo ?? 0),
        alicuota: Number(c.alicuota ?? 0),
        importe: Number(c.monto ?? 0),
        anulada: c.estado === 'anulada',
      })),
    }
    const element = React.createElement(PlanillaRetencionesPDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
    const buffer = await renderToBuffer(element)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="RET_GCIAS_${desde.slice(0, 7)}.pdf"`,
      },
    })
  } catch (error: any) {
    console.error('[retenciones/export] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
