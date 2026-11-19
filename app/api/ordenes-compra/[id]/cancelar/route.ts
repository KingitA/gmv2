import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermiso } from '@/lib/auth';
import { errorDeFuncion, mensajeMigracionOC } from '@/lib/compras/orden-compra';

/**
 * POST /api/ordenes-compra/[id]/cancelar  { motivo? }
 *
 * Cancela la orden (E-09): NO la borra. La función SQL `oc_cancelar` revierte en una sola
 * transacción la provisión de la cuenta corriente, el stock en camino y los vencimientos
 * estimados, y deja la orden en `cancelada` con quién, cuándo y por qué. Solo se puede si
 * la orden no tiene recepción en depósito ni comprobantes cargados.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requirePermiso('compras');
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const supabase = createAdminClient();

        const { data, error } = await supabase.rpc('oc_cancelar', {
            p_orden_id: id,
            p_usuario_id: auth.user.id,
            p_motivo: typeof body?.motivo === 'string' ? body.motivo.slice(0, 500) : null,
        });
        if (error) {
            const migracion = mensajeMigracionOC(error);
            if (migracion) return NextResponse.json({ error: migracion, codigo: 'migracion_pendiente' }, { status: 503 });
            const e = errorDeFuncion(error);
            if (e.status === 500) console.error('[OC Cancelar] Error:', error);
            return NextResponse.json({ error: e.mensaje, codigo: e.codigo }, { status: e.status });
        }
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[OC Cancelar] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
