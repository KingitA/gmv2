import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

// GET /api/ordenes-pago/[id]
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
        .from('ordenes_pago')
        .select(`
            *,
            proveedores(id, nombre, sigla, cuit),
            ordenes_pago_detalle(*),
            ordenes_pago_imputaciones(
                *,
                comprobantes_compra(id, tipo_comprobante, numero_comprobante, total_factura_declarado),
                vencimientos(id, concepto, monto, fecha_vencimiento)
            )
        `)
        .eq('id', id)
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

// DELETE /api/ordenes-pago/[id] - Cancelar OP (solo si está en borrador/pendiente)
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id } = await params
    const supabase = createAdminClient()

    const { data: op } = await supabase
        .from('ordenes_pago')
        .select('estado')
        .eq('id', id)
        .single()

    if (op?.estado === 'pagada') {
        return NextResponse.json(
            { error: 'No se puede cancelar una orden ya pagada' },
            { status: 400 }
        )
    }

    const { error } = await supabase
        .from('ordenes_pago')
        .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
        .eq('id', id)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
