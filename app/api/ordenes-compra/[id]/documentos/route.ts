import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { processWithGemini } from '@/lib/services/ocr';
import { todayArgentina } from '@/lib/utils';

// Mapeo tipo OCR → tipo interno
function mapTipoComprobante(ocr: string | null | undefined, tipoDocumento: string): string {
    if (!ocr) {
        const map: Record<string, string> = { factura: 'FA', remito: 'Adquisicion', adquisicion: 'Adquisicion', nota_credito: 'NC' };
        return map[tipoDocumento] || 'FA';
    }
    const s = ocr.toUpperCase().trim();
    if (s === 'FA' || s.includes('FACTURA A')) return 'FA';
    if (s === 'FB' || s.includes('FACTURA B')) return 'FB';
    if (s === 'FC' || s.includes('FACTURA C')) return 'FC';
    if (s.includes('REMITO')) return 'Adquisicion';
    if (s.includes('ADQUIS')) return 'Adquisicion';
    if (s === 'NC' || s.includes('NOTA DE CR')) return 'NC';
    if (s === 'ND' || s.includes('NOTA DE D')) return 'NC';
    return 'FA';
}

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

    // Chequeo de duplicado en comprobantes_compra
    if (numeroExtraido) {
        const { data: dup } = await supabase
            .from('comprobantes_compra')
            .select('id, numero_comprobante')
            .eq('orden_compra_id', ordenId)
            .eq('numero_comprobante', numeroExtraido)
            .maybeSingle();

        if (dup) {
            if (!uploadError) await supabase.storage.from('comprobantes').remove([storagePath]);
            return NextResponse.json(
                { error: `El comprobante ${numeroExtraido} ya está cargado en esta orden` },
                { status: 409 }
            );
        }
    }

    // Guardar documento en recepciones_documentos
    const { data: doc } = await supabase
        .from('recepciones_documentos')
        .insert({
            recepcion_id: recepcion.id,
            tipo_documento,
            url_imagen: publicUrl || signedUrl,
            storage_path: uploadError ? null : storagePath,
            nombre_archivo: file.name,
            tipo_mime: file.type,
            datos_ocr: ocrResult,
            procesado: true,
        })
        .select()
        .single();

    // Auto-crear comprobante_compra desde los datos del OCR
    const tipoComp = mapTipoComprobante(compMeta?.tipo_comprobante, tipo_documento);
    const numeroComp = numeroExtraido || `PENDIENTE-${Date.now()}`;
    const fechaComp = compMeta?.fecha || todayArgentina();
    const totalFactura = compMeta?.total_factura || 0;
    const totalNeto = compMeta?.subtotal_neto || (totalFactura > 0 ? totalFactura / 1.21 : 0);
    const totalIva = compMeta?.total_iva || (totalNeto > 0 && totalFactura > 0 ? totalFactura - totalNeto : 0);
    const percIva = compMeta?.percepcion_iva || 0;
    const percIibb = compMeta?.percepcion_iibb || 0;
    const retGanancias = compMeta?.retencion_ganancias || 0;
    const descGlobal = compMeta?.descuento_global || 0;

    const { data: comprobante, error: compError } = await supabase
        .from('comprobantes_compra')
        .insert({
            orden_compra_id: ordenId,
            proveedor_id: oc.proveedor_id,
            tipo_comprobante: tipoComp,
            numero_comprobante: numeroComp,
            fecha_comprobante: fechaComp,
            total_factura_declarado: totalFactura,
            total_neto: totalNeto,
            total_iva: totalIva,
            percepcion_iva_monto: percIva,
            percepcion_iibb_monto: percIibb,
            retencion_ganancias_monto: retGanancias,
            total_calculado: totalNeto + totalIva + percIva + percIibb + retGanancias,
            foto_url: publicUrl || signedUrl,
            estado: 'pendiente_recepcion',
            ajusta_stock: true,
            descuento_fuera_factura: descGlobal,
        })
        .select()
        .single();

    if (compError) {
        console.error('[Docs OC] Error creando comprobante:', compError.message);
    }

    // Matching de artículos OCR → comprobantes_compra_detalle + actualizar recepciones_items
    const detalleCreado: any[] = [];
    if (ocrResult.items.length > 0 && comprobante) {
        const { matchAndCreateDetalle } = await import('./detalle');
        const matches = await matchAndCreateDetalle(supabase, {
            comprobante_id: comprobante.id,
            recepcion_id: recepcion.id,
            proveedor_id: oc.proveedor_id,
            items: ocrResult.items,
        });
        detalleCreado.push(...matches);
    }

    return NextResponse.json({
        success: true,
        documento: { ...doc, signed_url: signedUrl || publicUrl },
        comprobante,
        recepcion_id: recepcion.id,
        ocr: {
            comprobante: compMeta,
            items_detectados: ocrResult.items.length,
            items_vinculados: detalleCreado.length,
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
        .select('id, storage_path, recepcion_id')
        .eq('id', documento_id)
        .single();

    if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    if (doc.storage_path) {
        await supabase.storage.from('comprobantes').remove([doc.storage_path]);
    }

    await supabase.from('recepciones_documentos').delete().eq('id', documento_id);

    return NextResponse.json({ success: true });
}

