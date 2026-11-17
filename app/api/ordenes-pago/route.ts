import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso, tienePermiso } from '@/lib/auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { anotarResponsableOP } from '@/lib/ordenes-pago/responsable'

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
 * Body: { confirmar?: true  ← E-67: además de crearla, la confirma (sale la plata),
 *         proveedor_id, fecha?, observaciones?, clave?,
 *         retencion_ganancias?, ganancias_manual?, ganancias_motivo?,
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
    // Pagar ahora = confirmar: mueve plata, mismo permiso que el botón Confirmar
    if (body.confirmar === true && !tienePermiso(auth.roles, 'ordenes_pago_confirmar')) {
        return NextResponse.json({ error: 'No tenés permiso para confirmar pagos. Podés dejar la orden pendiente.', error_code: 'SIN_PERMISO' }, { status: 403 })
    }
    if (!Array.isArray(body.medios_pago) || body.medios_pago.length === 0) {
        return NextResponse.json({ error: 'Debe agregar al menos un medio de pago' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const payload = {
        proveedor_id: body.proveedor_id,
        fecha: body.fecha || null,
        observaciones: body.observaciones || null,
        clave: body.clave || null,
        ganancias_manual: Boolean(body.ganancias_manual),
        ganancias_motivo: body.ganancias_motivo || null,
        retencion_ganancias: body.retencion_ganancias ?? 0,
        // E-60 (Juan, 16/11): solo se retiene Ganancias. IIBB / IVA / SUSS no existen:
        // no se aceptan del pedido, van siempre en 0.
        retencion_iibb: 0,
        retencion_iva: 0,
        retencion_suss: 0,
        medios_pago: body.medios_pago,
        imputaciones: Array.isArray(body.imputaciones) ? body.imputaciones : [],
    }
    const usuario = auth.user.email || 'admin'
    const responder = (error: any, que: string) => {
        // P0001 = validación de negocio (RAISE EXCEPTION con el motivo en criollo)
        const status = error.code === 'P0001' ? 400 : 500
        if (status === 500) console.error(`[ordenes-pago] ${que}:`, error)
        return NextResponse.json({ error: error.message }, { status })
    }
    const faltaFuncion = (error: any, nombre: string) =>
        (error?.code === 'PGRST202' || error?.code === '42883') && new RegExp(`\\b${nombre}\\(`).test(error.message || '')

    // ── E-67: crear y confirmar en un paso (body.confirmar = true) ──
    // Con la migración 20261117p_ordenes_pago_t1d.sql las dos cosas pasan en UNA transacción
    // (op_crear_y_confirmar): si la confirmación falla no queda ni la orden.
    if (body.confirmar === true) {
        const junto = await supabase.rpc('op_crear_y_confirmar', {
            p_payload: payload, p_usuario: usuario, p_usuario_id: auth.user.id,
        })
        if (!junto.error) {
            await anotarResponsableOP(supabase, (junto.data as any).id, 'confirmado', auth.user.id)
            return NextResponse.json({ ...(junto.data as any), confirmada: true })
        }
        if (!faltaFuncion(junto.error, 'op_crear_y_confirmar')) return responder(junto.error, 'op_crear_y_confirmar')
        // La función todavía no está en la base: mismas dos operaciones, de a una (abajo)
    }

    const { data, error } = await supabase.rpc('op_crear', { p_payload: payload, p_usuario: usuario })

    if (error) {
        // op_crear todavía no está en la base: avisar claro, no crear a medias.
        // Solo cuando la que falta es op_crear; cualquier otra función inexistente
        // (42883 desde adentro de op_crear) es un error real y se informa tal cual.
        if (faltaFuncion(error, 'op_crear')) {
            return NextResponse.json({
                error: 'Falta aplicar en la base la migración 20261116p_op_crear.sql (y 20261116q_op_confirmar_v6.sql). Hasta entonces no se pueden crear órdenes de pago.',
                error_code: 'FALTA_MIGRACION',
            }, { status: 503 })
        }
        return responder(error, 'op_crear')
    }

    if (body.confirmar !== true) return NextResponse.json(data)

    // Respaldo sin la migración 20261117p_ordenes_pago_t1d.sql: la orden ya quedó creada (pendiente) y se confirma
    // aparte. Si la confirmación falla, la orden queda pendiente y se avisa con el motivo.
    const op = data as any
    const { data: det } = await supabase.from('ordenes_pago_detalle')
        .select('cuenta_origen_tipo, cuenta_origen_id').eq('orden_pago_id', op.id)
    const conf = await supabase.rpc('op_confirmar', {
        p_op_id: op.id,
        p_usuario_id: auth.user.id,
        p_caja_id: det?.find(d => d.cuenta_origen_tipo === 'CAJA' && d.cuenta_origen_id)?.cuenta_origen_id ?? null,
        p_cuenta_banco_id: det?.find(d => d.cuenta_origen_tipo === 'BANCO' && d.cuenta_origen_id)?.cuenta_origen_id ?? null,
    })
    if (conf.error) {
        return NextResponse.json({
            ...op, confirmada: false,
            aviso: `La orden ${op.numero_op} quedó PENDIENTE: no se pudo confirmar el pago. ${conf.error.message}`,
        })
    }
    await anotarResponsableOP(supabase, op.id, 'confirmado', auth.user.id)
    return NextResponse.json({ ...op, estado: 'pagada', confirmada: true, confirmacion: conf.data })
}
