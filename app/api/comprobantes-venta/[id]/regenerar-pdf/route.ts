/**
 * POST /api/comprobantes-venta/[id]/regenerar-pdf
 *
 * Regenera el PDF de un comprobante YA EMITIDO usando los datos congelados de
 * la DB (CAE, totales y fecha ORIGINALES — no recalcula nada, no toca ARCA).
 * Para comprobantes con estado_pdf pendiente/error cuya generación falló.
 *
 * Usa upsert en el bucket para reemplazar archivos huérfanos de intentos previos.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from '@/lib/pdf/generar'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: comp, error } = await supabase
      .from('comprobantes_venta')
      .select(`
        *,
        clientes(*),
        pedidos(numero_pedido, condicion_entrega, vendedores(nombre)),
        comprobantes_venta_detalle(*, articulos(descripcion, sku, descuento_propio, marca_id))
      `)
      .eq('id', id)
      .single()

    if (error || !comp) {
      return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    }

    const { data: empresaData } = await supabase.from('configuracion_empresa').select('*').single()
    const { data: marcasTbl }   = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
    const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

    // QR con los datos ORIGINALES del comprobante (fecha de emisión, importe, CAE)
    let qrDataUrl: string | undefined
    let qrUrl: string | undefined
    if (comp.cae && comp.clientes?.cuit && comp.punto_venta) {
      try {
        const qrParams = {
          cuit:       empresaData?.cuit ?? '',
          ptoVta:     comp.punto_venta,
          tipoCmp:    comp.tipo_comprobante,
          nroCmp:     comp.numero_comprobante,
          importe:    Math.abs(Number(comp.total_factura ?? 0)),
          fecha:      comp.fecha,            // fecha ORIGINAL de emisión
          tipoDocRec: 80,
          nroDocRec:  comp.clientes.cuit,
          cae:        comp.cae,
        }
        qrUrl     = buildQRUrl(qrParams)
        qrDataUrl = await generarQRBase64(qrParams)
      } catch (qrErr: any) {
        console.error('[Regenerar PDF QR] Error:', qrErr.message)
      }
    }

    const pdfData = buildPDFData({
      comprobante:   comp,
      cliente:       comp.clientes,
      empresa:       empresaData,
      detalle:       comp.comprobantes_venta_detalle ?? [],
      pedido:        comp.pedidos,
      bonificaciones: [],
      marcaDesc,
      qrDataUrl,
    })

    const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData, { upsert: true })
    const snapshot = buildSnapshot(pdfData)

    await supabase.from('comprobantes_venta').update({
      pdf_url:              pdfUrl,
      pdf_path:             pdfPath,
      pdf_hash:             pdfHash,
      fecha_generacion_pdf: new Date().toISOString(),
      estado_pdf:           'generado',
      pdf_snapshot:         snapshot,
      qr_url:               qrUrl ?? null,
    }).eq('id', comp.id)

    return NextResponse.json({
      success: true,
      comprobante: comp.numero_comprobante,
      tipo:        comp.tipo_comprobante,
      pdf_path:    pdfPath,
      qr:          !!qrDataUrl,
    })
  } catch (err: any) {
    console.error('[Regenerar PDF] Error:', err)
    return NextResponse.json({ error: err.message || 'Error regenerando PDF' }, { status: 500 })
  }
}
