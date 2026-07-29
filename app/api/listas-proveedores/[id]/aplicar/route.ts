import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';
import { fetchAllRows } from '@/lib/supabase/fetch-all';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: lista_id } = await params;
        const supabase = createAdminClient();

        const { data: lista } = await supabase
            .from('listas_proveedores')
            .select('*')
            .eq('id', lista_id)
            .single();

        if (!lista) return NextResponse.json({ error: 'Lista not found' }, { status: 404 });

        const items = await fetchAllRows(() => supabase
            .from('listas_proveedores_items')
            .select(`*, articulo:articulos(precio_compra)`)
            .eq('lista_id', lista_id)
            .eq('estado_item', 'pendiente'));

        const aplicados = [];
        const errors = [];

        for (const item of items) {
            if (!item.articulo_id) continue;

            const articuloActual = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;
            const precioAnterior = articuloActual?.precio_compra || 0;

            // Save to historial
            try {
                await supabase.from('precios_compra_historial').insert({
                    articulo_id: item.articulo_id,
                    proveedor_id: lista.proveedor_id,
                    precio_anterior: precioAnterior,
                    precio_nuevo: item.precio_compra,
                    descuento1: item.descuento1,
                    descuento2: item.descuento2,
                    descuento3: item.descuento3,
                    descuento4: item.descuento4,
                    lista_proveedores_id: lista_id,
                    fecha_vigencia: lista.fecha_vigencia,
                    aplicado_en: nowArgentina(),
                    aplicado_por: auth.user.id,
                });
            } catch (e: any) { console.warn('[Aplicar Lista] historial insert skipped:', e.message); }

            // Update articulo
            const updateData: any = {};
            if (item.precio_compra) updateData.precio_compra = item.precio_compra;
            if (item.descuento1 !== null) updateData.descuento1 = item.descuento1;
            if (item.descuento2 !== null) updateData.descuento2 = item.descuento2;
            if (item.descuento3 !== null) updateData.descuento3 = item.descuento3;
            if (item.descuento4 !== null) updateData.descuento4 = item.descuento4;

            const { error } = await supabase.from('articulos').update(updateData).eq('id', item.articulo_id);
            if (error) {
                errors.push({ item_id: item.id, error: error.message });
            } else {
                // Mark item as applied
                await supabase.from('listas_proveedores_items').update({ estado_item: 'aplicado' }).eq('id', item.id);
                aplicados.push(item.id);
            }
        }

        // Mark lista as applied
        await supabase.from('listas_proveedores').update({ estado: 'aplicada' }).eq('id', lista_id);

        return NextResponse.json({ success: true, aplicados: aplicados.length, errors });

    } catch (error: any) {
        console.error('[Aplicar Lista] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
