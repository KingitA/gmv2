import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cargarOrdenCompleta } from '@/lib/compras/orden-completa';

/**
 * GET /api/ordenes-compra/[id] — la orden completa para verla o editarla (E-09: una orden
 * pendiente o enviada tiene acceso a su detalle): cabecera, renglones con su cuenta, totales,
 * condición de pago, vencimientos estimados, envío y qué se puede hacer con ella.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const orden = await cargarOrdenCompleta(createAdminClient(), id);
        if (!orden) return NextResponse.json({ error: 'La orden no existe.' }, { status: 404 });
        return NextResponse.json(orden);
    } catch (error: any) {
        console.error('[OC Detalle] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
