import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; itemId: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: recepcion_id, itemId: item_id } = await params;
        const body = await request.json();
        const { ean13, unidades_por_bulto, descripcion, tipo_fraccion, cantidad_fraccion } = body;

        const supabase = createAdminClient();

        // Get articulo_id from the reception item
        const { data: item, error: itemError } = await supabase
            .from('recepciones_items')
            .select('articulo_id')
            .eq('id', item_id)
            .eq('recepcion_id', recepcion_id)
            .single();

        if (itemError || !item) {
            return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        }

        const articulo_id = item.articulo_id;
        const updates: any = {};

        if (descripcion !== undefined) updates.descripcion = descripcion;
        if (unidades_por_bulto !== undefined) updates.unidades_por_bulto = unidades_por_bulto;
        if (tipo_fraccion !== undefined) updates.tipo_fraccion = tipo_fraccion;
        if (cantidad_fraccion !== undefined) updates.cantidad_fraccion = cantidad_fraccion;

        // Handle EAN13 array update
        if (ean13 !== undefined) {
            const { data: articuloActual } = await supabase
                .from('articulos')
                .select('ean13')
                .eq('id', articulo_id)
                .single();

            const eanActual: string[] = articuloActual?.ean13 || [];
            // Add EAN if not already present
            if (!eanActual.includes(ean13)) {
                updates.ean13 = [...eanActual, ean13];
            }
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ message: 'No changes' });
        }

        const { error: updateError } = await supabase
            .from('articulos')
            .update(updates)
            .eq('id', articulo_id);

        if (updateError) throw updateError;

        return NextResponse.json({ success: true, articulo_id, updates });

    } catch (error: any) {
        console.error('[Actualizar Artículo] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
