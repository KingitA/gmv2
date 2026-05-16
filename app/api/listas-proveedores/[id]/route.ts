import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { id } = await params;
    const supabase = createAdminClient();

    const { data: lista, error } = await supabase
        .from('listas_proveedores')
        .select(`*, proveedor:proveedores(nombre, razon_social)`)
        .eq('id', id)
        .single();

    if (error || !lista) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: items } = await supabase
        .from('listas_proveedores_items')
        .select(`*, articulo:articulos(sku, descripcion, precio_compra, descuento1, descuento2, descuento3, descuento4)`)
        .eq('lista_id', id)
        .order('created_at');

    return NextResponse.json({ lista, items: items || [] });
}
