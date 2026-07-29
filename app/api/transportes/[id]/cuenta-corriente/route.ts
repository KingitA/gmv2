import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';
import { fetchAllRows } from '@/lib/supabase/fetch-all';

// GET /api/transportes/[id]/cuenta-corriente
// Returns CC movements + balance for a transporte
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { id: transporteId } = await params;
    const { searchParams } = new URL(request.url);
    const desde = searchParams.get('desde');
    const hasta = searchParams.get('hasta');

    const supabase = createAdminClient();

    const { data: transporte } = await supabase
        .from('transportes')
        .select('id, nombre, cuit, email, telefono')
        .eq('id', transporteId)
        .single();

    if (!transporte) return NextResponse.json({ error: 'Transporte no encontrado' }, { status: 404 });

    let movimientos: any[];
    try {
        movimientos = await fetchAllRows(() => {
            let query = supabase
                .from('cuenta_corriente_transportes')
                .select('*')
                .eq('transporte_id', transporteId)
                .order('fecha', { ascending: false });

            if (desde) query = query.gte('fecha', desde);
            if (hasta) query = query.lte('fecha', hasta + 'T23:59:59');
            return query;
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const saldo = (movimientos || []).reduce((acc: number, m: any) => {
        // faltante_mercaderia y ajuste (+) = deuda del transporte hacia nosotros
        // pago (-) = el transporte nos paga
        return acc + Number(m.monto);
    }, 0);

    return NextResponse.json({
        transporte,
        movimientos: movimientos || [],
        saldo,
    });
}

// POST /api/transportes/[id]/cuenta-corriente
// Create a new CC movement (pago, ajuste manual)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { id: transporteId } = await params;
    const body = await request.json();
    const { tipo_movimiento, monto, descripcion, numero_comprobante } = body;

    if (!tipo_movimiento || monto === undefined) {
        return NextResponse.json({ error: 'tipo_movimiento y monto son requeridos' }, { status: 400 });
    }

    const TIPOS_VALIDOS = ['faltante_mercaderia', 'pago', 'ajuste'];
    if (!TIPOS_VALIDOS.includes(tipo_movimiento)) {
        return NextResponse.json({ error: `tipo_movimiento inválido. Valores: ${TIPOS_VALIDOS.join(', ')}` }, { status: 400 });
    }

    // Pagos se guardan como monto negativo (reducen deuda)
    const montoFinal = tipo_movimiento === 'pago' ? -Math.abs(Number(monto)) : Math.abs(Number(monto));

    const supabase = createAdminClient();

    const { data, error } = await supabase
        .from('cuenta_corriente_transportes')
        .insert({
            transporte_id: transporteId,
            tipo_movimiento,
            monto: montoFinal,
            descripcion,
            numero_comprobante,
            referencia_tipo: tipo_movimiento === 'pago' ? 'pago' : 'ajuste',
            creado_por: auth.user.id,
            fecha: nowArgentina(),
        })
        .select()
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, movimiento: data });
}
