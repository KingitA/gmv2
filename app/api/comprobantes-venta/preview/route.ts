/**
 * GET /api/comprobantes-venta/preview?pedido_id=...
 *
 * Vista previa de comprobantes: genera UN PDF con los comprobantes que SALDRÍAN
 * del pedido — copia fiel del split real (cada ítem va a factura o presupuesto
 * según su método, y se agrupa igual que en la emisión). Un pedido de 10 ítems
 * (6 factura + 4 presupuesto) muestra una factura de 6 y un presupuesto de 4.
 *
 * Solo para revisar formato y precios:
 *   - NO se guarda en comprobantes_venta
 *   - NO se numera ni se sincroniza con ARCA
 *   - NO contacta ARCA (sin CAE/QR reales)
 *   - NO mueve stock ni cuenta corriente
 *   - NO aparece en ningún reporte ni en la conciliación
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { ComprobantesPreviewPDF } from '@/lib/pdf/comprobante-template'
import { buildPDFData } from '@/lib/pdf/generar'
import { armarComprobantesPreview } from '@/lib/comprobantes/armar-comprobantes-preview'
import { todayArgentina } from '@/lib/utils'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const pedidoId = new URL(request.url).searchParams.get('pedido_id')
    if (!pedidoId) {
      return NextResponse.json({ error: 'Falta pedido_id' }, { status: 400 })
    }

    const armado = await armarComprobantesPreview(supabase, pedidoId)
    if ('error' in armado) {
      return NextResponse.json({ error: armado.error }, { status: armado.status })
    }
    const { cliente, pedido, comprobantes } = armado

    if (comprobantes.length === 0) {
      return NextResponse.json({ error: 'El pedido no tiene ítems para previsualizar.' }, { status: 422 })
    }

    const { data: empresaConfig } = await supabase.from('configuracion_empresa').select('*').single()
    const { data: marcasTbl } = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
    const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

    const pvFiscal = String(empresaConfig?.arca_punto_venta ?? 7).padStart(4, '0')
    const fecha = todayArgentina()
    const pedidoPDF = { numero_pedido: pedido.numero_pedido, condicion_entrega: pedido.condicion_entrega }

    const dataPorComprobante = comprobantes.map((c) => {
      const pv = c.tipo === 'PRES' ? '0001' : pvFiscal
      return buildPDFData({
        comprobante: {
          id: 'preview', tipo_comprobante: c.tipo, numero_comprobante: `${pv}-PREVIEW`,
          fecha, total_neto: c.total_neto, total_iva: c.total_iva,
          percepcion_iva: c.percepcion_iva, percepcion_iibb: c.percepcion_iibb, total_factura: c.total_factura,
          cae: null, vencimiento_cae: null,
          observaciones: 'Vista previa — no es un comprobante emitido.', motivo_ajuste: null, qr_data_url: null,
        },
        cliente, empresa: empresaConfig, detalle: c.detalle, pedido: pedidoPDF, marcaDesc,
      })
    })

    const element = React.createElement(ComprobantesPreviewPDF, { comprobantes: dataPorComprobante }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
    const buffer = await renderToBuffer(element)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="vista-previa-${pedido.numero_pedido ?? pedidoId}.pdf"`,
      },
    })
  } catch (err: any) {
    console.error('[preview] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando la vista previa' }, { status: 500 })
  }
}
