import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cargarVerificacionOC } from '@/lib/compras/cargar-verificacion';
import { cant } from '@/lib/deposito/unidades';
import { sincronizarKardexEnCamino } from '@/lib/compras/costo-y-kardex';

// Finalizar (cerrar) una orden de compra. El control se hace ACÁ, en el servidor:
//   · sin una factura validada que cubra lo recibido la orden queda abierta; con solo remitos
//     se controlan cantidades, pero no se cierra (decisión de Juan, 17/11/2026);
//   · si la orden pedía más de lo que llegó (E-92) NO se cierra sola: hay que decir
//     expresamente que se da por cerrada sin el resto (`aceptar_faltantes: true`). Mientras
//     tanto queda "recibida parcial" y el depósito puede recibir lo que falta.
//
//   GET  → { puede, faltas[], falta_factura, sin_validar[], sin_cubrir[], pendientes[] }
//   POST → { aceptar_faltantes?: boolean } · finaliza, o 409 con los mismos datos y `error`.

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const datos = await cargarVerificacionOC(createAdminClient(), id);
        if (!datos) return NextResponse.json({ error: 'La orden de compra no existe.' }, { status: 404 });
        return NextResponse.json(datos.control);
    } catch (error: any) {
        console.error('[OC finalizar] control:', error);
        return NextResponse.json({ error: `No se pudo comprobar si la orden se puede finalizar: ${error.message || error}` }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const supabase = createAdminClient();

        const datos = await cargarVerificacionOC(supabase, id);
        if (!datos) return NextResponse.json({ error: 'La orden de compra no existe.' }, { status: 404 });
        const { orden, control } = datos;
        if (orden.estado === 'finalizada') return NextResponse.json({ success: true, ya_finalizada: true });
        if (orden.estado === 'cancelada') return NextResponse.json({ error: 'La orden está cancelada: no se puede finalizar.', codigo: 'orden_cancelada' }, { status: 409 });

        if (!control.puede) {
            return NextResponse.json({
                error: `La orden ${orden.numero_orden} no se finalizó. ${control.faltas.join(' ')}`,
                codigo: control.falta_factura ? 'falta_factura' : 'no_se_puede_finalizar',
                ...control,
            }, { status: 409 });
        }

        // E-92: mercadería pedida que no llegó. No se cierra sin que alguien lo decida.
        if (control.pendientes.length > 0 && body?.aceptar_faltantes !== true) {
            const lista = control.pendientes.slice(0, 5).map((p) => `${p.sku || 'artículo'} (${cant(p.unidades)} u)`).join(', ');
            return NextResponse.json({
                error: `La orden ${orden.numero_orden} no se finalizó: falta recibir mercadería de ${control.pendientes.length} artículo(s): ${lista}${control.pendientes.length > 5 ? '…' : ''}. Si no va a llegar, hay que cerrarla expresamente sin el resto.`,
                codigo: 'faltan_recibir',
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
        // La orden está cerrada: ya no hay mercadería "en camino" (kardex pendiente de la orden)
        try {
            await sincronizarKardexEnCamino(supabase, id, { cerrada: true });
        } catch (e: any) {
            console.error('[OC finalizar] kardex en camino:', e?.message || e);
        }
        return NextResponse.json({ success: true, cerrada_sin_el_resto: control.pendientes.length > 0 });
    } catch (error: any) {
        console.error('[OC finalizar] Error:', error);
        return NextResponse.json({ error: `No se pudo finalizar la orden: ${error.message || error}` }, { status: 500 });
    }
}
