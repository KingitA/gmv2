import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

const BUCKET = 'comprobantes_venta'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // requireAuth controla el acceso; el cliente admin es necesario porque
  // el bucket es privado y firmar URLs requiere service role (el cliente
  // de sesión no tiene permiso de sign sobre storage).
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const supabase = createAdminClient()
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
    console.error('[PDF] Error firmando URL:', { pdf_path: comp.pdf_path, error: signErr?.message })
    const noExiste = (signErr?.message ?? '').toLowerCase().includes('not found')
    return NextResponse.json(
      noExiste
        ? {
            error: 'PDF no encontrado en el almacenamiento',
            mensaje: `El comprobante ${comp.numero_comprobante} tiene registrado un PDF pero el archivo no existe en el bucket.`,
          }
        : { error: 'No se pudo acceder al archivo PDF. Contacte al administrador.' },
      { status: noExiste ? 404 : 500 },
    )
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 })
}
