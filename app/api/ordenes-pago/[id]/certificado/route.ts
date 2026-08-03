import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { RetencionPDF, type RetencionPDFData } from '@/lib/pdf/retencion-template'

/**
 * GET /api/ordenes-pago/[id]/certificado — PDF del certificado de retención
 * de Ganancias RG 830 emitido al confirmar la OP (retenciones_emitidas).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const supabase = createAdminClient()

    const { data: cert } = await supabase
      .from('retenciones_emitidas')
      .select('*, retencion_regimenes(descripcion), proveedores(nombre, cuit, direccion, localidad), ordenes_pago(numero_op, fecha, ordenes_pago_imputaciones(*))')
      .eq('orden_pago_id', id)
      .eq('estado', 'emitida')
      .limit(1)
      .maybeSingle()
    if (!cert) {
      return NextResponse.json({ error: 'Esta OP no tiene certificado de retención emitido (¿está confirmada y con retención > 0?)' }, { status: 404 })
    }

    const { data: empresa } = await supabase.from('configuracion_empresa').select('*').limit(1).single()

    const { data: bases } = await supabase.rpc('op_ganancias_bases', {
      p_imputaciones: (cert.ordenes_pago?.ordenes_pago_imputaciones || []).map((i: any) => ({
        movimiento_cc_id: i.movimiento_cc_id,
        vencimiento_id: i.vencimiento_id,
        comprobante_compra_id: i.comprobante_compra_id,
        monto_imputado: i.monto_imputado,
      })),
    })

    const data: RetencionPDFData = {
      empresa: {
        razon_social: empresa?.razon_social ?? '—',
        cuit: empresa?.cuit ?? '—',
        direccion: empresa?.direccion,
        logo_url: empresa?.logo_url,
      },
      cert: {
        numero_certificado: cert.numero_certificado,
        fecha: cert.fecha,
        base_calculo: Number(cert.base_calculo ?? 0),
        alicuota: Number(cert.alicuota ?? 0),
        monto: Number(cert.monto ?? 0),
        regimen_descripcion: cert.retencion_regimenes?.descripcion,
        ajuste_manual: cert.ajuste_manual,
      },
      op: {
        numero_op: cert.ordenes_pago?.numero_op ?? '—',
        fecha: cert.ordenes_pago?.fecha ?? cert.fecha,
      },
      proveedor: {
        nombre: cert.proveedores?.nombre ?? '—',
        cuit: cert.proveedores?.cuit,
        direccion: cert.proveedores?.direccion,
        localidad: cert.proveedores?.localidad,
      },
      comprobantes: ((bases as any)?.detalle ?? []).map((b: any) => ({
        etiqueta: b.etiqueta,
        fecha: cert.ordenes_pago?.fecha,
        monto: Number(b.monto_imputado ?? 0),
      })),
    }

    const element = React.createElement(RetencionPDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
    const buffer = await renderToBuffer(element)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="RET_${cert.numero_certificado}.pdf"`,
      },
    })
  } catch (error: any) {
    console.error('[ordenes-pago/certificado] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
