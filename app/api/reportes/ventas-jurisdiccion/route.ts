/**
 * GET /api/reportes/ventas-jurisdiccion
 *
 * Ventas netas por jurisdicción/provincia de destino por período, desde
 * kardex.provincia_destino. Insumo para que el contador arme los coeficientes
 * del CM05 (Convenio Multilateral).
 *
 * SOLO comprobantes fiscales (FA/FB/NCA/NCB/NDA/NDB) — PRES/REV/REM son
 * documentos internos y quedan excluidos explícitamente.
 * Las NC restan (signo del kardex), las ND suman.
 *
 * Query params:
 *   desde    YYYY-MM-DD  requerido
 *   hasta    YYYY-MM-DD  requerido
 *   formato  json | csv  default: csv
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

const TIPOS_FISCALES = ['FA', 'FB', 'NCA', 'NCB', 'NDA', 'NDB']

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const desde   = searchParams.get('desde')
    const hasta   = searchParams.get('hasta')
    const formato = (searchParams.get('formato') ?? 'csv').toLowerCase()

    if (!desde || !hasta) {
      return NextResponse.json({ error: "Parámetros requeridos: desde y hasta (YYYY-MM-DD)" }, { status: 400 })
    }

    // Paginar el kardex del período (solo movimientos de comprobantes fiscales)
    // fetchAllRows pagina de a 1000 con orden estable por id
    const filas: any[] = await fetchAllRows(() => supabase
      .from('kardex')
      .select('provincia_destino, tipo_comprobante, tipo_movimiento, signo, subtotal_neto, subtotal_iva, subtotal_total')
      .in('tipo_comprobante', TIPOS_FISCALES)
      .gte('fecha', desde)
      .lte('fecha', hasta))

    // Agrupar por provincia de destino — NC restan (signo +1 en kardex pero es crédito)
    const porJurisdiccion = new Map<string, { neto: number; iva: number; total: number; movimientos: number }>()

    for (const f of filas) {
      const prov = (f.provincia_destino ?? 'Sin asignar').trim() || 'Sin asignar'
      // Sentido económico de la venta: venta/ND suman, NC restan
      const esNC = (f.tipo_comprobante ?? '').startsWith('NC')
      const factor = esNC ? -1 : 1
      const acc = porJurisdiccion.get(prov) ?? { neto: 0, iva: 0, total: 0, movimientos: 0 }
      acc.neto  += factor * Math.abs(Number(f.subtotal_neto  ?? 0))
      acc.iva   += factor * Math.abs(Number(f.subtotal_iva   ?? 0))
      acc.total += factor * Math.abs(Number(f.subtotal_total ?? 0))
      acc.movimientos += 1
      porJurisdiccion.set(prov, acc)
    }

    const r2 = (n: number) => Math.round(n * 100) / 100
    const resultado = [...porJurisdiccion.entries()]
      .map(([provincia, v]) => ({
        provincia,
        ventas_netas: r2(v.neto),
        iva:          r2(v.iva),
        total:        r2(v.total),
        movimientos:  v.movimientos,
      }))
      .sort((a, b) => b.ventas_netas - a.ventas_netas)

    const totalNeto = r2(resultado.reduce((s, r) => s + r.ventas_netas, 0))

    if (formato === 'json') {
      return NextResponse.json({ desde, hasta, total_neto: totalNeto, jurisdicciones: resultado })
    }

    // CSV
    const lineas = [
      'PROVINCIA;VENTAS_NETAS;IVA;TOTAL;MOVIMIENTOS;COEFICIENTE',
      ...resultado.map(r =>
        `${r.provincia};${r.ventas_netas.toFixed(2)};${r.iva.toFixed(2)};${r.total.toFixed(2)};${r.movimientos};${totalNeto !== 0 ? (r.ventas_netas / totalNeto).toFixed(6) : '0'}`
      ),
      `TOTAL;${totalNeto.toFixed(2)};;;;`,
    ]
    const buffer = Buffer.from(lineas.join('\r\n') + '\r\n', 'latin1')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'text/csv; charset=iso-8859-1',
        'Content-Disposition': `attachment; filename="ventas_jurisdiccion_${desde}_${hasta}.csv"`,
      },
    })
  } catch (err: any) {
    console.error('[ventas-jurisdiccion] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
