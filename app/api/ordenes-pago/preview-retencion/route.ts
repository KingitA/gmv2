import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/ordenes-pago/preview-retencion — desglose de la retención de
 * Ganancias RG 830 para la pantalla de Nueva OP, en vivo.
 *
 * Body: { proveedor_id, imputaciones: [{ movimiento_cc_id?, vencimiento_id?,
 *         comprobante_compra_id?, monto_imputado }], fecha? }
 *
 * → RPC op_ganancias_preview: bases por imputación (neto exacto de factura
 *   prorrateado, o estimado monto/1,21), acumulado mensual del proveedor,
 *   mínimo, alícuota según condición, exclusiones, y la retención al centavo.
 */
export async function POST(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await request.json()
        if (!body.proveedor_id) {
            return NextResponse.json({ error: 'proveedor_id es obligatorio' }, { status: 400 })
        }
        const supabase = createAdminClient()
        const { data, error } = await supabase.rpc('op_ganancias_preview', {
            p_proveedor_id: body.proveedor_id,
            p_imputaciones: body.imputaciones ?? [],
            p_fecha: body.fecha ?? null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json(data)
    } catch (error: any) {
        console.error('[ordenes-pago/preview-retencion] error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
