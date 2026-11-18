import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { vistaPreviaLista } from '@/lib/compras/listas-servidor';

// GET /api/listas-proveedores/[id]?umbral=15
// La lista con su VISTA PREVIA armada en el servidor (lib/compras/listas-servidor.ts): por artículo,
// costo actual → nuevo, % de cambio, alertas de subas o bajas grandes, qué precios de venta quedan
// desactualizados y el enlace firmado al archivo.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const umbral = Number(new URL(request.url).searchParams.get('umbral'));
        const vista = await vistaPreviaLista(createAdminClient(), id, Number.isFinite(umbral) && umbral > 0 ? umbral : null);
        if (!vista) return NextResponse.json({ error: 'La lista no existe (puede que la hayan eliminado).' }, { status: 404 });
        return NextResponse.json(vista);
    } catch (error: any) {
        console.error('[Lista] Error:', error);
        return NextResponse.json({ error: `No se pudo cargar la lista. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}

// PATCH /api/listas-proveedores/[id]
//   { item_id, accion: 'confirmar', articulo_id? }  el renglón "por revisar" queda vinculado (al sugerido o al que se mande) y se aplica
//   { item_id, accion: 'ignorar' }                  el renglón no se aplica
//   { item_id, accion: 'incluir' }                  un renglón ignorado que tiene artículo vuelve a aplicarse
//   { accion: 'desprogramar' }                      una lista programada vuelve a pendiente
// Nada de esto cambia precios: solo prepara la lista. Una lista aplicada no se toca.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const supabase = createAdminClient();
        const { data: lista } = await supabase.from('listas_proveedores').select('id, estado').eq('id', id).maybeSingle();
        if (!lista) return NextResponse.json({ error: 'La lista no existe.' }, { status: 404 });
        if (lista.estado === 'aplicada') return NextResponse.json({ error: 'La lista ya está aplicada: no se puede cambiar.' }, { status: 409 });

        if (body.accion === 'desprogramar') {
            const { data, error } = await supabase.from('listas_proveedores').update({ estado: 'pendiente' }).eq('id', id).eq('estado', 'programada').select('id');
            if (error) throw error;
            if (!data?.length) return NextResponse.json({ error: 'La lista ya no está programada.' }, { status: 409 });
            return NextResponse.json({ success: true });
        }

        if (!body.item_id) return NextResponse.json({ error: 'Falta el renglón.' }, { status: 400 });
        const { data: item } = await supabase.from('listas_proveedores_items').select('*').eq('id', body.item_id).eq('lista_id', id).maybeSingle();
        if (!item) return NextResponse.json({ error: 'Ese renglón ya no existe.' }, { status: 404 });
        if (item.estado_item === 'aplicado') return NextResponse.json({ error: 'Ese renglón ya se aplicó.' }, { status: 409 });

        let cambios: Record<string, unknown> | null = null;
        if (body.accion === 'confirmar') {
            const articuloId = body.articulo_id || item.articulo_sugerido_id || item.articulo_id;
            if (!articuloId) return NextResponse.json({ error: 'Elegí el artículo al que corresponde el renglón.' }, { status: 400 });
            cambios = { articulo_id: articuloId, articulo_sugerido_id: null, estado_item: 'pendiente', error: null };
        } else if (body.accion === 'ignorar') {
            cambios = { estado_item: 'ignorado' };
        } else if (body.accion === 'incluir') {
            if (!item.articulo_id) return NextResponse.json({ error: 'El renglón no tiene artículo: primero hay que vincularlo.' }, { status: 400 });
            cambios = { estado_item: 'pendiente', error: null };
        } else {
            return NextResponse.json({ error: 'Acción no reconocida.' }, { status: 400 });
        }
        let upd = await supabase.from('listas_proveedores_items').update(cambios).eq('id', item.id);
        if (upd.error && (upd.error.code === 'PGRST204' || upd.error.code === '42703')) {
            // sin la migración 20261119a no existen error / articulo_sugerido_id
            const { error: _e, articulo_sugerido_id: _s, ...basico } = cambios as any;
            upd = await supabase.from('listas_proveedores_items').update(basico).eq('id', item.id);
        }
        if (upd.error) throw upd.error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Lista PATCH] Error:', error);
        return NextResponse.json({ error: `No se pudo guardar el cambio. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
