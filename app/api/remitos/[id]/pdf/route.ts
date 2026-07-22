import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

const BUCKET = 'comprobantes_venta'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // requireAuth controla el acceso; el cliente admin es necesario porque
  // el bucket es privado y firmar URLs requiere service role.
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const supabase = createAdminClient()
  const { id }   = await params

  const { data: remito, error } = await supabase
    .from('remitos')
    .select('id, numero_remito, tipo_remito, pdf_path, estado_pdf, estado')
    .eq('id', id)
    .single()

  if (error || !remito) {
    return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
  }

  if (!remito.pdf_path) {
    return NextResponse.json(
      {
        error: 'PDF no encontrado',
        mensaje: `El remito ${remito.numero_remito} no tiene PDF generado.`,
        estado: remito.estado_pdf ?? 'pendiente',
      },
      { status: 404 },
    )
  }

  // URL firmada fresca (las signed URLs expiran — renovar en cada acceso)
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(remito.pdf_path, 3_600)

  if (signErr || !signed?.signedUrl) {
    console.error('[Remito PDF] Error firmando URL:', { pdf_path: remito.pdf_path, error: signErr?.message })
    const noExiste = (signErr?.message ?? '').toLowerCase().includes('not found')
    return NextResponse.json(
      noExiste
        ? { error: 'PDF no encontrado en el almacenamiento', mensaje: `El remito ${remito.numero_remito} tiene registrado un PDF pero el archivo no existe en el bucket.` }
        : { error: 'No se pudo acceder al archivo PDF. Contacte al administrador.' },
      { status: noExiste ? 404 : 500 },
    )
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 })
}
