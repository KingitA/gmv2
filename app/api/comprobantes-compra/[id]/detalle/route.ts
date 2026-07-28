import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveFactorConversion } from '@/lib/services/conversion';

// GET: detalle del comprobante con estado de match (para "Revisar matches")
export async function GET(
    _request: NextRequest,
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
            sugerido:articulos!comprobantes_compra_detalle_articulo_sugerido_id_fkey(id, sku, descripcion)
        `)
        .eq('comprobante_id', comprobante_id)
        .order('created_at', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data || []);
}

// PATCH: confirmar/corregir el match de una línea del comprobante.
// Aprende la equivalencia (RPC compras_aprender_equivalencia) para que la
// próxima factura del mismo proveedor matchee exacto por código/descripción.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: comprobante_id } = await params;
        const { detalle_id, articulo_id } = await request.json();

        if (!detalle_id || !articulo_id) {
            return NextResponse.json({ error: 'detalle_id y articulo_id son requeridos' }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: detalle } = await supabase
            .from('comprobantes_compra_detalle')
            .select('*')
            .eq('id', detalle_id)
            .eq('comprobante_id', comprobante_id)
            .maybeSingle();

        if (!detalle) {
            return NextResponse.json({ error: 'Línea de detalle no encontrada' }, { status: 404 });
        }

        const { data: comprobante } = await supabase
            .from('comprobantes_compra')
            .select('id, proveedor_id, orden_compra_id')
            .eq('id', comprobante_id)
            .maybeSingle();

        if (!comprobante?.proveedor_id) {
            return NextResponse.json({ error: 'Comprobante sin proveedor' }, { status: 400 });
        }

        // 1. Aprender la equivalencia proveedor↔artículo
        const { error: rpcError } = await supabase.rpc('compras_aprender_equivalencia', {
            p_articulo_id: articulo_id,
            p_proveedor_id: comprobante.proveedor_id,
            p_codigo_proveedor: detalle.codigo_proveedor || null,
            p_descripcion: detalle.descripcion_proveedor || null,
        });
        if (rpcError) {
            console.error('[detalle PATCH] aprender_equivalencia:', rpcError.message);
        }

        // 2. Vincular con la recepción de la OC (crear línea fuera_de_oc si no estaba pedida)
        let recepcionItemId: string | null = detalle.recepcion_item_id;
        if (comprobante.orden_compra_id) {
            const { data: recepcion } = await supabase
                .from('recepciones')
                .select('id')
                .eq('orden_compra_id', comprobante.orden_compra_id)
                .neq('estado', 'cancelada')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (recepcion) {
                let { data: recItem } = await supabase
                    .from('recepciones_items')
                    .select('*, articulo:articulos(id, unidades_por_bulto, precio_compra)')
                    .eq('recepcion_id', recepcion.id)
                    .eq('articulo_id', articulo_id)
                    .maybeSingle();

                if (!recItem) {
                    const { data: nueva } = await supabase
                        .from('recepciones_items')
                        .insert({
                            recepcion_id: recepcion.id,
                            articulo_id,
                            cantidad_oc: 0,
                            cantidad_fisica: 0,
                            estado_linea: 'pendiente',
                            fuera_de_oc: true,
                        })
                        .select('*, articulo:articulos(id, unidades_por_bulto, precio_compra)')
                        .single();
                    recItem = nueva;
                }

                if (recItem) {
                    const { data: proveedor } = await supabase
                        .from('proveedores')
                        .select('default_unidad_factura')
                        .eq('id', comprobante.proveedor_id)
                        .maybeSingle();

                    const conversion = resolveFactorConversion({
                        proveedorDefaultUnidad: proveedor?.default_unidad_factura,
                        articuloUnidadesPorBulto: recItem.articulo?.unidades_por_bulto,
                        descripcionOcr: detalle.descripcion_proveedor,
                        precioDocumento: detalle.precio_unitario,
                        costoBaseArticulo: recItem.articulo?.precio_compra,
                    });

                    const cantBase = Number(detalle.cantidad_facturada || 0) * conversion.factor;

                    await supabase
                        .from('recepciones_items')
                        .update({
                            cantidad_documentada: Number(recItem.cantidad_documentada || 0) + cantBase,
                            precio_documentado: detalle.precio_unitario || 0,
                            precio_real: detalle.precio_unitario || recItem.precio_oc || 0,
                            cantidad_base: cantBase,
                            factor_conversion: conversion.factor,
                            conversion_source: conversion.source,
                            requires_review: conversion.requiresReview,
                        })
                        .eq('id', recItem.id);

                    recepcionItemId = recItem.id;
                }
            }
        }

        // 3. Actualizar la línea del detalle como confirmada manualmente
        const { data: updated, error: updError } = await supabase
            .from('comprobantes_compra_detalle')
            .update({
                articulo_id,
                articulo_sugerido_id: null,
                match_estado: 'manual',
                recepcion_item_id: recepcionItemId,
            })
            .eq('id', detalle_id)
            .select()
            .single();

        if (updError) throw updError;

        return NextResponse.json({ success: true, detalle: updated });
    } catch (error: any) {
        console.error('[detalle PATCH] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
