import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { anotarResponsableOP } from '@/lib/ordenes-pago/responsable'
import { bloqueoPorBanco } from '@/lib/bancos/operaciones'

// GET /api/ordenes-pago/[id]
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermiso('ordenes_pago')
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
    const auth = await requirePermiso('ordenes_pago')
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

    // Tanda 2-A: con un pago mandado a Credicoop (esperando la firma, en duda o ya hecho) la orden
    // no se cancela: el banco puede pagar igual. La base lo corta también (guardia de 20261119d).
    try {
        const esperaBanco = await bloqueoPorBanco(supabase, id, 'cancelar')
        if (esperaBanco) return NextResponse.json({ error: esperaBanco, error_code: 'ESPERA_BANCO' }, { status: 409 })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }

    const { error } = await supabase
        .from('ordenes_pago')
        .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
        .eq('id', id)

    if (error) {
        // P0001 = una guardia de la base, con el mensaje ya escrito para la persona
        return NextResponse.json({ error: error.message }, { status: error.code === 'P0001' ? 409 : 500 })
    }

    await anotarResponsableOP(supabase, id, 'anulado', auth.user?.id)
    return NextResponse.json({ success: true })
}
