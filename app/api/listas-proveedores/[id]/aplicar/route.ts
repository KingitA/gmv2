import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';
import { vistaPreviaLista } from '@/lib/compras/listas-servidor';

// POST /api/listas-proveedores/[id]/aplicar   { aplicar_hoy?: boolean }
// Aplica una lista de precios de proveedor (E-20). Todo lo hace la función SQL
// lista_proveedor_aplicar (migración 20261119a), en una transacción:
//   · vigencia futura → la lista queda PROGRAMADA y se aplica sola ese día (salvo `aplicar_hoy`);
//   · si no, actualiza el costo de cada artículo, deja el historial y marca cada renglón;
//   · un renglón que falla queda con su motivo y la lista NO pasa a "aplicada".
// No toca precios de venta: se avisa cuáles quedan desactualizados.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: lista_id } = await params;
        const body = await request.json().catch(() => ({}));
        const supabase = createAdminClient();

        // Antes de aplicar: qué precios de venta van a quedar desactualizados (después ya no se puede saber)
        const antes = await vistaPreviaLista(supabase, lista_id);
        if (!antes) return NextResponse.json({ error: 'La lista no existe (puede que la hayan eliminado).' }, { status: 404 });
        const venta = antes.items
            .filter((i) => i.estado_item === 'pendiente' && i.articulo && i.venta && Object.keys(i.cambio?.cambios || {}).length > 0)
            .map((i) => ({ articulo_id: i.articulo!.id, sku: i.articulo!.sku, descripcion: i.articulo!.descripcion, ...i.venta! }));

        const rpc = await supabase.rpc('lista_proveedor_aplicar', {
            p_lista_id: lista_id, p_usuario_id: auth.user.id, p_forzar_hoy: body?.aplicar_hoy === true,
        });
        if (rpc.error) {
            if (faltaLaFuncion(rpc.error, 'lista_proveedor_aplicar')) {
                return NextResponse.json({ error: 'Todavía no se pueden aplicar listas: falta aplicar una actualización del sistema (migración 20261119a). No se cambió ningún precio.', codigo: 'falta_migracion' }, { status: 409 });
            }
            if (rpc.error.code === 'P0001' || rpc.error.code === 'P0002') return NextResponse.json({ error: rpc.error.message, codigo: rpc.error.details }, { status: 409 });
            throw rpc.error;
        }
        const r: any = rpc.data || {};
        const errores: any[] = Array.isArray(r.errores) ? r.errores : [];
        const programada = r.programada === true;

        return NextResponse.json({
            success: true,
            ...r,
            errores,
            // Solo si de verdad cambió el costo (una lista programada todavía no cambió nada)
            precios_venta: programada ? [] : venta,
            precios_venta_desactualizados: programada ? 0 : venta.filter((v) => v.tipo === 'desactualizado').length,
        });
    } catch (error: any) {
        console.error('[Aplicar Lista] Error:', error);
        return NextResponse.json({ error: `No se pudo aplicar la lista y no se cambió ningún precio. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
