import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
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
        const { item_id, cantidad_devolucion, motivo } = body;

        if (!item_id || !cantidad_devolucion || cantidad_devolucion <= 0) {
            return NextResponse.json({ error: 'item_id y cantidad_devolucion son requeridos' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // Get item details
        const { data: item, error: itemError } = await supabase
            .from('recepciones_items')
            .select(`
                articulo_id,
                precio_real, precio_oc, precio_documentado,
                articulo:articulos(sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, stock_actual)
            `)
            .eq('id', item_id)
            .eq('recepcion_id', recepcion_id)
            .single();

        if (itemError || !item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

        const { data: recepcion } = await supabase
            .from('recepciones')
            .select('proveedor_id, orden_compra:ordenes_compra(id, proveedor_id)')
            .eq('id', recepcion_id)
            .single();

        const proveedorId = recepcion?.proveedor_id || (recepcion?.orden_compra as any)?.proveedor_id;
        const precioCompra = item.precio_real || item.precio_documentado || item.precio_oc || 0;
        const articuloInfo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;
        const stockActual = articuloInfo?.stock_actual || 0;

        // Insert kardex devolucion_compra (reduces stock)
        await insertarKardex(
            supabase,
            {
                tipo_movimiento: 'devolucion_compra',
                estado: 'confirmado',
                fecha: nowArgentina(),
                articulo_id: item.articulo_id,
                cantidad: cantidad_devolucion,
                precio_lista: precioCompra,
                precio_unitario_final: precioCompra,
                subtotal_neto: Math.round(precioCompra * cantidad_devolucion * 100) / 100,
                subtotal_total: Math.round(precioCompra * cantidad_devolucion * 100) / 100,
                proveedor_id: proveedorId,
                recepcion_id,
                orden_compra_id: (recepcion?.orden_compra as any)?.id,
                stock_antes: stockActual,
                stock_despues: stockActual - cantidad_devolucion,
                operador_id: auth.user.id,
            },
            {
                sku: articuloInfo?.sku,
                descripcion: articuloInfo?.descripcion,
                categoria: articuloInfo?.categoria,
                marca_id: articuloInfo?.marca_id,
                proveedor_id: articuloInfo?.proveedor_id,
                iva_compras: articuloInfo?.iva_compras,
                iva_ventas: articuloInfo?.iva_ventas,
            }
        );

        // Update stock (reduce)
        const { error: rpcErr } = await supabase.rpc('actualizar_stock', { p_articulo_id: item.articulo_id, p_cantidad: -cantidad_devolucion });
        if (rpcErr) {
            const { data: art } = await supabase.from('articulos').select('stock_actual').eq('id', item.articulo_id).single();
            if (art) await supabase.from('articulos').update({ stock_actual: (art.stock_actual || 0) - cantidad_devolucion }).eq('id', item.articulo_id);
        }

        // CC proveedor: negative movement (provider owes us goods/money)
        if (proveedorId) {
            await supabase.from('cuenta_corriente_proveedores').insert({
                proveedor_id: proveedorId,
                tipo_movimiento: 'devolucion_mercaderia',
                monto: -Math.round(precioCompra * cantidad_devolucion * 100) / 100,
                descripcion: motivo || `Devolución ${cantidad_devolucion} unidades al proveedor`,
                referencia_id: recepcion_id,
                referencia_tipo: 'recepcion',
                fecha: nowArgentina(),
            });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('[Generar Devolución] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
