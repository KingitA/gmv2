import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { controlFinalizarOC } from '@/lib/compras/finalizar-oc';

// Finalizar (cerrar) una orden de compra. El control se hace ACÁ, en el servidor
// (lib/compras/finalizar-oc.ts): sin una factura validada que cubra lo recibido la orden
// queda abierta. Con solo remitos se controlan cantidades, pero no se cierra
// (decisión de Juan, 17/11/2026).
//
//   GET  → { puede, faltas[], falta_factura, sin_validar[], sin_cubrir[] }  (para avisar en pantalla)
//   POST → finaliza, o 409 con los mismos datos y `error` = qué falta.

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        return NextResponse.json(await controlFinalizarOC(createAdminClient(), id));
    } catch (error: any) {
        console.error('[OC finalizar] control:', error);
        return NextResponse.json({ error: `No se pudo comprobar si la orden se puede finalizar: ${error.message || error}` }, { status: 500 });
    }
}

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const supabase = createAdminClient();

        const { data: orden, error: ordenErr } = await supabase
            .from('ordenes_compra')
            .select('id, estado, numero_orden')
            .eq('id', id)
            .maybeSingle();
        if (ordenErr) throw ordenErr;
        if (!orden) return NextResponse.json({ error: 'La orden de compra no existe.' }, { status: 404 });
        if (orden.estado === 'finalizada') return NextResponse.json({ success: true, ya_finalizada: true });
        if (orden.estado === 'cancelada') return NextResponse.json({ error: 'La orden está cancelada: no se puede finalizar.', codigo: 'orden_cancelada' }, { status: 409 });

        const control = await controlFinalizarOC(supabase, id);
        if (!control.puede) {
            return NextResponse.json({
                error: `La orden ${orden.numero_orden} no se finalizó. ${control.faltas.join(' ')}`,
                codigo: control.falta_factura ? 'falta_factura' : 'no_se_puede_finalizar',
                ...control,
            }, { status: 409 });
        }

        // Solo si sigue en el estado que se leyó (dos personas finalizando a la vez: una sola escribe)
        const { data: cambiada, error: updErr } = await supabase
            .from('ordenes_compra')
            .update({ estado: 'finalizada' })
            .eq('id', id)
            .eq('estado', orden.estado)
            .select('id');
        if (updErr) {
            return NextResponse.json({ error: `La orden NO pasó a "finalizada": ${updErr.message}`, codigo: 'error_estado' }, { status: 500 });
        }
        if (!cambiada || cambiada.length === 0) {
            return NextResponse.json({ error: 'La orden cambió mientras se finalizaba. Actualizá la pantalla y volvé a intentar.', codigo: 'orden_cambio' }, { status: 409 });
        }
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[OC finalizar] Error:', error);
        return NextResponse.json({ error: `No se pudo finalizar la orden: ${error.message || error}` }, { status: 500 });
    }
}
