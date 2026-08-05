import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/ordenes-pago/[id]/confirmar — confirma la OP vía RPC atómica
 * op_confirmar (migración 20260726_i1): CC proveedor + retenciones +
 * imputaciones + vencimientos + kardex (baja saldos de caja/banco) +
 * cheques ENTREGADO_A_PROVEEDOR, todo en una transacción con guards
 * de idempotencia.
 *
 * Body opcional: { caja_id?, cuenta_bancaria_id? } — de dónde sale la plata.
 *   caja_id: origen del efectivo (default Caja Grande)
 *   cuenta_bancaria_id: origen de transferencias (obligatorio si la OP incluye alguna)
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

        // Si la OP guardó el origen de fondos al crearse (cuenta_origen_* en el
        // detalle), usarlo sin volver a preguntar. El body explícito gana.
        let cajaId = body.caja_id ?? null
        let cuentaBancoId = body.cuenta_bancaria_id ?? null
        if (!cajaId || !cuentaBancoId) {
            const { data: det } = await supabase
                .from('ordenes_pago_detalle')
                .select('cuenta_origen_tipo, cuenta_origen_id')
                .eq('orden_pago_id', opId)
            if (!cajaId) cajaId = det?.find(d => d.cuenta_origen_tipo === 'CAJA' && d.cuenta_origen_id)?.cuenta_origen_id ?? null
            if (!cuentaBancoId) cuentaBancoId = det?.find(d => d.cuenta_origen_tipo === 'BANCO' && d.cuenta_origen_id)?.cuenta_origen_id ?? null
        }

        const { data, error } = await supabase.rpc('op_confirmar', {
            p_op_id: opId,
            p_usuario_id: auth.user?.id ?? null,
            p_caja_id: cajaId,
            p_cuenta_banco_id: cuentaBancoId,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error confirming OP:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
