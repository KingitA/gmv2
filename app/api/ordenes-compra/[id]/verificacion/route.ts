import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cargarVerificacionOC } from '@/lib/compras/cargar-verificacion';

export const dynamic = 'force-dynamic';

// GET /api/ordenes-compra/[id]/verificacion
// Todo lo que muestra la pantalla de verificación, armado en el servidor en una sola llamada
// (lib/compras/cargar-verificacion.ts): filas pedido / recibido / facturado con sus diferencias,
// comprobantes, documentos (con enlace a la foto), qué falta para finalizar y los transportes.
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const supabase = createAdminClient();
        const [datos, transportes] = await Promise.all([
            cargarVerificacionOC(supabase, id),
            supabase.from('transportes').select('id, nombre').eq('activo', true).order('nombre'),
        ]);
        if (!datos) return NextResponse.json({ error: 'La orden de compra no existe.' }, { status: 404 });
        return NextResponse.json({ ...datos, transportes: transportes.data || [] });
    } catch (error: any) {
        console.error('[OC verificación] Error:', error);
        return NextResponse.json({ error: `No se pudo cargar la verificación. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
