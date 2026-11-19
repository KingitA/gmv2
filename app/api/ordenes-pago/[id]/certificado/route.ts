import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { pdfCertificadoRetencion } from '@/lib/ordenes-pago/pdf'

/**
 * GET /api/ordenes-pago/[id]/certificado — PDF del certificado de retención
 * de Ganancias RG 830 emitido al confirmar la OP (retenciones_emitidas).
 * Lo arma lib/ordenes-pago/pdf.ts: el mismo archivo que se le manda al proveedor.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermiso('ordenes_pago')
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const pdf = await pdfCertificadoRetencion(createAdminClient(), id)
    if (!pdf) {
      return NextResponse.json({ error: 'Esta OP no tiene certificado de retención emitido (¿está confirmada y con retención > 0?)' }, { status: 404 })
    }
    return new NextResponse(new Uint8Array(pdf.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdf.nombre}"`,
      },
    })
  } catch (error: any) {
    console.error('[ordenes-pago/certificado] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
