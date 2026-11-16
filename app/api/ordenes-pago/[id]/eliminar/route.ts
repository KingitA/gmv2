import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso, tienePermiso } from '@/lib/auth'

/**
 * POST /api/ordenes-pago/[id]/eliminar — elimina la OP como si nunca hubiera
 * existido (RPC op_eliminar): si estaba pagada primero revierte todo
 * (kardex con contraasientos, cheques a cartera, saldos de comprobantes,
 * vencimientos a pendiente), después borra los movimientos de CC de la OP,
 * elimina el certificado de retención (fuera del TXT SICORE) y libera los
 * números de OP y certificado si eran los últimos de la serie.
 *
 * Permisos (E-65): hoy todo lo de órdenes de pago es solo de admin (Juan,
 * 16/11/2026). Si algún día otro rol puede armarlas (permiso ordenes_pago),
 * eliminar una OP ya pagada sigue siendo solo de admin: mueve plata al revertirse.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermiso('ordenes_pago')
    if (auth.error) return auth.error

    const { id: opId } = await params
    try {
        const body = await request.json().catch(() => ({}))
        const supabase = createAdminClient()

        const { data: op } = await supabase.from('ordenes_pago').select('estado').eq('id', opId).maybeSingle()
        if (!op) return NextResponse.json({ error: 'Orden de pago no encontrada' }, { status: 404 })
        if (op.estado !== 'pendiente' && !tienePermiso(auth.roles, 'ordenes_pago_confirmar')) {
            return NextResponse.json(
                { error: 'Solo un administrador puede eliminar una orden de pago que ya se pagó o se anuló.', error_code: 'SIN_PERMISO' },
                { status: 403 },
            )
        }

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
