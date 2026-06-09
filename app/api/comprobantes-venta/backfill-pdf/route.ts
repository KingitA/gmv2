/**
 * POST /api/comprobantes-venta/backfill-pdf
 *
 * Genera PDFs para comprobantes que no tienen pdf_path todavía.
 * Parámetros (body JSON, todos opcionales):
 *   - id: string        → backfill de un solo comprobante
 *   - limit: number     → cuántos procesar en este batch (default 10, max 50)
 *
 * Solo accesible por usuarios autenticados.
 * Puede tardar varios segundos — no usar desde UI síncrona.
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildSnapshot } from '@/lib/pdf/generar'

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const supabase  = await createClient()
  const body      = await request.json().catch(() => ({}))
  const soloId    = body.id as string | undefined
  const limite    = Math.min(Number(body.limit ?? 10), 50)

  // ─── Cargar empresa y marcas (compartido entre todos los comprobantes) ───
  const [{ data: empresaData }, { data: marcasTbl }] = await Promise.all([
    supabase.from('configuracion_empresa').select('*').single(),
    supabase.from('marcas').select('id, descripcion').eq('activo', true),
  ])
  const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

  // ─── Consultar comprobantes sin PDF ───
  let query = supabase
    .from('comprobantes_venta')
    .select(`
      id, tipo_comprobante, numero_comprobante, punto_venta, fecha,
      total_neto, total_iva, percepcion_iva, percepcion_iibb, total_factura,
      cae, vencimiento_cae, observaciones, motivo_ajuste, anulado_en,
      clientes!inner(
        id, nombre_razon_social, cuit, condicion_iva, condicion_pago,
        direccion, localidad, telefono
      ),
      pedidos(numero_pedido, condicion_entrega, vendedores(nombre)),
      comprobantes_venta_detalle(
        articulo_id, descripcion, cantidad, precio_unitario, precio_total,
        articulos(descripcion, sku, descuento_propio, marca_id)
      )
    `)
    .is('pdf_path', null)
    .is('anulado_en', null)
    .order('fecha', { ascending: true })

  if (soloId) {
    query = query.eq('id', soloId)
  } else {
    query = query.limit(limite)
  }

  const { data: comprobantes, error: fetchErr } = await query
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!comprobantes?.length) {
    return NextResponse.json({ message: 'No hay comprobantes pendientes de PDF', procesados: 0 })
  }

  const resultados: Array<{ id: string; numero: string; ok: boolean; error?: string }> = []

  for (const comp of comprobantes) {
    try {
      const cliente  = (comp as any).clientes
      const pedido   = (comp as any).pedidos
      const detalle  = (comp as any).comprobantes_venta_detalle ?? []

      // Generar QR si tiene CAE y CUIT
      let qrDataUrl: string | undefined
      if (comp.cae && cliente?.cuit) {
        try {
          qrDataUrl = await generarQRBase64({
            cuit:       empresaData?.cuit ?? '',
            ptoVta:     comp.punto_venta ?? '0007',
            tipoCmp:    comp.tipo_comprobante,
            nroCmp:     comp.numero_comprobante,
            importe:    Math.abs(Number(comp.total_factura ?? 0)),
            fecha:      comp.fecha,
            tipoDocRec: 80,
            nroDocRec:  cliente.cuit,
            cae:        comp.cae,
          })
        } catch { /* QR opcional */ }
      }

      const pdfData = buildPDFData({
        comprobante:   comp,
        cliente,
        empresa:       empresaData,
        detalle,
        pedido,
        bonificaciones: [],
        marcaDesc,
        qrDataUrl,
      })

      const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData)
      const snapshot = buildSnapshot(pdfData)

      await supabase.from('comprobantes_venta').update({
        pdf_url:              pdfUrl,
        pdf_path:             pdfPath,
        pdf_hash:             pdfHash,
        fecha_generacion_pdf: new Date().toISOString(),
        estado_pdf:           'generado',
        pdf_snapshot:         snapshot,
      }).eq('id', comp.id)

      resultados.push({ id: comp.id, numero: comp.numero_comprobante, ok: true })
    } catch (err: any) {
      console.error('[backfill-pdf] Error en', comp.numero_comprobante, err.message)
      await supabase.from('comprobantes_venta')
        .update({ estado_pdf: 'error' })
        .eq('id', comp.id)
        .catch(() => {})
      resultados.push({ id: comp.id, numero: comp.numero_comprobante, ok: false, error: err.message })
    }
  }

  const exitosos = resultados.filter(r => r.ok).length
  return NextResponse.json({
    procesados: resultados.length,
    exitosos,
    errores:    resultados.length - exitosos,
    detalle:    resultados,
  })
}
