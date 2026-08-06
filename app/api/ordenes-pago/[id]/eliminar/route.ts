import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/ordenes-pago/[id]/eliminar — elimina la OP como si nunca hubiera
 * existido (RPC op_eliminar): si estaba pagada primero revierte todo
 * (kardex con contraasientos, cheques a cartera, saldos de comprobantes,
 * vencimientos a pendiente), después borra los movimientos de CC de la OP,
 * elimina el certificado de retención (fuera del TXT SICORE) y libera los
 * números de OP y certificado si eran los últimos de la serie.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id: opId } = await params
    try {
        const body = await request.json().catch(() => ({}))
        const supabase = createAdminClient()

        const { data, error } = await supabase.rpc('op_eliminar', {
            p_op_id: opId,
            p_usuario_id: auth.user?.id ?? null,
            p_motivo: body.motivo ?? null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error eliminando OP:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
