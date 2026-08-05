import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { nowArgentina, todayArgentina } from '@/lib/utils'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

// GET /api/ordenes-pago
export async function GET(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get('estado')
    const proveedorId = searchParams.get('proveedor_id')

    const supabase = createAdminClient()

    try {
        const data = await fetchAllRows(() => {
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

            return query
        })

        return NextResponse.json(data)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
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
        ganancias_manual, ganancias_motivo,   // ajuste manual del cálculo automático
        medios_pago, // Array: [{ medio, monto, cheque_id, cheque_banco, ... }]
        imputaciones  // Array: [{ movimiento_cc_id?, vencimiento_id?, comprobante_compra_id?, monto_imputado }]
    } = body

    if (!proveedor_id) {
        return NextResponse.json({ error: 'Proveedor es obligatorio' }, { status: 400 })
    }

    if (!medios_pago || medios_pago.length === 0) {
        return NextResponse.json({ error: 'Debe agregar al menos un medio de pago' }, { status: 400 })
    }

    // ── Retención de Ganancias RG 830: SIEMPRE se calcula server-side ──
    // (el valor del cliente solo se acepta como ajuste manual con motivo)
    const { data: calc, error: calcErr } = await supabase.rpc('op_ganancias_preview', {
        p_proveedor_id: proveedor_id,
        p_imputaciones: imputaciones ?? [],
        p_fecha: fecha ?? null,
    })
    if (calcErr) {
        return NextResponse.json({ error: `Cálculo de retención: ${calcErr.message}` }, { status: 400 })
    }
    const retCalculada = Number(calc?.retencion ?? 0)
    const baseGanancias = Number(calc?.base ?? 0)

    let retGanancias = retCalculada
    if (ganancias_manual) {
        if (!ganancias_motivo || !String(ganancias_motivo).trim()) {
            return NextResponse.json({ error: 'El ajuste manual de la retención requiere un motivo' }, { status: 400 })
        }
        retGanancias = Number(retencion_ganancias || 0)
    }

    const totalMedios = medios_pago.reduce((sum: number, m: any) => sum + Number(m.monto || 0), 0)
    const totalRetenciones = retGanancias + Number(retencion_iibb || 0) +
        Number(retencion_iva || 0) + Number(retencion_suss || 0)
    const totalImputado = (imputaciones ?? []).reduce((s: number, i: any) => s + Number(i.monto_imputado || 0), 0)
    const totalCreditos = (imputaciones ?? []).reduce((s: number, i: any) => s + Math.max(0, -Number(i.monto_imputado || 0)), 0)

    // Cuadre: con imputaciones, los medios deben cubrir el neto (bruto − retenciones)
    if (totalImputado > 0) {
        const netoEsperado = Math.round((totalImputado - totalRetenciones) * 100) / 100
        if (Math.abs(totalMedios - netoEsperado) > 0.01) {
            return NextResponse.json({
                error: `No cuadra: imputado $${totalImputado.toFixed(2)} − retenciones $${totalRetenciones.toFixed(2)} = neto $${netoEsperado.toFixed(2)}, pero los medios suman $${totalMedios.toFixed(2)}`,
            }, { status: 400 })
        }
    }

    const montoTotal = totalImputado > 0 ? totalImputado : totalMedios + totalRetenciones
    const netoAPagar = totalMedios

    // Número de OP atómico (RPC con FOR UPDATE sobre numeracion_comprobantes;
    // formato 0001-XXXXXXXX, compatible con el Nº de comprobante del TXT SICORE)
    const { data: numeroOp, error: numErr } = await supabase.rpc('op_siguiente_numero')
    if (numErr || !numeroOp) {
        return NextResponse.json({ error: `No se pudo numerar la OP: ${numErr?.message ?? 'sin número'}` }, { status: 500 })
    }

    // 1. Crear cabecera
    const { data: op, error: opError } = await supabase
        .from('ordenes_pago')
        .insert({
            numero_op: numeroOp,
            proveedor_id,
            fecha: fecha || todayArgentina(),
            monto_total: montoTotal + totalRetenciones,
            estado: 'pendiente',
            observaciones: observaciones || null,
            retencion_ganancias: retGanancias,
            retencion_iibb: retencion_iibb || 0,
            retencion_iva: retencion_iva || 0,
            retencion_suss: retencion_suss || 0,
            total_retenciones: totalRetenciones,
            neto_a_pagar: netoAPagar,
            base_ganancias: baseGanancias,
            total_creditos: totalCreditos,
            ganancias_ajuste_manual: Boolean(ganancias_manual),
            ganancias_motivo: ganancias_manual ? String(ganancias_motivo).trim() : null,
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
        observaciones: m.observaciones || null,
        cuenta_origen_tipo: m.cuenta_origen_tipo || null,
        cuenta_origen_id: m.cuenta_origen_id || null
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
