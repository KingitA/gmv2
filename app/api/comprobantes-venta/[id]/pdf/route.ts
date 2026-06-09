import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

const BUCKET = 'comprobantes_venta'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const { id }   = await params

  const { data: comp, error } = await supabase
    .from('comprobantes_venta')
    .select('id, numero_comprobante, tipo_comprobante, pdf_path, pdf_hash, estado_pdf')
    .eq('id', id)
    .single()

  if (error || !comp) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
  }

  if (!comp.pdf_path) {
    return NextResponse.json(
      {
        error: 'PDF no encontrado',
        mensaje: `El comprobante ${comp.numero_comprobante} no tiene PDF generado. Contacte al administrador.`,
        estado: comp.estado_pdf ?? 'pendiente',
      },
      { status: 404 },
    )
  }

  // Generar URL firmada fresca (signed URLs expiran — renovar en cada acceso)
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(comp.pdf_path, 3_600) // 1 hora — suficiente para visualización

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: 'No se pudo acceder al archivo PDF. Contacte al administrador.' },
      { status: 500 },
    )
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 })
}
