import { createAdminClient } from '@/lib/supabase/admin';
import { sumarDocumentado } from '@/lib/compras/documentado'
import { NextRequest, NextResponse } from "next/server";
import { processWithGemini, inferirTipoComprobante } from "@/lib/services/ocr";
import { resolveFactorConversion, UnidadFactura } from "@/lib/services/conversion";
import { MatchingEngine } from "@/lib/matching/matcher";
import { ImportItemRaw } from "@/lib/matching/types";
import { requireAuth } from '@/lib/auth'
import { revertirComprobanteOCR } from '@/lib/services/detalle'
import { buscarComprobanteDuplicado, comprobanteDesdeOCR, datosNoLeido, mensajeDuplicado, motivoNoLeido } from '@/lib/services/documento-compra'


// POST /api/recepciones/[id]/ocr — foto de remito/factura desde depósito (web y app).
// Respuesta: { success, document, comprobante, ocr_processing_results, no_leido?, aviso? }
//   · no_leido: la IA falló o no encontró renglones ⇒ la foto queda adjunta, SIN marcar
//     como procesada y sin crear comprobante (E-37). `aviso` dice qué pasó.
//   · 409 codigo=comprobante_duplicado: esa factura del proveedor ya está cargada (E-36).
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
        const noLeido = motivoNoLeido(ocrResult);

        // 3. E-36: ¿esa factura del proveedor ya está cargada (en esta orden o en otra)?
        //    Se avisa y no se guarda nada (antes se salteaba en silencio y la foto quedaba como procesada).
        if (!noLeido && ordenCompraId && proveedorId && ocrResult.comprobante?.numero_comprobante) {
            const dup = await buscarComprobanteDuplicado(supabase, {
                proveedor_id: proveedorId,
                tipo: inferirTipoComprobante(ocrResult, tipo_documento),
                numero: ocrResult.comprobante.numero_comprobante,
            });
            if (dup) {
                if (!uploadError) await supabase.storage.from("comprobantes").remove([fileName]);
                return NextResponse.json(
                    { error: mensajeDuplicado(dup, ordenCompraId), codigo: 'comprobante_duplicado', comprobante_id: dup.id },
                    { status: 409 }
                );
            }
        }

        // 4. Save document record. E-37: si no se pudo leer, queda adjunto como "no leído"
        //    (procesado = false, con el motivo) y NO se crea ningún comprobante.
        const { data: doc, error: docError } = await supabase
            .from("recepciones_documentos")
            .insert({
                recepcion_id,
                tipo_documento,
                url_imagen: fileUrl,
                storage_path: uploadError ? null : fileName,
                nombre_archivo: file.name,
                tipo_mime: file.type,
                datos_ocr: noLeido ? datosNoLeido(ocrResult, noLeido) : ocrResult,
                procesado: !noLeido,
            })
            .select()
            .single();

        if (docError) throw docError;

        if (noLeido) {
            return NextResponse.json({
                success: true,
                document: doc,
                comprobante: null,
                ocr_processing_results: [],
                no_leido: true,
                aviso: "No se pudo leer la foto. Quedó adjunta pero NO generó comprobante: sacala de nuevo (derecha, con luz, el papel entero) o avisá a la oficina para que lo cargue a mano.",
                motivo: noLeido,
            });
        }

        // 5. Comprobante de compra + detalle cuando la recepción es de una OC
        //    (sin número legible: se suma al comprobante provisorio de la orden, no se crea otro).
        let comprobante = null;
        let aviso: string | undefined;
        let processingResults: any[] = [];
        if (ordenCompraId && proveedorId) {
            const r = await comprobanteDesdeOCR(supabase, {
                orden_compra_id: ordenCompraId,
                proveedor_id: proveedorId,
                recepcion_id,
                documento_id: doc.id,
                ocr: ocrResult,
                tipo_documento,
                foto_url: fileUrl,
            });
            comprobante = r.comprobante;
            if (r.error) aviso = `La foto se leyó pero no se pudo crear el comprobante (${r.error}). Avisá a la oficina.`;
            else if (r.sumado_a_provisorio) aviso = 'No se leyó el número del comprobante: los renglones se sumaron al comprobante provisorio de esta orden. La oficina tiene que completarle el número.';
            else if (r.otro_provisorio) aviso = 'No se leyó el número del comprobante y ya había otro sin número en esta orden con otro total o fecha: se cargó como un comprobante aparte. La oficina tiene que completarles el número.';
            else if (!ocrResult.comprobante?.numero_comprobante) aviso = 'No se leyó el número del comprobante: quedó como provisorio. La oficina tiene que completarle el número.';
            // Renglones juntados, que faltan o que no se pudieron guardar: siempre a la vista
            if (r.avisos?.length) aviso = [aviso, ...r.avisos].filter(Boolean).join(' ');
        } else {
            // 6. Sin comprobante (recepción sin OC vinculada) — actualizar items directo.
            processingResults = await processOCRData(supabase, recepcion_id, ocrResult);
        }

        return NextResponse.json({
            success: true,
            document: doc,
            comprobante,
            ocr_processing_results: processingResults,
            ...(aviso ? { aviso } : {}),
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

        // contexto de compra (sin orden): el código exacto y los artículos del proveedor primero
        const matchResult = await engine.resolveItem(rawItem, proveedorId, proveedorId ? {} : null);

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

                // la suma la hace la base en un solo paso: dos fotos leídas a la vez suman las dos
                await sumarDocumentado(supabase, matchedItem.id, cantidadBase, {
                    precio_documentado: item.precio_unitario || 0,
                    precio_real: item.precio_unitario || matchedItem.precio_oc || 0,
                    cantidad_base: cantidadBase,
                    factor_conversion: conversion.factor,
                    conversion_source: conversion.source,
                    requires_review: conversion.requiresReview,
                });

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
        // Documento de varias hojas (app Depósito, E-38): se borran todas, no solo la primera
        const otrasHojas: string[] = (Array.isArray(doc.hojas) ? doc.hojas : [])
            .map((h: any) => h?.path).filter((p: any) => typeof p === 'string' && p && p !== storagePath);
        if (otrasHojas.length > 0) await supabase.storage.from("comprobantes").remove(otrasHojas);

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

        // E-41. Antes: al borrar el ÚLTIMO documento se ponía en 0 lo documentado de TODA la
        // recepción, también lo cargado a mano en la oficina (renglones agregados a un
        // comprobante, matches confirmados) y lo de comprobantes sin foto.
        // Ahora: lo que aplicó un documento con comprobante ya lo revirtió revertirComprobanteOCR
        // (renglón por renglón). Solo queda el caso viejo de un documento SIN comprobante
        // (recepción sin OC: el OCR sumó directo a los ítems): si era el último documento, se
        // limpian únicamente los ítems que NO tienen ningún renglón de comprobante que los respalde.
        if (!doc.comprobante_id) {
            const { count } = await supabase
                .from("recepciones_documentos")
                .select("*", { count: 'exact', head: true })
                .eq("recepcion_id", recepcion_id);

            if (count === 0) {
                const { data: items } = await supabase
                    .from("recepciones_items")
                    .select("id")
                    .eq("recepcion_id", recepcion_id);
                const ids: string[] = (items || []).map((i: any) => i.id);
                const respaldados = new Set<string>();
                for (let i = 0; i < ids.length; i += 200) {
                    const { data: det, error: detErr } = await supabase
                        .from("comprobantes_compra_detalle")
                        .select("recepcion_item_id")
                        .in("recepcion_item_id", ids.slice(i, i + 200));
                    if (detErr) throw detErr; // ante la duda no se borra nada
                    for (const d of det || []) if (d.recepcion_item_id) respaldados.add(d.recepcion_item_id);
                }
                const aLimpiar = ids.filter((id) => !respaldados.has(id));
                for (let i = 0; i < aLimpiar.length; i += 200) {
                    await supabase
                        .from("recepciones_items")
                        .update({ cantidad_documentada: 0, precio_documentado: 0, precio_real: 0 })
                        .in("id", aLimpiar.slice(i, i + 200));
                }
            }
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
