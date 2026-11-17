import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { anotarResponsableOP } from '@/lib/ordenes-pago/responsable'

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
    const auth = await requirePermiso('ordenes_pago_confirmar')
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

        const args = { p_op_id: opId, p_usuario_id: auth.user?.id ?? null, p_caja_id: cajaId, p_cuenta_banco_id: cuentaBancoId }
        // E-57: la retención se calcula con el día de la confirmación. Si cambió desde que se armó
        // la orden y la pantalla ya lo mostró y se aceptó (aceptar_retencion), se actualiza y se
        // confirma en la misma transacción. Sin la migración 20261117p_ordenes_pago_t1d.sql, o sin
        // aceptar, se confirma como siempre (y si cambió, la base corta con el motivo).
        let res = body.aceptar_retencion === true
            ? await supabase.rpc('op_confirmar_ajustando', args)
            : await supabase.rpc('op_confirmar', args)
        if (res.error && body.aceptar_retencion === true
            && (res.error.code === 'PGRST202' || res.error.code === '42883') && /op_confirmar_ajustando/.test(res.error.message || '')) {
            res = await supabase.rpc('op_confirmar', args)
        }
        const { data, error } = res
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })

        // Quién hizo salir la plata (Jarvis: "¿quién pagó / autorizó este pago?")
        await anotarResponsableOP(supabase, opId, 'confirmado', auth.user?.id)
        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error confirming OP:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

/**
 * GET /api/ordenes-pago/[id]/confirmar — antes de confirmar: qué retención de Ganancias
 * corresponde HOY (E-57: manda la fecha de confirmación) y si cambió respecto de la que se
 * guardó al armar la orden. No cambia nada.
 * → { cambia, retencion_guardada, retencion_hoy, neto_guardado, neto_hoy, se_puede_ajustar,
 *     medio_que_se_ajusta, fecha_pago, fecha_orden }
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermiso('ordenes_pago_confirmar')
    if (auth.error) return auth.error
    const { id: opId } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('op_retencion_al_confirmar', { p_op_id: opId })
    if (error) {
        // Sin la migración: no hay vista previa; se confirma como siempre
        if ((error.code === 'PGRST202' || error.code === '42883') && /op_retencion_al_confirmar/.test(error.message || '')) {
            return NextResponse.json({ cambia: false, disponible: false })
        }
        return NextResponse.json({ error: error.message }, { status: error.code === 'P0001' ? 400 : 500 })
    }
    return NextResponse.json({ ...(data as any), disponible: true })
}
