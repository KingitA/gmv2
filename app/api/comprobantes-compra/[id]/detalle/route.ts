import { createAdminClient } from '@/lib/supabase/admin';
import { sumarDocumentado } from '@/lib/compras/documentado';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermiso } from '@/lib/auth';
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
        .select('proveedor_id, orden_compra:ordenes_compra(proveedor_id)')
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
    return NextResponse.json(filas);
}

// PATCH: confirmar/corregir el match de una línea del comprobante.
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
        // La línea sin vincular nació como 'unidad'; al vincularla se sabe si la factura la trae por bulto
        let tipoCantidad: string | null = null;
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
                    tipoCantidad = conversion.factor === 1 ? 'unidad' : 'bulto';

                    await sumarDocumentado(supabase, recItem.id, cantBase, {
                        precio_documentado: detalle.precio_unitario || 0,
                        precio_real: detalle.precio_unitario || recItem.precio_oc || 0,
                        cantidad_base: cantBase,
                        factor_conversion: conversion.factor,
                        conversion_source: conversion.source,
                        requires_review: conversion.requiresReview,
                    });

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
                // misma convención que el OCR: cantidad tal cual la factura + si son bultos o unidades
                ...(tipoCantidad ? { tipo_cantidad: tipoCantidad } : {}),
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
