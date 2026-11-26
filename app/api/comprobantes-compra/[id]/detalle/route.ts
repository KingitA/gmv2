import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermiso } from '@/lib/auth';
import { articulosDeLaOrden, autoVincularPorOrden, vincularRenglon } from '@/lib/compras/vincular-renglon';

// GET: detalle del comprobante con estado de match (para "Vincular renglones de la factura").
// Con ?con_orden=1 devuelve { filas, orden }: además los artículos de la orden de compra del
// comprobante (foto, marca, lo pedido) para proponer el que coincide (lib/compras/coincidencia-oc.ts).
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { id: comprobante_id } = await params;
    const supabase = createAdminClient();

    const { data, error } = await supabase
        .from('comprobantes_compra_detalle')
        .select(`
            *,
            articulo:articulos!comprobantes_compra_detalle_articulo_id_fkey(id, sku, descripcion),
            sugerido:articulos!comprobantes_compra_detalle_articulo_sugerido_id_fkey(id, sku, descripcion, proveedor_id, proveedor:proveedores(nombre))
        `)
        .eq('comprobante_id', comprobante_id)
        .order('created_at', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Una sugerencia de un artículo de OTRO proveedor es el último recurso del matching: se marca
    // para que nadie la confirme sin mirar (lib/matching/compra.ts).
    const { data: comp } = await supabase
        .from('comprobantes_compra')
        .select('proveedor_id, orden_compra_id, orden_compra:ordenes_compra(proveedor_id)')
        .eq('id', comprobante_id)
        .maybeSingle();
    const oc: any = Array.isArray((comp as any)?.orden_compra) ? (comp as any).orden_compra[0] : (comp as any)?.orden_compra;
    const proveedorComprobante: string | null = (comp as any)?.proveedor_id || oc?.proveedor_id || null;
    const filas = (data || []).map((r: any) => {
        const s = Array.isArray(r.sugerido) ? r.sugerido[0] : r.sugerido;
        const p = Array.isArray(s?.proveedor) ? s.proveedor[0] : s?.proveedor;
        const otro = !!s && !!proveedorComprobante && !!s.proveedor_id && s.proveedor_id !== proveedorComprobante;
        return { ...r, sugerido_otro_proveedor: otro ? (p?.nombre || 'otro proveedor') : null };
    });
    if (request.nextUrl.searchParams.get('con_orden') === '1') {
        const ordenId = (comp as any)?.orden_compra_id as string | null;
        const orden = ordenId ? await articulosDeLaOrden(supabase, ordenId) : [];
        return NextResponse.json({ filas, orden });
    }
    return NextResponse.json(filas);
}

// POST { accion: 'auto_vincular' }: vincula solos los renglones que coinciden con UN SOLO artículo
// de la orden (mismo camino que el PATCH: aprende la equivalencia). La lectura del comprobante ya
// lo hace (lib/services/detalle.ts); esto lo corre la pantalla para los comprobantes leídos antes.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermiso('compras');
    if (auth.error) return auth.error;
    const { id: comprobante_id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body?.accion !== 'auto_vincular') {
        return NextResponse.json({ error: 'accion desconocida' }, { status: 400 });
    }
    const vinculados = await autoVincularPorOrden(createAdminClient(), comprobante_id);
    return NextResponse.json({ success: true, vinculados });
}

// PATCH: confirmar/corregir el match de una línea del comprobante (también cambiar el artículo de
// una línea ya vinculada, p. ej. un vínculo automático equivocado).
// Aprende la equivalencia (RPC compras_aprender_equivalencia) para que la
// próxima factura del mismo proveedor matchee exacto por código/descripción.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermiso('compras');
    if (auth.error) return auth.error;

    try {
        const { id: comprobante_id } = await params;
        const { detalle_id, articulo_id } = await request.json();

        if (!detalle_id || !articulo_id) {
            return NextResponse.json({ error: 'detalle_id y articulo_id son requeridos' }, { status: 400 });
        }

        const r = await vincularRenglon(createAdminClient(), { comprobante_id, detalle_id, articulo_id, match_estado: 'manual' });
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
        return NextResponse.json({ success: true, detalle: r.detalle });
    } catch (error: any) {
        console.error('[detalle PATCH] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE /api/comprobantes-compra/[id]/detalle  { detalle_id }
// Marca un renglón como "NO es mercadería" (flete, un cargo, una leyenda). El renglón NO se
// borra: queda discriminado en el comprobante (match_estado = 'no_mercaderia') con su
// descripción e importe, y la deuda sigue siendo el TOTAL de la factura (decisión de Juan,
// 16/11: $100 + 21 % + 3 % de flete = $124, no $121). Solo renglones SIN artículo y de un
// comprobante sin validar: nunca tocaron la recepción ni el stock.
// Hace falta porque validar frena mientras queden renglones sin resolver (E-32).
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermiso('compras');
    if (auth.error) return auth.error;

    try {
        const { id: comprobante_id } = await params;
        const { detalle_id } = await request.json().catch(() => ({}));
        if (!detalle_id) return NextResponse.json({ error: 'detalle_id es requerido' }, { status: 400 });

        const supabase = createAdminClient();

        const { data: comprobante } = await supabase
            .from('comprobantes_compra')
            .select('id, estado')
            .eq('id', comprobante_id)
            .maybeSingle();
        if (!comprobante) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
        if (['validado', 'cerrado'].includes(comprobante.estado)) {
            return NextResponse.json({ error: 'El comprobante ya está validado: no se le pueden cambiar renglones.' }, { status: 409 });
        }

        // La condición va en el mismo UPDATE: si alguien lo vinculó recién, no se marca
        const { data: borrados, error } = await supabase
            .from('comprobantes_compra_detalle')
            .update({ match_estado: 'no_mercaderia', articulo_sugerido_id: null })
            .eq('id', detalle_id)
            .eq('comprobante_id', comprobante_id)
            .is('articulo_id', null)
            .select('id');
        if (error) throw error;
        if (!borrados || borrados.length === 0) {
            return NextResponse.json({ error: 'Ese renglón ya está vinculado a un artículo (o ya no existe): no se cambió.' }, { status: 409 });
        }
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[detalle DELETE] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
