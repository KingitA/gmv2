import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { nowArgentina } from '@/lib/utils'

// GET /api/ordenes-pago
export async function GET(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get('estado')
    const proveedorId = searchParams.get('proveedor_id')

    const supabase = createAdminClient()

    let query = supabase
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
        .order('created_at', { ascending: false })

    if (estado && estado !== 'todos') {
        query = query.eq('estado', estado)
    }
    if (proveedorId) {
        query = query.eq('proveedor_id', proveedorId)
    }

    const { data, error } = await query

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
}

// POST /api/ordenes-pago - Crear orden de pago
export async function POST(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const body = await request.json()
    const supabase = createAdminClient()

    const {
        proveedor_id, fecha, observaciones,
        retencion_ganancias, retencion_iibb, retencion_iva, retencion_suss,
        medios_pago, // Array: [{ medio, monto, cheque_id, cheque_banco, ... }]
        imputaciones  // Array: [{ movimiento_cc_id?, vencimiento_id?, comprobante_compra_id?, monto_imputado }]
    } = body

    if (!proveedor_id) {
        return NextResponse.json({ error: 'Proveedor es obligatorio' }, { status: 400 })
    }

    if (!medios_pago || medios_pago.length === 0) {
        return NextResponse.json({ error: 'Debe agregar al menos un medio de pago' }, { status: 400 })
    }

    // Calcular totales
    const montoTotal = medios_pago.reduce((sum: number, m: any) => sum + Number(m.monto || 0), 0)
    const totalRetenciones = Number(retencion_ganancias || 0) + Number(retencion_iibb || 0) +
        Number(retencion_iva || 0) + Number(retencion_suss || 0)
    const netoAPagar = montoTotal

    // Generar número de OP
    const { data: ultimaOp } = await supabase
        .from('ordenes_pago')
        .select('numero_op')
        .order('created_at', { ascending: false })
        .limit(1)

    let numeroOp = 'OP-000001'
    if (ultimaOp && ultimaOp.length > 0 && ultimaOp[0].numero_op) {
        const parts = ultimaOp[0].numero_op.split('-')
        if (parts.length === 2) {
            const next = parseInt(parts[1]) + 1
            numeroOp = `OP-${String(next).padStart(6, '0')}`
        }
    }

    // 1. Crear cabecera
    const { data: op, error: opError } = await supabase
        .from('ordenes_pago')
        .insert({
            numero_op: numeroOp,
            proveedor_id,
            fecha: fecha || new Date().toISOString().split('T')[0],
            monto_total: montoTotal + totalRetenciones,
            estado: 'pendiente',
            observaciones: observaciones || null,
            retencion_ganancias: retencion_ganancias || 0,
            retencion_iibb: retencion_iibb || 0,
            retencion_iva: retencion_iva || 0,
            retencion_suss: retencion_suss || 0,
            total_retenciones: totalRetenciones,
            neto_a_pagar: netoAPagar,
            usuario_creador: auth.user.email || 'admin'
        })
        .select()
        .single()

    if (opError) {
        return NextResponse.json({ error: opError.message }, { status: 500 })
    }

    // 2. Crear detalle de medios de pago
    const detalleInserts = medios_pago.map((m: any) => ({
        orden_pago_id: op.id,
        medio: m.medio,
        monto: m.monto,
        cheque_id: m.cheque_id || null,
        cheque_banco: m.cheque_banco || null,
        cheque_numero: m.cheque_numero || null,
        cheque_fecha_vencimiento: m.cheque_fecha_vencimiento || null,
        banco_destino: m.banco_destino || null,
        numero_cuenta: m.numero_cuenta || null,
        cbu: m.cbu || null,
        numero_transferencia: m.numero_transferencia || null,
        fecha_transferencia: m.fecha_transferencia || null,
        observaciones: m.observaciones || null
    }))

    const { error: detError } = await supabase
        .from('ordenes_pago_detalle')
        .insert(detalleInserts)

    if (detError) {
        console.error('Error inserting OP detalle:', detError)
    }

    // 3. Crear imputaciones si hay
    if (imputaciones && imputaciones.length > 0) {
        const impInserts = imputaciones.map((imp: any) => ({
            orden_pago_id: op.id,
            movimiento_cc_id: imp.movimiento_cc_id || null,
            vencimiento_id: imp.vencimiento_id || null,
            comprobante_compra_id: imp.comprobante_compra_id || null,
            monto_imputado: imp.monto_imputado
        }))

        const { error: impError } = await supabase
            .from('ordenes_pago_imputaciones')
            .insert(impInserts)

        if (impError) {
            console.error('Error inserting OP imputaciones:', impError)
        }
    }

    return NextResponse.json(op)
}
