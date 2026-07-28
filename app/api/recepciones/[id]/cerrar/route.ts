import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
import { nowArgentina } from '@/lib/utils';

// POST /api/recepciones/[id]/cerrar
// Body: {
//   decisions: [{
//     item_id: string,
//     tipo: 'precio' | 'mercaderia',
//     accion: 'A' | 'B' | 'C',  // A=empresa, B=transporte, C=proveedor
//     transporte_id?: string,    // for accion B
//     valor_real: number,        // real quantity or price
//     descripcion?: string,
//   }]
// }

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const { decisions } = body as { decisions: any[] };

        if (!decisions || decisions.length === 0) {
            return NextResponse.json({ error: 'decisions es requerido' }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: recepcion } = await supabase
            .from('recepciones')
            .select('proveedor_id, orden_compra:ordenes_compra(id, proveedor_id)')
            .eq('id', recepcion_id)
            .single();

        const proveedorId = recepcion?.proveedor_id || (recepcion?.orden_compra as any)?.proveedor_id;
        const ocId = (recepcion?.orden_compra as any)?.id;

        const results = [];

        for (const decision of decisions) {
            const { item_id, tipo, accion, transporte_id, valor_real, descripcion } = decision;

            const { data: item } = await supabase
                .from('recepciones_items')
                .select(`articulo_id, precio_real, precio_oc, precio_documentado, cantidad_documentada, cantidad_fisica,
                    articulo:articulos(sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, stock_actual)`)
                .eq('id', item_id)
                .single();

            if (!item) { results.push({ item_id, error: 'Not found' }); continue; }

            const articuloInfo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;
            const precioBase = item.precio_real || item.precio_documentado || item.precio_oc || 0;

            if (tipo === 'precio') {
                if (accion === 'A') {
                    // Asumir: update precio_compra on articulo
                    await supabase.from('articulos').update({ precio_compra: valor_real }).eq('id', item.articulo_id);
                    await supabase.from('recepciones_items').update({ precio_real: valor_real, precio_verificado: true }).eq('id', item_id);
                } else if (accion === 'B') {
                    // No asumir: generate NC in CC proveedor.
                    // Cantidad: lo documentado en factura; si no hay, lo recibido físico.
                    const cantidadNC = Number(item.cantidad_documentada || item.cantidad_fisica || 0);
                    const montoDif = Math.round((valor_real - (item.precio_oc || 0)) * cantidadNC * 100) / 100;
                    await supabase.from('cuenta_corriente_proveedores').insert({
                        proveedor_id: proveedorId,
                        tipo_movimiento: 'nota_credito',
                        monto: -Math.abs(montoDif),
                        descripcion: descripcion || `NC por diferencia precio artículo`,
                        referencia_id: recepcion_id,
                        referencia_tipo: 'recepcion',
                        fecha: nowArgentina(),
                    });
                    await supabase.from('recepciones_items').update({ precio_verificado: true }).eq('id', item_id);
                }
            } else if (tipo === 'mercaderia') {
                const cantidadDif = Math.abs(valor_real); // cantidad faltante en unidades

                if (accion === 'A') {
                    // Empresa absorbs: just adjust, no extra movement
                    await supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'empresa' }).eq('id', item_id);

                } else if (accion === 'B' && transporte_id) {
                    // Transporte: create CC transporte entry
                    await supabase.from('cuenta_corriente_transportes').insert({
                        transporte_id,
                        tipo_movimiento: 'faltante_mercaderia',
                        monto: Math.round(precioBase * cantidadDif * 100) / 100,
                        descripcion: descripcion || `Faltante ${cantidadDif} unidades artículo ${articuloInfo?.sku}`,
                        referencia_id: recepcion_id,
                        referencia_tipo: 'recepcion',
                        creado_por: auth.user.id,
                    });
                    await supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'transporte' }).eq('id', item_id);

                } else if (accion === 'C') {
                    // Proveedor: devolucion_compra kardex + CC proveedor
                    const stockActual = articuloInfo?.stock_actual || 0;

                    await insertarKardex(
                        supabase,
                        {
                            tipo_movimiento: 'devolucion_compra',
                            estado: 'confirmado',
                            fecha: nowArgentina(),
                            articulo_id: item.articulo_id,
                            cantidad: cantidadDif,
                            precio_lista: precioBase,
                            precio_unitario_final: precioBase,
                            subtotal_neto: Math.round(precioBase * cantidadDif * 100) / 100,
                            subtotal_total: Math.round(precioBase * cantidadDif * 100) / 100,
                            proveedor_id: proveedorId,
                            recepcion_id,
                            orden_compra_id: ocId,
                            stock_antes: stockActual,
                            stock_despues: Math.max(0, stockActual - cantidadDif),
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

                    // Adjust stock
                    const { error: rpcErr } = await supabase.rpc('actualizar_stock', { p_articulo_id: item.articulo_id, p_cantidad: -cantidadDif });
                    if (rpcErr) {
                        const { data: art } = await supabase.from('articulos').select('stock_actual').eq('id', item.articulo_id).single();
                        if (art) await supabase.from('articulos').update({ stock_actual: Math.max(0, (art.stock_actual || 0) - cantidadDif) }).eq('id', item.articulo_id);
                    }

                    // CC proveedor credit
                    if (proveedorId) {
                        await supabase.from('cuenta_corriente_proveedores').insert({
                            proveedor_id: proveedorId,
                            tipo_movimiento: 'devolucion_mercaderia',
                            monto: -Math.round(precioBase * cantidadDif * 100) / 100,
                            descripcion: descripcion || `Devolución ${cantidadDif} unidades al proveedor`,
                            referencia_id: recepcion_id,
                            referencia_tipo: 'recepcion',
                            fecha: nowArgentina(),
                        });
                    }

                    await supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'proveedor' }).eq('id', item_id);
                }
            }

            results.push({ item_id, tipo, accion, success: true });
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error('[Cerrar Recepción] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
