import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

// GET /api/vencimientos - Listar vencimientos con filtros
export async function GET(request: Request) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get('estado')
    const proveedorId = searchParams.get('proveedor_id')
    const tipo = searchParams.get('tipo')
    const desde = searchParams.get('desde')
    const hasta = searchParams.get('hasta')
    const proximosNDias = searchParams.get('proximos_dias')

    const supabase = createAdminClient()

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
    if (desde) {
        query = query.gte('fecha_vencimiento', desde)
    }
    if (hasta) {
        query = query.lte('fecha_vencimiento', hasta)
    }
    if (proximosNDias) {
        const hoy = new Date()
        const limite = new Date(hoy)
        limite.setDate(limite.getDate() + parseInt(proximosNDias))
        query = query
            .gte('fecha_vencimiento', hoy.toISOString().split('T')[0])
            .lte('fecha_vencimiento', limite.toISOString().split('T')[0])
            .in('estado', ['pendiente', 'vencido'])
    }

    const { data, error } = await query

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
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
        referencia_id, referencia_tipo, observaciones, dias_alerta
    } = body

    if (!concepto || !fecha_vencimiento) {
        return NextResponse.json(
            { error: 'Concepto y fecha de vencimiento son obligatorios' },
            { status: 400 }
        )
    }

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

    updateData.updated_at = new Date().toISOString()

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

    const { error } = await supabase
        .from('vencimientos')
        .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
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
            estado: 'pendiente'
        })
    }

    if (inserts.length > 0) {
        await supabase.from('vencimientos').insert(inserts)
    }
}
