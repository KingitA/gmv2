import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from "next/server";
import { processWithGemini } from "@/lib/services/ocr";
import { resolveFactorConversion, UnidadFactura } from "@/lib/services/conversion";
import { MatchingEngine } from "@/lib/matching/matcher";
import { ImportItemRaw } from "@/lib/matching/types";
import { requireAuth } from '@/lib/auth'
import { todayArgentina } from '@/lib/utils'
import { matchAndCreateDetalle, revertirComprobanteOCR } from '@/lib/services/detalle'

function mapTipoComprobante(ocr: string | null | undefined, tipoDocumento: string): string {
    if (!ocr) {
        const map: Record<string, string> = { factura: 'FA', remito: 'Adquisicion', adquisicion: 'Adquisicion', nota_credito: 'NC' };
        return map[tipoDocumento] || 'FA';
    }
    const s = ocr.toUpperCase().trim();
    if (s === 'FA' || s.includes('FACTURA A')) return 'FA';
    if (s === 'FB' || s.includes('FACTURA B')) return 'FB';
    if (s === 'FC' || s.includes('FACTURA C')) return 'FC';
    if (s.includes('REMITO') || s.includes('ADQUIS')) return 'Adquisicion';
    if (s === 'NC' || s.includes('NOTA DE CR') || s === 'ND' || s.includes('NOTA DE D')) return 'NC';
    return 'FA';
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: recepcion_id } = await params;
        const formData = await request.formData();
        const file = formData.get("file") as File;
        const tipo_documento = formData.get("tipo_documento") as string;

        if (!file || !tipo_documento) {
            return NextResponse.json(
                { error: "File and tipo_documento are required" },
                { status: 400 }
            );
        }

        const supabase = createAdminClient();

        // Fetch recepcion (no FK joins — query separately)
        const { data: recepcion } = await supabase
            .from("recepciones")
            .select("id, orden_compra_id, proveedor_id")
            .eq("id", recepcion_id)
            .maybeSingle();

        let proveedorNombre: string | undefined;
        let proveedorId = recepcion?.proveedor_id;
        let ordenCompraId = recepcion?.orden_compra_id;

        // Las recepciones creadas desde depósito no guardan proveedor_id:
        // tomarlo de la OC (y persistirlo) para que el comprobante se auto-cree.
        if (!proveedorId && ordenCompraId) {
            const { data: oc } = await supabase
                .from("ordenes_compra")
                .select("proveedor_id")
                .eq("id", ordenCompraId)
                .maybeSingle();
            if (oc?.proveedor_id) {
                proveedorId = oc.proveedor_id;
                await supabase.from("recepciones").update({ proveedor_id: proveedorId }).eq("id", recepcion_id);
            }
        }

        if (proveedorId) {
            const { data: prv } = await supabase.from("proveedores").select("nombre").eq("id", proveedorId).maybeSingle();
            proveedorNombre = prv?.nombre || undefined;
        }

        // 1. Upload image to Storage
        const fileExt = file.name.split(".").pop();
        const fileName = `${recepcion_id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
            .from("comprobantes")
            .upload(fileName, file);

        if (uploadError) {
            console.warn("Storage upload failed:", uploadError.message);
        }

        let fileUrl = '';
        if (!uploadError) {
            const { data: signed } = await supabase.storage.from("comprobantes").createSignedUrl(fileName, 3600 * 24 * 7);
            fileUrl = signed?.signedUrl || '';
        }

        // 2. Perform OCR with Gemini AI
        const ocrResult = await processWithGemini(file, { proveedorNombre, tipoDocumento: tipo_documento });

        // 3. Save document record
        const { data: doc, error: docError } = await supabase
            .from("recepciones_documentos")
            .insert({
                recepcion_id,
                tipo_documento,
                url_imagen: fileUrl,
                storage_path: uploadError ? null : fileName,
                nombre_archivo: file.name,
                tipo_mime: file.type,
                datos_ocr: ocrResult,
                procesado: true,
            })
            .select()
            .single();

        if (docError) throw docError;

        // 4. Auto-create comprobante_compra when linked to an orden_compra
        let comprobante = null;
        if (ordenCompraId && proveedorId) {
            const compMeta = ocrResult.comprobante;
            const numeroExtraido = compMeta?.numero_comprobante;

            // Duplicate check
            let skipCreate = false;
            if (numeroExtraido) {
                const { data: dup } = await supabase
                    .from('comprobantes_compra')
                    .select('id')
                    .eq('orden_compra_id', ordenCompraId)
                    .eq('numero_comprobante', numeroExtraido)
                    .maybeSingle();
                if (dup) skipCreate = true;
            }

            if (!skipCreate) {
                const tipoComp = mapTipoComprobante(compMeta?.tipo_comprobante, tipo_documento);
                const totalFactura = compMeta?.total_factura || 0;
                const totalNeto = compMeta?.subtotal_neto || (totalFactura > 0 ? totalFactura / 1.21 : 0);
                const totalIva = compMeta?.total_iva || (totalNeto > 0 && totalFactura > 0 ? totalFactura - totalNeto : 0);

                const { data: comp } = await supabase.from('comprobantes_compra').insert({
                    orden_compra_id: ordenCompraId,
                    proveedor_id: proveedorId,
                    tipo_comprobante: tipoComp,
                    numero_comprobante: numeroExtraido || `PENDIENTE-${Date.now()}`,
                    fecha_comprobante: compMeta?.fecha || todayArgentina(),
                    total_factura_declarado: totalFactura,
                    total_neto: totalNeto,
                    total_iva: totalIva,
                    percepcion_iva_monto: compMeta?.percepcion_iva || 0,
                    percepcion_iibb_monto: compMeta?.percepcion_iibb || 0,
                    retencion_ganancias_monto: compMeta?.retencion_ganancias || 0,
                    total_calculado: totalNeto + totalIva + (compMeta?.percepcion_iva || 0) + (compMeta?.percepcion_iibb || 0) + (compMeta?.retencion_ganancias || 0),
                    foto_url: fileUrl,
                    estado: 'pendiente_recepcion',
                    ajusta_stock: true,
                    descuento_fuera_factura: compMeta?.descuento_global || 0,
                }).select().single();
                comprobante = comp;

                // Vincular documento → comprobante (permite revertir al eliminar el doc)
                if (comp) {
                    await supabase.from('recepciones_documentos')
                        .update({ comprobante_id: comp.id })
                        .eq('id', doc.id);
                }
            }
        }

        // 5. Create comprobante_compra_detalle from OCR items (even unmatched, to show in verificacion).
        // matchAndCreateDetalle también actualiza recepciones_items (cantidades/precios documentados),
        // así que processOCRData solo corre cuando NO se creó comprobante — correr ambos duplicaba
        // cantidad_documentada.
        let processingResults: any[] = [];
        if (comprobante && ocrResult.items.length > 0 && proveedorId) {
            await matchAndCreateDetalle(supabase, {
                comprobante_id: comprobante.id,
                recepcion_id,
                proveedor_id: proveedorId,
                items: ocrResult.items,
                documento_id: doc.id,
            });
        } else if (!comprobante && ocrResult.items.length > 0) {
            // 6. Sin comprobante (recepción sin OC vinculada) — actualizar items directo.
            // Si el comprobante ya existía (duplicado), no reprocesar: ya se contó.
            const yaExistia = ordenCompraId && ocrResult.comprobante?.numero_comprobante;
            if (!yaExistia) {
                processingResults = await processOCRData(supabase, recepcion_id, ocrResult);
            }
        }

        return NextResponse.json({
            success: true,
            document: doc,
            comprobante,
            ocr_processing_results: processingResults
        });

    } catch (error: any) {
        console.error("Error processing OCR:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}


async function processOCRData(supabase: any, recepcion_id: string, ocrData: any) {
    if (!ocrData.items || ocrData.items.length === 0) return [];

    // 1. Fetch current items
    const { data: currentItems } = await supabase
        .from("recepciones_items")
        .select(`
            *,
            articulo:articulos(id, descripcion, sku, rubro, categoria, unidades_por_bulto, precio_compra)
        `)
        .eq("recepcion_id", recepcion_id);

    if (!currentItems) return [];

    // 2. Get provider
    const { data: recepcion } = await supabase.from("recepciones").select("proveedor_id, orden_compra:ordenes_compra(proveedor_id)").eq("id", recepcion_id).single();
    const proveedorId = recepcion?.proveedor_id || (recepcion?.orden_compra as any)?.proveedor_id;
    if (!proveedorId) return [];

    if (!recepcion.proveedor_id && proveedorId) {
        await supabase.from("recepciones").update({ proveedor_id: proveedorId }).eq("id", recepcion_id);
    }

    const { data: proveedor } = await supabase.from("proveedores").select("*").eq("id", proveedorId).single();

    // 3. Use Shared Matching Service (New Engine)
    const engine = new MatchingEngine();
    const matchedItems = [];

    for (const item of ocrData.items) {
        // Construct raw item
        const rawItem: ImportItemRaw = {
            description: item.descripcion || item.descripcion_ocr,
            code: item.codigo,
            ean: item.ean,
            price: item.precio_unitario,
            ...item
        };

        const matchResult = await engine.resolveItem(rawItem, proveedorId);

        matchedItems.push({
            ...item,
            match_result: {
                status: matchResult.status === 'matched' ? 'found' : 'pending',
                articulo_id: matchResult.bestCandidate?.sku_id,
                match_type: matchResult.bestCandidate?.method,
                mapping_id: null,
                confidence: matchResult.bestCandidate?.score
            }
        });
    }

    const results = [];

    for (const item of matchedItems) {
        const { match_result } = item;

        if (match_result.status === "found" && match_result.articulo_id) {
            const matchedItem = currentItems.find((ci: any) => ci.articulo_id === match_result.articulo_id);

            if (matchedItem) {
                const articulo = matchedItem.articulo;

                let apMapping = null;
                if (match_result.mapping_id) {
                    const { data } = await supabase.from("articulos_proveedores").select("*").eq("id", match_result.mapping_id).single();
                    apMapping = data;
                }

                const conversion = resolveFactorConversion({
                    proveedorDefaultUnidad: proveedor?.default_unidad_factura as UnidadFactura,
                    articuloUnidadesPorBulto: articulo?.unidades_por_bulto,
                    apUnidadFactura: apMapping?.unidad_factura as UnidadFactura,
                    apFactorConversion: apMapping?.factor_conversion,
                    descripcionOcr: item.descripcion || item.descripcion_ocr,
                    ocrUnidadMedida: item.unidad_medida,
                    precioDocumento: item.precio_unitario,
                    costoBaseArticulo: articulo?.precio_compra
                });

                const cantidadBase = (item.cantidad || 0) * conversion.factor;

                if (conversion.requiresReview) {
                    await logConversionWarning(supabase, {
                        recepcion_id,
                        descripcion_ocr: item.descripcion || "",
                        cantidad_ocr: item.cantidad,
                        warningType: conversion.warningType || "",
                        warningMessage: conversion.warningMessage || "",
                        conversionAttempted: conversion
                    });
                }

                await supabase
                    .from("recepciones_items")
                    .update({
                        cantidad_documentada: Number(matchedItem.cantidad_documentada || 0) + cantidadBase,
                        precio_documentado: item.precio_unitario || 0,
                        precio_real: item.precio_unitario || matchedItem.precio_oc || 0,
                        cantidad_base: cantidadBase,
                        factor_conversion: conversion.factor,
                        conversion_source: conversion.source,
                        requires_review: conversion.requiresReview
                    })
                    .eq("id", matchedItem.id);

                if ((match_result.match_type === "vector" || match_result.match_type === "exact_code") && match_result.mapping_id) {
                    await supabase.rpc('increment_mapping_usage', { mapping_id: match_result.mapping_id });
                }
            }
        }
        results.push(item);
    }

    return results;
}

async function logConversionWarning(
    supabase: any,
    params: {
        recepcion_id: string;
        documento_id?: string;
        proveedor_id?: string;
        articulo_id?: string;
        descripcion_ocr: string;
        cantidad_ocr: number;
        warningType: string;
        warningMessage: string;
        conversionAttempted: any;
    }
) {
    try {
        await supabase.from("ocr_conversion_warnings").insert({
            recepcion_id: params.recepcion_id,
            documento_id: params.documento_id,
            proveedor_id: params.proveedor_id,
            articulo_id: params.articulo_id,
            descripcion_ocr: params.descripcion_ocr,
            cantidad_ocr: params.cantidad_ocr,
            warning_type: params.warningType,
            warning_message: params.warningMessage,
            conversion_attempted: params.conversionAttempted
        });
    } catch (error) {
        console.error("[OCR CONVERSION] Error logging warning:", error);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const { document_id } = body;

        if (!document_id) {
            return NextResponse.json(
                { error: "Document ID is required" },
                { status: 400 }
            );
        }

        const supabase = createAdminClient();

        const { data: doc, error: fetchError } = await supabase
            .from("recepciones_documentos")
            .select("*")
            .eq("id", document_id)
            .single();

        if (fetchError || !doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        // Delete from Storage if storage_path is known
        const storagePath = doc.storage_path;
        if (!storagePath && doc.url_imagen) {
            // Try to infer path from URL: extract everything after /comprobantes/
            const match = doc.url_imagen.match(/\/comprobantes\/(.+)$/);
            if (match) {
                await supabase.storage.from("comprobantes").remove([match[1]]);
            }
        } else if (storagePath) {
            await supabase.storage.from("comprobantes").remove([storagePath]);
        }

        if (doc.comprobante_id) {
            const { error: revertError } = await revertirComprobanteOCR(supabase, doc.comprobante_id);
            if (revertError) {
                return NextResponse.json({ error: revertError }, { status: 409 });
            }
        }

        const { error: deleteError } = await supabase
            .from("recepciones_documentos")
            .delete()
            .eq("id", document_id);

        if (deleteError) throw deleteError;

        const { count } = await supabase
            .from("recepciones_documentos")
            .select("*", { count: 'exact', head: true })
            .eq("recepcion_id", recepcion_id);

        if (count === 0) {
            await supabase
                .from("recepciones_items")
                .update({
                    cantidad_documentada: 0,
                    precio_documentado: 0,
                    precio_real: 0
                })
                .eq("recepcion_id", recepcion_id);
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Error deleting document:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
