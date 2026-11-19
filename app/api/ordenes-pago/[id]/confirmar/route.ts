import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { confirmarOrdenPago } from '@/lib/ordenes-pago/confirmar'
import { enviarOrdenAlProveedor } from '@/lib/ordenes-pago/envio'

export const maxDuration = 60

/**
 * POST /api/ordenes-pago/[id]/confirmar — confirma la OP vía RPC atómica
 * op_confirmar (migración 20260726_i1): CC proveedor + retenciones +
 * imputaciones + vencimientos + kardex (baja saldos de caja/banco) +
 * cheques ENTREGADO_A_PROVEEDOR, todo en una transacción con guards
 * de idempotencia. El camino es confirmarOrdenPago (lib/ordenes-pago/confirmar.ts),
 * el mismo que usa la confirmación sola cuando el banco confirma la firma.
 *
 * Body opcional: { caja_id?, cuenta_bancaria_id?, aceptar_retencion? } — de dónde sale la plata.
 *   caja_id: origen del efectivo (default Caja Grande)
 *   cuenta_bancaria_id: origen de transferencias (obligatorio si la OP incluye alguna)
 *
 * Después de confirmar, la orden se le manda al proveedor por mail si tiene a quién (decisión de
 * Juan, 19/11/2026). Si no tiene mail queda pagada sin enviar; si el mail falla, la orden sigue
 * pagada y se reintenta desde la pantalla. La respuesta trae `envio` con lo que pasó.
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

        const r = await confirmarOrdenPago(supabase, opId, auth.user?.id ?? null, {
            cajaId: body.caja_id ?? null, cuentaBancoId: body.cuenta_bancaria_id ?? null, aceptarRetencion: body.aceptar_retencion === true,
        })
        if (!r.ok) return NextResponse.json({ error: r.error, ...(r.error_code ? { error_code: r.error_code } : {}) }, { status: r.status })

        // Ya estaba confirmada (doble clic, o la confirmó el banco recién): no se manda otro mail
        if (r.data?.ya_confirmada === true) return NextResponse.json(r.data)
        // La orden ya está pagada: el envío nunca la hace fallar
        const envio = await enviarOrdenAlProveedor(supabase, opId, { usuarioId: auth.user?.id ?? null, origen: 'confirmacion' })
        return NextResponse.json({ ...r.data, envio })
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
