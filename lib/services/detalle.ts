import { MatchingEngine } from '@/lib/matching/matcher';
import { resolveFactorConversion } from '@/lib/services/conversion';

// Matches OCR items against catalog, creates comprobantes_compra_detalle rows,
// and updates recepciones_items with documented prices/quantities.
// Used by both the ERP documents route and the deposito OCR route.
// Persists EVERY line (matched or not) with suggestion metadata so the
// "Revisar matches" UI can correct them and feed the learning loop.
export async function matchAndCreateDetalle(supabase: any, params: {
    comprobante_id: string;
    recepcion_id: string;
    proveedor_id: string;
    items: any[];
    documento_id?: string;
}) {
    const engine = new MatchingEngine();

    const { data: recItems } = await supabase
        .from('recepciones_items')
        .select('*, articulo:articulos(id, sku, unidades_por_bulto, precio_compra, iva_compras)')
        .eq('recepcion_id', params.recepcion_id);

    const { data: proveedor } = await supabase
        .from('proveedores')
        .select('default_unidad_factura')
        .eq('id', params.proveedor_id)
        .maybeSingle();

    const currentRecItems: any[] = recItems || [];
    const detalleRows: any[] = [];
    const matched: any[] = [];

    for (const item of params.items) {
        const matchResult = await engine.resolveItem(
            { description: item.descripcion, code: item.codigo, ean: item.ean, price: item.precio_unitario },
            params.proveedor_id
        );

        const best = matchResult.bestCandidate;
        const isMatched = matchResult.status === 'matched' && !!best?.sku_id;
        const isSuggestion = !isMatched && !!best?.sku_id && best.confidence_level === 'suggestion';

        const baseRow = {
            comprobante_id: params.comprobante_id,
            cantidad_facturada: item.cantidad || 1,
            precio_unitario: item.precio_unitario || 0,
            descuento1: item.descuento || 0,
            descripcion_proveedor: item.descripcion,
            codigo_proveedor: item.codigo,
            match_score: best?.score ?? null,
        };

        if (!isMatched) {
            detalleRows.push({
                ...baseRow,
                articulo_id: null,
                articulo_sugerido_id: isSuggestion ? best!.sku_id : null,
                match_estado: isSuggestion ? 'sugerido' : 'sin_match',
                recepcion_item_id: null,
                tipo_cantidad: 'unidad',
                costo_final: (item.precio_unitario || 0) * (item.cantidad || 1),
            });
            continue;
        }

        const articuloId = best!.sku_id;
        let recItem = currentRecItems.find((ri: any) => ri.articulo_id === articuloId);

        // Ítem facturado que no estaba en la OC: crear la línea de recepción
        // marcada fuera_de_oc para que depósito y verificación la vean.
        if (!recItem) {
            const { data: nuevaLinea } = await supabase
                .from('recepciones_items')
                .insert({
                    recepcion_id: params.recepcion_id,
                    articulo_id: articuloId,
                    cantidad_oc: 0,
                    cantidad_fisica: 0,
                    estado_linea: 'pendiente',
                    fuera_de_oc: true,
                })
                .select('*, articulo:articulos(id, sku, unidades_por_bulto, precio_compra, iva_compras)')
                .single();
            if (nuevaLinea) {
                recItem = nuevaLinea;
                currentRecItems.push(nuevaLinea);
            }
        }

        const articulo = recItem?.articulo;

        const conversion = resolveFactorConversion({
            proveedorDefaultUnidad: proveedor?.default_unidad_factura,
            articuloUnidadesPorBulto: articulo?.unidades_por_bulto,
            descripcionOcr: item.descripcion,
            ocrUnidadMedida: item.unidad_medida,
            precioDocumento: item.precio_unitario,
            costoBaseArticulo: articulo?.precio_compra,
        });

        const cantBase = (item.cantidad || 0) * conversion.factor;

        detalleRows.push({
            ...baseRow,
            articulo_id: articuloId,
            articulo_sugerido_id: null,
            match_estado: 'auto',
            recepcion_item_id: recItem?.id ?? null,
            tipo_cantidad: conversion.factor === 1 ? 'unidad' : 'bulto',
            costo_final: (item.precio_unitario || 0) * (1 - (item.descuento || 0) / 100),
        });

        if (conversion.requiresReview) {
            await supabase.from('ocr_conversion_warnings').insert({
                recepcion_id: params.recepcion_id,
                documento_id: params.documento_id,
                proveedor_id: params.proveedor_id,
                articulo_id: articuloId,
                descripcion_ocr: item.descripcion || '',
                cantidad_ocr: item.cantidad,
                warning_type: conversion.warningType || '',
                warning_message: conversion.warningMessage || '',
                conversion_attempted: conversion,
            }).then(({ error }: any) => {
                if (error) console.error('[matchAndCreateDetalle] warning insert error:', error.message);
            });
        }

        if (recItem) {
            // Acumular (no pisar): puede haber varios documentos por recepción.
            await supabase
                .from('recepciones_items')
                .update({
                    cantidad_documentada: Number(recItem.cantidad_documentada || 0) + cantBase,
                    precio_documentado: item.precio_unitario || 0,
                    precio_real: item.precio_unitario || recItem.precio_oc || 0,
                    cantidad_base: cantBase,
                    factor_conversion: conversion.factor,
                    conversion_source: conversion.source,
                    requires_review: conversion.requiresReview,
                })
                .eq('id', recItem.id);
            recItem.cantidad_documentada = Number(recItem.cantidad_documentada || 0) + cantBase;
        }

        matched.push({ articulo_id: articuloId, descripcion: item.descripcion });
    }

    if (detalleRows.length > 0) {
        const { error } = await supabase.from('comprobantes_compra_detalle').insert(detalleRows);
        if (error) console.error('[matchAndCreateDetalle] Insert error:', error.message);
    }

    return matched;
}

// Revierte lo que el OCR de un documento aplicó: resta cantidades documentadas
// de recepciones_items (vía comprobantes_compra_detalle.recepcion_item_id) y
// elimina detalle + comprobante creado por ese documento.
// Devuelve error si el comprobante ya fue validado (tiene CC/vencimientos).
export async function revertirComprobanteOCR(supabase: any, comprobante_id: string): Promise<{ error?: string }> {
    const { data: comprobante } = await supabase
        .from('comprobantes_compra')
        .select('id, estado')
        .eq('id', comprobante_id)
        .maybeSingle();

    if (!comprobante) return {};
    if (comprobante.estado === 'validado' || comprobante.estado === 'cerrado') {
        return { error: 'El comprobante ya fue validado — anulá la validación antes de eliminar el documento' };
    }

    const { data: detalle } = await supabase
        .from('comprobantes_compra_detalle')
        .select('id, recepcion_item_id, cantidad_facturada')
        .eq('comprobante_id', comprobante_id);

    for (const det of detalle || []) {
        if (!det.recepcion_item_id) continue;
        const { data: item } = await supabase
            .from('recepciones_items')
            .select('id, cantidad_documentada, factor_conversion, fuera_de_oc, cantidad_fisica')
            .eq('id', det.recepcion_item_id)
            .maybeSingle();
        if (!item) continue;

        const factor = Number(item.factor_conversion || 1);
        const restar = Number(det.cantidad_facturada || 0) * factor;
        const nuevaCant = Math.max(0, Number(item.cantidad_documentada || 0) - restar);

        // Línea creada solo por este documento (fuera de OC, sin recepción física): eliminarla
        if (item.fuera_de_oc && nuevaCant === 0 && Number(item.cantidad_fisica || 0) === 0) {
            await supabase.from('recepciones_items').delete().eq('id', item.id);
        } else {
            await supabase.from('recepciones_items')
                .update({
                    cantidad_documentada: nuevaCant,
                    ...(nuevaCant === 0 ? { precio_documentado: 0 } : {}),
                })
                .eq('id', item.id);
        }
    }

    await supabase.from('comprobantes_compra_detalle').delete().eq('comprobante_id', comprobante_id);
    await supabase.from('comprobantes_compra').delete().eq('id', comprobante_id);
    return {};
}
