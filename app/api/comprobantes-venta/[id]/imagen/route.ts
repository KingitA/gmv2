import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

// Este endpoint está deprecado — redirige al PDF inmutable guardado en Supabase Storage.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const { id } = await params
  return NextResponse.redirect(
    new URL(`/api/comprobantes-venta/${id}/pdf`, _request.url),
    { status: 301 },
  )
}
