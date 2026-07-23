import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/ordenes-pago/[id]/anular — reversa completa de una OP pagada
 * vía RPC op_anular (migración 20260726_i1): contrapartidas en kardex
 * (restauran saldos), cheques de terceros vuelven a cartera, propios se
 * anulan, CC del proveedor con contra-asiento, vencimientos a pendiente.
 *
 * Body: { motivo? }
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

        const { data, error } = await supabase.rpc('op_anular', {
            p_op_id: opId,
            p_usuario_id: auth.user?.id ?? null,
            p_motivo: body.motivo ?? null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error anulando OP:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
