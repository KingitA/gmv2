import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { anotarResponsableOP } from '@/lib/ordenes-pago/responsable'
import { bloqueoAnularPorBanco } from '@/lib/bancos/operaciones'

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
    const auth = await requirePermiso('ordenes_pago_confirmar')
    if (auth.error) return auth.error

    const { id: opId } = await params
    try {
        const body = await request.json().catch(() => ({}))
        const supabase = createAdminClient()

        // Revisión 19/11: si Credicoop (banco real) ya hizo el pago, anular devolvería la deuda y
        // dejaría los vencimientos para pagar otra vez (pago doble). Desde 20261119n la base también lo corta.
        const banco = await bloqueoAnularPorBanco(supabase, opId)
        if (banco) return NextResponse.json({ error: banco, error_code: 'PAGADA_POR_BANCO' }, { status: 409 })

        const { data, error } = await supabase.rpc('op_anular', {
            p_op_id: opId,
            p_usuario_id: auth.user?.id ?? null,
            p_motivo: body.motivo ?? null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })

        await anotarResponsableOP(supabase, opId, 'anulado', auth.user?.id)
        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error anulando OP:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
