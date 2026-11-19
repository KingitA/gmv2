import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';
import { vistaPreviaLista } from '@/lib/compras/listas-servidor';

/** Renglones por llamada: la pantalla llama de nuevo mientras `quedan` > 0 y muestra el avance. */
const LOTE = 200;

// POST /api/listas-proveedores/[id]/aplicar   { aplicar_hoy?: boolean, primera?: boolean }
// Aplica una lista de precios de proveedor (E-20). Todo lo hace la función SQL
// lista_proveedor_aplicar (migración 20261119a), en una transacción por llamada:
//   · vigencia futura → la lista queda PROGRAMADA y se aplica sola ese día (salvo `aplicar_hoy`);
//   · si no, procesa hasta 200 renglones: lleva el precio a unidad, frena lo que supera el tope de
//     cambio o tiene una lista posterior aplicada, actualiza el costo, deja el historial y marca
//     cada renglón. Devuelve `quedan`: mientras sea mayor a 0, la pantalla vuelve a llamar;
//   · un renglón que falla queda con su motivo y la lista NO pasa a "aplicada".
// No toca precios de venta: en la PRIMERA llamada (`primera: true`) devuelve cuáles quedan desactualizados.
//
// SIN la migración 20261119a esta ruta NO aplica nada (contesta 409 "falta migración"): la forma
// anterior de aplicar ignoraba la vigencia, escondía los errores y escribía el precio por bulto
// como precio por unidad.
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

        // Sin proveedor no se aplica ni se programa (también lo rechaza lista_proveedor_aplicar desde
        // la migración 20261119p; esto cubre la base sin ella)
        const { data: cab } = await supabase.from('listas_proveedores').select('id, proveedor_id, estado').eq('id', lista_id).maybeSingle();
        if (!cab) return NextResponse.json({ error: 'La lista no existe (puede que la hayan eliminado).' }, { status: 404 });
        if (!cab.proveedor_id && cab.estado !== 'aplicada') {
            return NextResponse.json({ error: 'No se aplicó: la lista no tiene proveedor. Elegilo primero (arriba, "Falta el proveedor"); no cambió ningún precio.', codigo: 'sin_proveedor' }, { status: 409 });
        }

        // Antes de aplicar (solo en la primera llamada): qué precios de venta van a quedar
        // desactualizados. Después de aplicar ya no se puede saber.
        let venta: any[] = [];
        if (body?.primera !== false) {
            const antes = await vistaPreviaLista(supabase, lista_id, { todos: true, filtro: 'cambian' });
            if (!antes) return NextResponse.json({ error: 'La lista no existe (puede que la hayan eliminado).' }, { status: 404 });
            venta = antes.items
                .filter((i) => i.articulo && i.venta)
                .map((i) => ({ articulo_id: i.articulo!.id, sku: i.articulo!.sku, descripcion: i.articulo!.descripcion, ...i.venta! }));
        }

        const rpc = await supabase.rpc('lista_proveedor_aplicar', {
            p_lista_id: lista_id, p_usuario_id: auth.user.id, p_forzar_hoy: body?.aplicar_hoy === true, p_limite: LOTE,
        });
        if (rpc.error) {
            if (faltaLaFuncion(rpc.error, 'lista_proveedor_aplicar')) {
                return NextResponse.json({
                    error: 'No se aplicó la lista y no cambió ningún precio: falta aplicar una actualización del sistema (migración 20261119a_listas_proveedores_aplicar.sql). Avisá a sistemas; la lista queda cargada, sin aplicar.',
                    codigo: 'falta_migracion',
                }, { status: 409 });
            }
            if (rpc.error.code === 'P0001' || rpc.error.code === 'P0002') return NextResponse.json({ error: rpc.error.message, codigo: rpc.error.details }, { status: 409 });
            throw rpc.error;
        }
        const r: any = rpc.data || {};
        const programada = r.programada === true;

        return NextResponse.json({
            success: true,
            ...r,
            errores: Array.isArray(r.errores) ? r.errores : [],
            quedan: Number(r.quedan || 0),
            // Solo si de verdad cambió el costo (una lista programada todavía no cambió nada)
            precios_venta: programada ? [] : venta,
        });
    } catch (error: any) {
        console.error('[Aplicar Lista] Error:', error);
        return NextResponse.json({ error: `No se pudo aplicar la lista. Lo ya aplicado en llamadas anteriores queda aplicado; este tramo no cambió ningún precio. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
