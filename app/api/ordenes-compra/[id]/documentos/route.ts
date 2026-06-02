import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { processWithGemini } from '@/lib/services/ocr';

// GET /api/ordenes-compra/[id]/documentos
// Returns all documents attached to the reception of this OC
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { id: ordenId } = await params;
    const supabase = createAdminClient();

    const { data: recepcion } = await supabase
        .from('recepciones')
        .select('id')
        .eq('orden_compra_id', ordenId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!recepcion) {
        return NextResponse.json({ documentos: [], recepcion_id: null });
    }

    const { data: documentos, error } = await supabase
        .from('recepciones_documentos')
        .select('*')
        .eq('recepcion_id', recepcion.id)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ documentos: documentos || [], recepcion_id: recepcion.id });
}

// POST /api/ordenes-compra/[id]/documentos
// Upload file + run OCR + save to recepciones_documentos
// Body: FormData { file, tipo_documento }
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { id: ordenId } = await params;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const tipo_documento = (formData.get('tipo_documento') as string) || 'factura';

    if (!file) {
        return NextResponse.json({ error: 'Se requiere un archivo' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Get or create draft reception for this OC
    let { data: recepcion } = await supabase
        .from('recepciones')
        .select('id, proveedor_id')
        .eq('orden_compra_id', ordenId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!recepcion) {
        const { data: oc } = await supabase
            .from('ordenes_compra')
            .select('proveedor_id')
            .eq('id', ordenId)
            .single();

        const { data: nueva, error: createErr } = await supabase
            .from('recepciones')
            .insert({
                orden_compra_id: ordenId,
                proveedor_id: oc?.proveedor_id,
                estado: 'borrador',
                usuario_id: auth.user.id,
                actualizado_por: auth.user.id,
            })
            .select('id, proveedor_id')
            .single();

        if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
        recepcion = nueva;

        // Create reception items from OC detail
        const { data: ocDetalle } = await supabase
            .from('ordenes_compra_detalle')
            .select('articulo_id, cantidad_pedida, precio_unitario')
            .eq('orden_compra_id', ordenId);

        if (ocDetalle && ocDetalle.length > 0) {
            await supabase.from('recepciones_items').insert(
                ocDetalle.map((d: any) => ({
                    recepcion_id: recepcion!.id,
                    articulo_id: d.articulo_id,
                    cantidad_oc: d.cantidad_pedida,
                    precio_oc: d.precio_unitario || 0,
                }))
            );
        }
    }

    // Check for duplicate by numero_comprobante if this is an invoicing document
    // (Will be validated after OCR)

    // Upload file to Supabase Storage
    const fileExt = file.name.split('.').pop();
    const storagePath = `${recepcion.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { error: uploadError } = await supabase.storage
        .from('comprobantes')
        .upload(storagePath, file);

    let publicUrl = '';
    if (!uploadError) {
        publicUrl = supabase.storage.from('comprobantes').getPublicUrl(storagePath).data.publicUrl;
    } else {
        console.warn('[Documentos OC] Storage upload error:', uploadError.message);
        publicUrl = `error-upload/${storagePath}`;
    }

    // Run OCR with Gemini
    const { data: proveedor } = await supabase
        .from('proveedores')
        .select('nombre, razon_social')
        .eq('id', recepcion.proveedor_id)
        .maybeSingle();

    const ocrResult = await processWithGemini(file, {
        proveedorNombre: proveedor?.nombre || proveedor?.razon_social,
        tipoDocumento: tipo_documento,
    });

    // Duplicate check: if OCR extracted a numero_comprobante, verify it doesn't exist
    const numeroExtraido = ocrResult.comprobante?.numero_comprobante;
    if (numeroExtraido) {
        const { data: existing } = await supabase
            .from('recepciones_documentos')
            .select('id')
            .eq('recepcion_id', recepcion.id)
            .filter('datos_ocr->>numero_comprobante', 'eq', numeroExtraido)
            .maybeSingle();

        if (existing) {
            // Clean up uploaded file
            if (!uploadError) await supabase.storage.from('comprobantes').remove([storagePath]);
            return NextResponse.json(
                { error: `El comprobante ${numeroExtraido} ya fue cargado anteriormente` },
                { status: 409 }
            );
        }
    }

    // Save document record
    const { data: doc, error: docError } = await supabase
        .from('recepciones_documentos')
        .insert({
            recepcion_id: recepcion.id,
            tipo_documento,
            url_imagen: publicUrl,
            storage_path: uploadError ? null : storagePath,
            nombre_archivo: file.name,
            tipo_mime: file.type,
            datos_ocr: ocrResult,
            procesado: true,
        })
        .select()
        .single();

    if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });

    // Update recepciones_items with OCR data
    if (ocrResult.items && ocrResult.items.length > 0) {
        await updateItemsFromOCR(supabase, recepcion.id, ocrResult, recepcion.proveedor_id);
    }

    return NextResponse.json({
        success: true,
        documento: doc,
        recepcion_id: recepcion.id,
        ocr: {
            comprobante: ocrResult.comprobante,
            items_count: ocrResult.items.length,
            items: ocrResult.items,
        },
    });
}

// DELETE /api/ordenes-compra/[id]/documentos
// Body: { documento_id }
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const body = await request.json();
    const { documento_id } = body;

    if (!documento_id) {
        return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: doc, error: fetchErr } = await supabase
        .from('recepciones_documentos')
        .select('id, storage_path, recepcion_id')
        .eq('id', documento_id)
        .single();

    if (fetchErr || !doc) {
        return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    // Delete from Storage if we have the path
    if (doc.storage_path) {
        const { error: storageErr } = await supabase.storage
            .from('comprobantes')
            .remove([doc.storage_path]);
        if (storageErr) console.warn('[Documentos OC] Storage delete error:', storageErr.message);
    }

    const { error: deleteErr } = await supabase
        .from('recepciones_documentos')
        .delete()
        .eq('id', documento_id);

    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    return NextResponse.json({ success: true });
}

// Helper: update recepciones_items quantities/prices from OCR data
async function updateItemsFromOCR(supabase: any, recepcionId: string, ocrResult: any, proveedorId: string) {
    const { MatchingEngine } = await import('@/lib/matching/matcher');
    const { resolveFactorConversion } = await import('@/lib/services/conversion');

    const { data: currentItems } = await supabase
        .from('recepciones_items')
        .select('*, articulo:articulos(id, descripcion, sku, unidades_por_bulto, precio_compra)')
        .eq('recepcion_id', recepcionId);

    if (!currentItems || currentItems.length === 0) return;

    const { data: proveedor } = await supabase
        .from('proveedores')
        .select('default_unidad_factura')
        .eq('id', proveedorId)
        .maybeSingle();

    const engine = new MatchingEngine();

    for (const item of ocrResult.items) {
        const matchResult = await engine.resolveItem(
            { description: item.descripcion, code: item.codigo, price: item.precio_unitario },
            proveedorId
        );

        if (matchResult.status !== 'matched' || !matchResult.bestCandidate?.sku_id) continue;

        const matchedItem = currentItems.find((ci: any) => ci.articulo_id === matchResult.bestCandidate!.sku_id);
        if (!matchedItem) continue;

        const conversion = resolveFactorConversion({
            proveedorDefaultUnidad: proveedor?.default_unidad_factura,
            articuloUnidadesPorBulto: matchedItem.articulo?.unidades_por_bulto,
            descripcionOcr: item.descripcion,
            ocrUnidadMedida: item.unidad_medida,
            precioDocumento: item.precio_unitario,
            costoBaseArticulo: matchedItem.articulo?.precio_compra,
        });

        const cantidadBase = (item.cantidad || 0) * conversion.factor;

        await supabase
            .from('recepciones_items')
            .update({
                cantidad_documentada: cantidadBase,
                precio_documentado: item.precio_unitario || 0,
                precio_real: item.precio_unitario || matchedItem.precio_oc || 0,
                cantidad_base: cantidadBase,
                factor_conversion: conversion.factor,
                conversion_source: conversion.source,
                requires_review: conversion.requiresReview,
            })
            .eq('id', matchedItem.id);
    }
}
