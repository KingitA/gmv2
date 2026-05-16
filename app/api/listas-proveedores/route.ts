import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';

export async function GET(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const proveedor_id = searchParams.get('proveedor_id');
    const estado = searchParams.get('estado');

    const supabase = createAdminClient();
    let query = supabase
        .from('listas_proveedores')
        .select(`*, proveedor:proveedores(nombre, razon_social)`)
        .order('fecha_vigencia', { ascending: false });

    if (proveedor_id) query = query.eq('proveedor_id', proveedor_id);
    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ listas: data });
}

export async function POST(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const body = await request.json();
        const { proveedor_id, nombre, fecha_vigencia, fecha_fin, archivo_url, observaciones } = body;

        if (!fecha_vigencia) return NextResponse.json({ error: 'fecha_vigencia es requerido' }, { status: 400 });

        const supabase = createAdminClient();

        const { data, error } = await supabase
            .from('listas_proveedores')
            .insert({
                proveedor_id,
                nombre,
                fecha_vigencia,
                fecha_fin,
                archivo_url,
                observaciones,
                estado: 'pendiente',
                creado_por: auth.user.id,
            })
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ lista: data });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
