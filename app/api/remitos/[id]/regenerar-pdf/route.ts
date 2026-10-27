import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { rehacerPDFRemito } from '@/lib/remitos/rehacer-pdf'

/**
 * POST — regenera el PDF de un remito huérfano (estado_pdf != 'generado').
 * Re-renderiza desde la fila ya numerada de `remitos` + `remitos_detalle`:
 * misma numeración y mismo contenido, no viola la inmutabilidad.
 * Si el PDF ya está generado → 409 (el remito emitido jamás se reemplaza).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const { id }   = await params

    const { data: remito, error } = await supabase
      .from('remitos')
      .select('id, numero_remito, estado_pdf')
      .eq('id', id)
      .single()

    if (error || !remito) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }
    if (remito.estado_pdf === 'generado') {
      return NextResponse.json(
        { error: `El remito ${remito.numero_remito} ya tiene PDF generado. Los remitos emitidos son inmutables.` },
        { status: 409 },
      )
    }

    const { pdfUrl, pdfPath, pdfHash } = await rehacerPDFRemito(supabase, remito.id)

    return NextResponse.json({ success: true, pdf_url: pdfUrl, pdf_path: pdfPath, pdf_hash: pdfHash })
  } catch (error: any) {
    console.error('[Remitos regenerar-pdf] Error:', error)
    return NextResponse.json({ error: error.message || 'Error regenerando PDF' }, { status: 500 })
  }
}
