import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

// GET /api/ordenes-pago
export async function GET(request: Request) {
    const auth = await requirePermiso('ordenes_pago')
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

/**
 * POST /api/ordenes-pago — crea la orden de pago (queda PENDIENTE; la plata
 * sale recién al confirmar).
 *
 * Todo pasa en UNA función SQL, op_crear (migración 20261116p_op_crear.sql):
 * cabecera + medios + imputaciones se guardan juntos o no se guarda nada (E-51).
 * La misma función:
 *   · calcula la retención de Ganancias (el valor de la pantalla solo vale
 *     como ajuste manual con motivo),
 *   · resuelve el vencimiento a su comprobante en cuenta corriente (E-52),
 *   · no deja imputar más que el saldo pendiente, contando otras OP pendientes (E-54),
 *   · controla que los medios cubran el neto.
 *
 * REGLA ÚNICA DE LOS TOTALES (E-50) — así los leen la lista, el PDF, Jarvis y op_confirmar:
 *   monto_total       = lo que la OP cancela de la deuda (lo imputado, ya restados
 *                       los créditos; sin imputaciones = medios + retenciones)
 *   total_retenciones = Ganancias + IIBB + IVA + SUSS
 *   neto_a_pagar      = monto_total − total_retenciones = suma de los medios
 *   bruto             = monto_total + total_creditos
 *
 * Body: { proveedor_id, fecha?, observaciones?, clave?,
 *         retencion_ganancias?, ganancias_manual?, ganancias_motivo?,
 *         retencion_iibb?, retencion_iva?, retencion_suss?,
 *         medios_pago: [{ medio, monto, cheque_id?, … }],
 *         imputaciones: [{ movimiento_cc_id?, vencimiento_id?, comprobante_compra_id?, monto_imputado }] }
 */
export async function POST(request: Request) {
    const auth = await requirePermiso('ordenes_pago')
    if (auth.error) return auth.error

    let body: any
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
    }

    if (!body?.proveedor_id) {
        return NextResponse.json({ error: 'Proveedor es obligatorio' }, { status: 400 })
    }
    if (!Array.isArray(body.medios_pago) || body.medios_pago.length === 0) {
        return NextResponse.json({ error: 'Debe agregar al menos un medio de pago' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('op_crear', {
        p_payload: {
            proveedor_id: body.proveedor_id,
            fecha: body.fecha || null,
            observaciones: body.observaciones || null,
            clave: body.clave || null,
            ganancias_manual: Boolean(body.ganancias_manual),
            ganancias_motivo: body.ganancias_motivo || null,
            retencion_ganancias: body.retencion_ganancias ?? 0,
            retencion_iibb: body.retencion_iibb ?? 0,
            retencion_iva: body.retencion_iva ?? 0,
            retencion_suss: body.retencion_suss ?? 0,
            medios_pago: body.medios_pago,
            imputaciones: Array.isArray(body.imputaciones) ? body.imputaciones : [],
        },
        p_usuario: auth.user.email || 'admin',
    })

    if (error) {
        // La función todavía no está en la base: avisar claro, no crear a medias
        if (error.code === 'PGRST202' || error.code === '42883') {
            return NextResponse.json({
                error: 'Falta aplicar en la base la migración 20261116p_op_crear.sql (y 20261116q_op_confirmar_v6.sql). Hasta entonces no se pueden crear órdenes de pago.',
                error_code: 'FALTA_MIGRACION',
            }, { status: 503 })
        }
        // P0001 = validación de negocio (RAISE EXCEPTION con el motivo en criollo)
        const status = error.code === 'P0001' ? 400 : 500
        if (status === 500) console.error('[ordenes-pago] op_crear:', error)
        return NextResponse.json({ error: error.message }, { status })
    }

    return NextResponse.json(data)
}
