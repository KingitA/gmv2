import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { pdfOrdenPago } from '@/lib/ordenes-pago/pdf'

/**
 * GET /api/ordenes-pago/[id]/pdf — PDF de la orden de pago con el detalle
 * completo: qué se paga (imputaciones), cómo (medios con cheques/transferencia/
 * efectivo), retenciones y neto. Se genera on-demand desde los datos
 * (lib/ordenes-pago/pdf.ts: el mismo archivo que se le manda al proveedor).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermiso('ordenes_pago')
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const pdf = await pdfOrdenPago(createAdminClient(), id)
    if (!pdf) return NextResponse.json({ error: 'Orden de pago no encontrada' }, { status: 404 })
    return new NextResponse(new Uint8Array(pdf.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdf.nombre}"`,
      },
    })
  } catch (error: any) {
    console.error('[ordenes-pago/pdf] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
