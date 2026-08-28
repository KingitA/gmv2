import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth, getUserRoles } from '@/lib/auth'
import { nowArgentina, todayArgentina } from '@/lib/utils'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { esAdmin, esTipoReservado, TIPOS_SOLO_ADMIN } from '@/lib/finanzas/tipos-reservados'

// Sueldos y Socios: SOLO admin los ve / carga / edita. Para el resto no existen.
const soloAdmin = () => NextResponse.json(
    { error: 'Solo un administrador puede ver o modificar vencimientos de sueldos o socios.' },
    { status: 403 }
)
const filtroNoAdmin = `(${TIPOS_SOLO_ADMIN.join(',')})`

// GET /api/vencimientos - Listar vencimientos con filtros
export async function GET(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const admin = esAdmin(await getUserRoles(auth.user.id))

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get('estado')
    const proveedorId = searchParams.get('proveedor_id')
    const tipo = searchParams.get('tipo')
    const desde = searchParams.get('desde')
    const hasta = searchParams.get('hasta')
    const proximosNDias = searchParams.get('proximos_dias')

    // Un no-admin pidiendo explícitamente sueldos/socios: no hay nada para él
    if (!admin && esTipoReservado(tipo)) return NextResponse.json([])

    const supabase = createAdminClient()

    // Mantenimiento rolling de series recurrentes + renovaciones de ciclo
    // (idempotente y barato; el panel de finanzas lo pide con ?mantener=1)
    if (searchParams.get('mantener')) {
        const { error: mantErr } = await supabase.rpc('vencimientos_mantener', { p_horizonte_meses: 6 })
        if (mantErr) console.error('[vencimientos] mantener:', mantErr.message)
    }

    try {
        const data = await fetchAllRows(() => {
            let query = supabase
                .from('vencimientos')
                .select('*, proveedores(id, nombre, sigla, cuit)')
                .order('fecha_vencimiento', { ascending: true })

            if (estado && estado !== 'todos') {
                query = query.eq('estado', estado)
            }
            if (proveedorId) {
                query = query.eq('proveedor_id', proveedorId)
            }
            if (tipo && tipo !== 'todos') {
                query = query.eq('tipo', tipo)
            }
            // No-admin: sueldos y socios quedan afuera (calendario, lista, panel, totales)
            if (!admin) {
                query = query.not('tipo', 'in', filtroNoAdmin)
            }
            if (desde) {
                query = query.gte('fecha_vencimiento', desde)
            }
            if (hasta) {
                query = query.lte('fecha_vencimiento', hasta)
            }
            if (proximosNDias) {
                const hoy = todayArgentina()
                const limite = new Date(hoy)
                limite.setDate(limite.getDate() + parseInt(proximosNDias))
                query = query
                    .gte('fecha_vencimiento', hoy)
                    .lte('fecha_vencimiento', limite.toISOString().split('T')[0])
                    .in('estado', ['pendiente', 'vencido'])
            }

            return query
        })

        return NextResponse.json(data)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// POST /api/vencimientos - Crear vencimiento
export async function POST(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const body = await request.json()
    const supabase = createAdminClient()

    const {
        proveedor_id, tipo, concepto, monto, moneda,
        fecha_vencimiento, recurrencia, recurrencia_hasta,
        referencia_id, referencia_tipo, observaciones, dias_alerta,
        forma_pago, fecha_validez, modalidad, descuentos_aplicados,
        es_estimado
    } = body

    if (!concepto || !fecha_vencimiento) {
        return NextResponse.json(
            { error: 'Concepto y fecha de vencimiento son obligatorios' },
            { status: 400 }
        )
    }
    if (esTipoReservado(tipo) && !esAdmin(await getUserRoles(auth.user.id))) return soloAdmin()

    const { data, error } = await supabase
        .from('vencimientos')
        .insert({
            proveedor_id: proveedor_id || null,
            tipo: tipo || 'factura',
            concepto,
            monto: monto || 0,
            moneda: moneda || 'ARS',
            fecha_vencimiento,
            recurrencia: recurrencia || null,
            recurrencia_hasta: recurrencia_hasta || null,
            referencia_id: referencia_id || null,
            referencia_tipo: referencia_tipo || null,
            observaciones: observaciones || null,
            dias_alerta: dias_alerta ?? 3,
            forma_pago: forma_pago || null,
            fecha_validez: fecha_validez || null,
            modalidad: modalidad || null,
            descuentos_aplicados: descuentos_aplicados ?? false,
            es_estimado: es_estimado ?? false,
            estado: 'pendiente'
        })
        .select('*, proveedores(id, nombre, sigla)')
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Si es recurrente, generar los próximos vencimientos (hasta 12 ocurrencias)
    if (recurrencia && data) {
        await generarRecurrencias(supabase, data, recurrencia, recurrencia_hasta)
    }

    return NextResponse.json(data)
}

// PUT /api/vencimientos - Actualizar vencimiento
export async function PUT(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const body = await request.json()
    const { id, ...updateData } = body
    const supabase = createAdminClient()

    if (!id) {
        return NextResponse.json({ error: 'ID es obligatorio' }, { status: 400 })
    }

    // Traba por rol: ni convertir a sueldos/socios ni tocar uno existente sin ser admin
    const { data: actual } = await supabase.from('vencimientos').select('tipo').eq('id', id).maybeSingle()
    if ((esTipoReservado(updateData.tipo) || esTipoReservado(actual?.tipo)) && !esAdmin(await getUserRoles(auth.user.id))) {
        return soloAdmin()
    }

    updateData.updated_at = nowArgentina()

    const { data, error } = await supabase
        .from('vencimientos')
        .update(updateData)
        .eq('id', id)
        .select('*, proveedores(id, nombre, sigla)')
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

// DELETE /api/vencimientos - Cancelar vencimiento
export async function DELETE(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const supabase = createAdminClient()

    if (!id) {
        return NextResponse.json({ error: 'ID es obligatorio' }, { status: 400 })
    }

    const { data: actual } = await supabase.from('vencimientos').select('tipo').eq('id', id).maybeSingle()
    if (esTipoReservado(actual?.tipo) && !esAdmin(await getUserRoles(auth.user.id))) return soloAdmin()

    const { error } = await supabase
        .from('vencimientos')
        .update({ estado: 'cancelado', updated_at: nowArgentina() })
        .eq('id', id)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}

// Helper: generar vencimientos recurrentes
async function generarRecurrencias(
    supabase: any,
    base: any,
    recurrencia: string,
    hasta: string | null
) {
    const meses: Record<string, number> = {
        mensual: 1, bimestral: 2, trimestral: 3,
        semestral: 6, anual: 12
    }

    const incremento = meses[recurrencia]
    if (!incremento) return

    const maxOcurrencias = 12
    const limiteDate = hasta ? new Date(hasta) : null
    const inserts = []

    for (let i = 1; i <= maxOcurrencias; i++) {
        const fecha = new Date(base.fecha_vencimiento)
        fecha.setMonth(fecha.getMonth() + (incremento * i))

        if (limiteDate && fecha > limiteDate) break

        // No generar más allá de 2 años
        const dosAnios = new Date()
        dosAnios.setFullYear(dosAnios.getFullYear() + 2)
        if (fecha > dosAnios) break

        inserts.push({
            proveedor_id: base.proveedor_id,
            tipo: base.tipo,
            concepto: base.concepto,
            monto: base.monto,
            moneda: base.moneda,
            fecha_vencimiento: fecha.toISOString().split('T')[0],
            recurrencia: base.recurrencia,
            recurrencia_hasta: base.recurrencia_hasta,
            observaciones: base.observaciones,
            dias_alerta: base.dias_alerta,
            forma_pago: base.forma_pago ?? null,
            modalidad: base.modalidad ?? null,
            descuentos_aplicados: base.descuentos_aplicados ?? false,
            es_estimado: base.es_estimado ?? false,
            estado: 'pendiente'
        })
    }

    if (inserts.length > 0) {
        await supabase.from('vencimientos').insert(inserts)
    }
}
