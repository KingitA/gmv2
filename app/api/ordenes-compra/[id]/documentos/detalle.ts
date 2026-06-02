import { MatchingEngine } from '@/lib/matching/matcher';
import { resolveFactorConversion } from '@/lib/services/conversion';

// Shared: matches OCR items, creates comprobantes_compra_detalle and updates recepciones_items.
// Used by both the ERP documents route and the deposito OCR route.
export async function matchAndCreateDetalle(supabase: any, params: {
    comprobante_id: string;
    recepcion_id: string;
    proveedor_id: string;
    items: any[];
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

    const detalleRows: any[] = [];
    const matched: any[] = [];

    for (const item of params.items) {
        const matchResult = await engine.resolveItem(
            { description: item.descripcion, code: item.codigo, price: item.precio_unitario },
            params.proveedor_id
        );

        if (matchResult.status !== 'matched' || !matchResult.bestCandidate?.sku_id) {
            detalleRows.push({
                comprobante_id: params.comprobante_id,
                articulo_id: null,
                cantidad_facturada: item.cantidad || 1,
                precio_unitario: item.precio_unitario || 0,
                descuento1: item.descuento || 0,
                descripcion_proveedor: item.descripcion,
                codigo_proveedor: item.codigo,
                tipo_cantidad: 'unidad',
                costo_final: (item.precio_unitario || 0) * (item.cantidad || 1),
            });
            continue;
        }

        const articuloId = matchResult.bestCandidate.sku_id;
        const recItem = (recItems || []).find((ri: any) => ri.articulo_id === articuloId);
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
            comprobante_id: params.comprobante_id,
            articulo_id: articuloId,
            cantidad_facturada: item.cantidad || 1,
            precio_unitario: item.precio_unitario || 0,
            descuento1: item.descuento || 0,
            descripcion_proveedor: item.descripcion,
            codigo_proveedor: item.codigo,
            tipo_cantidad: conversion.factor === 1 ? 'unidad' : 'bulto',
            costo_final: (item.precio_unitario || 0) * (1 - (item.descuento || 0) / 100),
        });

        if (recItem) {
            await supabase
                .from('recepciones_items')
                .update({
                    cantidad_documentada: cantBase,
                    precio_documentado: item.precio_unitario || 0,
                    precio_real: item.precio_unitario || recItem.precio_oc || 0,
                    cantidad_base: cantBase,
                    factor_conversion: conversion.factor,
                    conversion_source: conversion.source,
                    requires_review: conversion.requiresReview,
                })
                .eq('id', recItem.id);
        }

        matched.push({ articulo_id: articuloId, descripcion: item.descripcion });
    }

    if (detalleRows.length > 0) {
        await supabase.from('comprobantes_compra_detalle').insert(detalleRows);
    }

    return matched;
}
