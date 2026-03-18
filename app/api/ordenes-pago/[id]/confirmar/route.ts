import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { nowArgentina } from '@/lib/utils'

// POST /api/ordenes-pago/[id]/confirmar
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id: opId } = await params
    const supabase = createAdminClient()

    // 1. Get OP with details
    const { data: op, error: opError } = await supabase
        .from('ordenes_pago')
        .select(`
            *,
            proveedores(id, nombre),
            ordenes_pago_detalle(*),
            ordenes_pago_imputaciones(*)
        `)
        .eq('id', opId)
        .single()

    if (opError || !op) {
        return NextResponse.json({ error: 'Orden de pago no encontrada' }, { status: 404 })
    }

    if (op.estado === 'pagada') {
        return NextResponse.json({ error: 'Esta orden ya fue confirmada' }, { status: 400 })
    }

    try {
        // 2. Create payment movement in CC proveedores
        const { data: pagoMov, error: pagoError } = await supabase
            .from('cuenta_corriente_proveedores')
            .insert({
                proveedor_id: op.proveedor_id,
                fecha: nowArgentina(),
                tipo_movimiento: 'pago',
                monto: -(op.neto_a_pagar), // Negative = reduces debt
                descripcion: `Pago ${op.numero_op}`,
                referencia_id: op.id,
                referencia_tipo: 'orden_pago',
                numero_comprobante: op.numero_op,
                tipo_comprobante: 'OP'
            })
            .select()
            .single()

        if (pagoError) throw pagoError

        // 3. If there are retenciones, create separate CC entries for each
        if (op.total_retenciones > 0) {
            const retenciones = []
            if (op.retencion_ganancias > 0) {
                retenciones.push({
                    proveedor_id: op.proveedor_id,
                    fecha: nowArgentina(),
                    tipo_movimiento: 'retencion',
                    monto: -(op.retencion_ganancias),
                    descripcion: `Ret. Ganancias ${op.numero_op}`,
                    referencia_id: op.id,
                    referencia_tipo: 'orden_pago'
                })
            }
            if (op.retencion_iibb > 0) {
                retenciones.push({
                    proveedor_id: op.proveedor_id,
                    fecha: nowArgentina(),
                    tipo_movimiento: 'retencion',
                    monto: -(op.retencion_iibb),
                    descripcion: `Ret. IIBB ${op.numero_op}`,
                    referencia_id: op.id,
                    referencia_tipo: 'orden_pago'
                })
            }
            if (op.retencion_iva > 0) {
                retenciones.push({
                    proveedor_id: op.proveedor_id,
                    fecha: nowArgentina(),
                    tipo_movimiento: 'retencion',
                    monto: -(op.retencion_iva),
                    descripcion: `Ret. IVA ${op.numero_op}`,
                    referencia_id: op.id,
                    referencia_tipo: 'orden_pago'
                })
            }
            if (op.retencion_suss > 0) {
                retenciones.push({
                    proveedor_id: op.proveedor_id,
                    fecha: nowArgentina(),
                    tipo_movimiento: 'retencion',
                    monto: -(op.retencion_suss),
                    descripcion: `Ret. SUSS ${op.numero_op}`,
                    referencia_id: op.id,
                    referencia_tipo: 'orden_pago'
                })
            }

            if (retenciones.length > 0) {
                await supabase.from('cuenta_corriente_proveedores').insert(retenciones)
            }
        }

        // 4. Create imputaciones in the legacy system too
        if (pagoMov && op.ordenes_pago_imputaciones?.length > 0) {
            const impInserts = op.ordenes_pago_imputaciones
                .filter((imp: any) => imp.movimiento_cc_id)
                .map((imp: any) => ({
                    id_movimiento_pago: pagoMov.id,
                    id_movimiento_documento: imp.movimiento_cc_id,
                    monto_imputado: imp.monto_imputado,
                    fecha_imputacion: nowArgentina()
                }))

            if (impInserts.length > 0) {
                await supabase.from('imputaciones_proveedores').insert(impInserts)
            }
        }

        // 5. Update vencimientos linked to the paid CC movements
        if (op.ordenes_pago_imputaciones?.length > 0) {
            const ccMovIds = op.ordenes_pago_imputaciones
                .filter((imp: any) => imp.movimiento_cc_id)
                .map((imp: any) => imp.movimiento_cc_id)

            if (ccMovIds.length > 0) {
                // Mark vencimientos that reference these CC movements as paid
                await supabase
                    .from('vencimientos')
                    .update({ estado: 'pagado', orden_pago_id: op.id, updated_at: nowArgentina() })
                    .in('referencia_id', ccMovIds)
                    .eq('referencia_tipo', 'cuenta_corriente')
                    .eq('estado', 'pendiente')
            }
        }

        // 6. Update cheques used (mark as PASADO_PROVEEDOR)
        const chequeItems = op.ordenes_pago_detalle?.filter((d: any) => d.medio === 'cheque' && d.cheque_id) || []
        for (const item of chequeItems) {
            await supabase
                .from('cheques')
                .update({
                    estado: 'PASADO_PROVEEDOR',
                    proveedor_destino_id: op.proveedor_id,
                    orden_pago_id: op.id
                })
                .eq('id', item.cheque_id)
        }

        // 7. Update OP status
        await supabase
            .from('ordenes_pago')
            .update({ estado: 'pagada', updated_at: nowArgentina() })
            .eq('id', opId)

        return NextResponse.json({ success: true, pago_id: pagoMov?.id })

    } catch (error: any) {
        console.error('Error confirming OP:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
