import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const { item_id, monto_diferencia, descripcion } = body;

        if (!monto_diferencia || monto_diferencia === 0) {
            return NextResponse.json({ error: 'monto_diferencia es requerido' }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: recepcion } = await supabase
            .from('recepciones')
            .select('proveedor_id, orden_compra:ordenes_compra(proveedor_id)')
            .eq('id', recepcion_id)
            .single();

        const proveedorId = recepcion?.proveedor_id || (recepcion?.orden_compra as any)?.proveedor_id;
        if (!proveedorId) return NextResponse.json({ error: 'No se encontró el proveedor' }, { status: 400 });

        // Create NC movement in CC proveedor (negative = favor empresa)
        const { data: movimiento, error } = await supabase
            .from('cuenta_corriente_proveedores')
            .insert({
                proveedor_id: proveedorId,
                tipo_movimiento: 'nota_credito',
                monto: -Math.abs(monto_diferencia), // negative: proveedor owes us
                descripcion: descripcion || `NC por diferencia de precio en recepción ${recepcion_id}`,
                referencia_id: recepcion_id,
                referencia_tipo: 'recepcion',
                fecha: nowArgentina(),
            })
            .select()
            .single();

        if (error) throw error;

        // Mark item as NC generated
        if (item_id) {
            await supabase
                .from('recepciones_items')
                .update({ precio_verificado: true })
                .eq('id', item_id);
        }

        return NextResponse.json({ success: true, movimiento });

    } catch (error: any) {
        console.error('[Generar NC] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
