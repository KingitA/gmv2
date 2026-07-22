import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { generarRemitosParaPedido } from '@/lib/remitos/generar-remito'

/**
 * POST { pedido_id } — genera los remitos pendientes de un pedido ya facturado.
 * Idempotente: los comprobantes que ya tienen remito activo se saltean.
 * Casos de uso: reintento cuando la facturación devolvió errores en remitos,
 * y backfill de pedidos facturados antes del módulo de remitos.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { pedido_id } = await request.json()
    if (!pedido_id) {
      return NextResponse.json({ error: 'pedido_id es requerido' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const resultado = await generarRemitosParaPedido(supabase, pedido_id, auth.user.id)

    return NextResponse.json({
      success: resultado.errores.length === 0,
      ...resultado,
    })
  } catch (error: any) {
    console.error('[Remitos generar] Error:', error)
    return NextResponse.json({ error: error.message || 'Error generando remitos' }, { status: 500 })
  }
}
