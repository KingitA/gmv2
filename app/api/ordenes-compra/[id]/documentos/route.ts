import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { processWithGemini , inferirTipoComprobante } from '@/lib/services/ocr';
import { buscarComprobanteDuplicado, comprobanteDesdeOCR, datosNoLeido, mensajeDuplicado, motivoNoLeido } from '@/lib/services/documento-compra';


// GET /api/ordenes-compra/[id]/documentos
// Returns documents with signed URLs for viewing
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

    if (!recepcion) return NextResponse.json({ documentos: [], recepcion_id: null });

    const { data: documentos, error } = await supabase
        .from('recepciones_documentos')
        .select('*')
        .eq('recepcion_id', recepcion.id)
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Generate signed URLs for each document so they're always viewable
    const docsWithUrls = await Promise.all((documentos || []).map(async (doc: any) => {
        const storagePath = doc.storage_path ||
            (doc.url_imagen?.includes('/comprobantes/') ? doc.url_imagen.match(/\/comprobantes\/(.+?)(\?|$)/)?.[1] : null);
        if (storagePath) {
            const { data: signed } = await supabase.storage
                .from('comprobantes')
                .createSignedUrl(storagePath, 3600 * 24); // 24 hours
            if (signed?.signedUrl) return { ...doc, signed_url: signed.signedUrl };
        }
        return { ...doc, signed_url: doc.url_imagen };
    }));

    return NextResponse.json({ documentos: docsWithUrls, recepcion_id: recepcion.id });
}

// POST /api/ordenes-compra/[id]/documentos
// Upload + OCR → auto-crea comprobante_compra + detalle
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

    if (!file) return NextResponse.json({ error: 'Se requiere un archivo' }, { status: 400 });

    const supabase = createAdminClient();

    // Cargar OC (no FK defined → separate queries)
    const { data: oc } = await supabase
        .from('ordenes_compra')
        .select('id, proveedor_id, numero_orden')
        .eq('id', ordenId)
        .maybeSingle();

    if (!oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });

    const { data: proveedorData } = await supabase
        .from('proveedores')
        .select('nombre, razon_social')
        .eq('id', oc.proveedor_id)
        .maybeSingle();

    // Obtener o crear recepción draft
    let { data: recepcion } = await supabase
        .from('recepciones')
        .select('id, proveedor_id')
        .eq('orden_compra_id', ordenId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!recepcion) {
        const { data: nueva, error: createErr } = await supabase
            .from('recepciones')
            .insert({
                orden_compra_id: ordenId,
                proveedor_id: oc.proveedor_id,
                estado: 'borrador',
                usuario_id: auth.user.id,
                actualizado_por: auth.user.id,
            })
            .select('id, proveedor_id')
            .single();

        if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
        recepcion = nueva;

        // Crear items de recepción desde el detalle de la OC
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

    // Upload a Storage
    const storagePath = `${recepcion.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: uploadError } = await supabase.storage.from('comprobantes').upload(storagePath, file);
    if (uploadError) console.warn('[Docs OC] Storage error:', uploadError.message);

    let signedUrl = '';
    let publicUrl = '';
    if (!uploadError) {
        const { data: signed } = await supabase.storage.from('comprobantes').createSignedUrl(storagePath, 3600);
        signedUrl = signed?.signedUrl || '';
        publicUrl = supabase.storage.from('comprobantes').getPublicUrl(storagePath).data.publicUrl;
    }

    // OCR con Gemini
    const proveedorNombre = proveedorData?.nombre || proveedorData?.razon_social;
    const ocrResult = await processWithGemini(file, { proveedorNombre, tipoDocumento: tipo_documento });

    const compMeta = ocrResult.comprobante;
    const numeroExtraido = compMeta?.numero_comprobante;
    // E-37: la IA falló o no encontró renglones ⇒ el documento queda "no leído", sin comprobante
    const noLeido = motivoNoLeido(ocrResult);

    // E-36: duplicado por proveedor + clase + número normalizado, en ESTA orden o en cualquier otra
    // (antes solo miraba esta orden y comparaba el número tal cual lo leyó la IA).
    if (!noLeido && numeroExtraido) {
        const dup = await buscarComprobanteDuplicado(supabase, {
            proveedor_id: oc.proveedor_id,
            tipo: inferirTipoComprobante(ocrResult, tipo_documento),
            numero: numeroExtraido,
        });
        if (dup) {
            if (!uploadError) await supabase.storage.from('comprobantes').remove([storagePath]);
            return NextResponse.json(
                { error: mensajeDuplicado(dup, ordenId), codigo: 'comprobante_duplicado', comprobante_id: dup.id },
                { status: 409 }
            );
        }
    }

    // Guardar documento en recepciones_documentos
    const { data: doc, error: docError } = await supabase
        .from('recepciones_documentos')
        .insert({
            recepcion_id: recepcion.id,
            tipo_documento,
            url_imagen: publicUrl || signedUrl,
            storage_path: uploadError ? null : storagePath,
            nombre_archivo: file.name,
            tipo_mime: file.type,
            datos_ocr: noLeido ? datosNoLeido(ocrResult, noLeido) : ocrResult,
            procesado: !noLeido,
        })
        .select()
        .single();
    if (docError) return NextResponse.json({ error: `No se pudo guardar el documento: ${docError.message}` }, { status: 500 });

    if (noLeido) {
        return NextResponse.json({
            success: true,
            no_leido: true,
            aviso: `${noLeido} El archivo quedó guardado como "no leído" y NO generó comprobante: subilo de nuevo (más nítido, o el PDF original) o cargá el comprobante a mano.`,
            documento: { ...doc, signed_url: signedUrl || publicUrl },
            comprobante: null,
            recepcion_id: recepcion.id,
            ocr: { comprobante: compMeta ?? null, items_detectados: 0, items_vinculados: 0, items: [] },
        });
    }

    // Comprobante de compra + detalle desde los datos del OCR (lógica compartida con depósito).
    // Sin número legible no se crea otro "PENDIENTE-…": se suma al provisorio de la orden.
    const r = await comprobanteDesdeOCR(supabase, {
        orden_compra_id: ordenId,
        proveedor_id: oc.proveedor_id,
        recepcion_id: recepcion.id,
        documento_id: doc?.id,
        ocr: ocrResult,
        tipo_documento,
        foto_url: publicUrl || signedUrl,
    });
    const comprobante = r.comprobante;
    const aviso = r.error
        ? `El archivo se leyó pero no se pudo crear el comprobante (${r.error}).`
        : r.sumado_a_provisorio
            ? 'No se leyó el número del comprobante: los renglones se sumaron al comprobante provisorio de esta orden. Completale el número con el lápiz.'
            : !numeroExtraido
                ? 'No se leyó el número del comprobante: quedó como provisorio. Completale el número con el lápiz.'
                : undefined;

    return NextResponse.json({
        success: true,
        documento: { ...doc, signed_url: signedUrl || publicUrl },
        comprobante,
        recepcion_id: recepcion.id,
        ...(aviso ? { aviso } : {}),
        ocr: {
            comprobante: compMeta,
            items_detectados: ocrResult.items.length,
            items_vinculados: r.vinculados.length,
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
    if (!documento_id) return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });

    const supabase = createAdminClient();

    const { data: doc } = await supabase
        .from('recepciones_documentos')
        .select('id, storage_path, recepcion_id, comprobante_id')
        .eq('id', documento_id)
        .single();

    if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    // Revertir lo que el OCR de este documento aplicó (detalle + cantidades documentadas)
    if (doc.comprobante_id) {
        const { revertirComprobanteOCR } = await import('@/lib/services/detalle');
        const { error: revertError } = await revertirComprobanteOCR(supabase, doc.comprobante_id);
        if (revertError) {
            return NextResponse.json({ error: revertError }, { status: 409 });
        }
    }

    if (doc.storage_path) {
        await supabase.storage.from('comprobantes').remove([doc.storage_path]);
    }

    await supabase.from('recepciones_documentos').delete().eq('id', documento_id);

    return NextResponse.json({ success: true });
}

