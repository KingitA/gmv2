import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { anularComprobante, CorteAnulacion } from '@/lib/comprobantes/anular-comprobante'

// Anula UN comprobante (emite su inverso). La lógica vive en
// lib/comprobantes/anular-comprobante.ts (la usa también la anulación de todo
// el pedido, POST /api/pedidos/[id]/anular-comprobantes).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id } = await params
    return NextResponse.json(await anularComprobante(createAdminClient(), id, auth.user.id))
  } catch (error: any) {
    if (error instanceof CorteAnulacion) return NextResponse.json(error.body, { status: error.status })
    console.error('[Anular Comprobante] Error:', error)
    return NextResponse.json({ error: error.message || 'Error anulando comprobante' }, { status: 500 })
  }
}
