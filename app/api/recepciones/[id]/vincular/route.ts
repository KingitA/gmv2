
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const {
            item_ocr,
            articulo_id,
            descripcion_proveedor,
            codigo_proveedor,
            cantidad_a_sumar // We pass this to immediately update counts
        } = body;

        // Helper to normalize text for consistent matching
        const normalizeText = (text: string | null | undefined): string => {
            if (!text) return "";
            return text
                .toLowerCase()
                .trim()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                .replace(/[\/\.\-\,]/g, " ") // Replace /, . , - and , with spaces to separate tokens
                .replace(/[^a-z0-9\s]/g, "") // Remove other non-alphanumeric
                .replace(/\s+/g, " "); // Collapse multiple spaces
        };

        // Robust number parsing from strings (handles commas, currency and extra text)
        const safeParseNumber = (val: any): number => {
            if (typeof val === 'number') return isNaN(val) ? 0 : val;
            if (!val || typeof val !== 'string') return 0;
            const cleaned = val.replace(',', '.').replace(/[^0-9\.\-]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? 0 : num;
        };

        if (!articulo_id || !descripcion_proveedor) {
            return NextResponse.json(
                { error: "articulo_id and descripcion_proveedor are required" },
                { status: 400 }
            );
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
            }
        );

        // Helper for quantity conversion
        // (Replicated from ocr/route.ts for consistency)
        const resolveFactorConversion = (params: any) => {
            const { proveedorDefaultUnidad, articuloUnidadesPorBulto, apUnidadFactura, apFactorConversion, precioDocumento, costoBaseArticulo, descripcionOcr, ocrUnidadMedida } = params;

            // (1) HIGHEST PRIORITY: Explicit manual factor_conversion override
            if (apFactorConversion && apFactorConversion > 0) return { factor: apFactorConversion };

            // (2) PRIORITY 1: Explicit Document Labels (Unit of Measure)
            if (ocrUnidadMedida || descripcionOcr) {
                const textToAnalyze = normalizeText(`${ocrUnidadMedida || ''} ${descripcionOcr || ''}`);

                // Check for Unit markers
                const unitMarkers = ["unidad", "unidades", "uni", "u", "un"];
                const hasUnitMarker = unitMarkers.some(m =>
                    textToAnalyze === m ||
                    textToAnalyze.split(' ').includes(m) ||
                    (m.length > 2 && textToAnalyze.includes(m))
                );

                if (hasUnitMarker) return { factor: 1 };

                // Check for Bulto markers (Expanded)
                const bultoMarkers = [
                    "bulto", "bultos", "caja", "cajas", "pack", "packs",
                    "paquete", "paquetes", "bto", "btos", "cja", "cjas", "pk"
                ];
                const hasBultoMarker = bultoMarkers.some(m =>
                    textToAnalyze.split(' ').includes(m) ||
                    (m.length >= 3 && textToAnalyze.includes(m))
                );

                if (hasBultoMarker && articuloUnidadesPorBulto && articuloUnidadesPorBulto > 0) {
                    return { factor: articuloUnidadesPorBulto };
                }
            }

            // (3) PRIORITY 2: Price-based Coherence (Smart Heuristic)
            if (precioDocumento && costoBaseArticulo && articuloUnidadesPorBulto > 1) {
                const costPerPack = costoBaseArticulo * articuloUnidadesPorBulto;
                if (Math.abs(precioDocumento / costPerPack - 1) < 0.20) return { factor: articuloUnidadesPorBulto };
                if (Math.abs(precioDocumento / costoBaseArticulo - 1) < 0.20) return { factor: 1 };
            }

            // (4) FALLBACK: Provider Default
            const unidad = apUnidadFactura || proveedorDefaultUnidad || "UNIDAD";
            if (unidad === "UNIDAD") return { factor: 1 };
            if (articuloUnidadesPorBulto && articuloUnidadesPorBulto > 0) return { factor: articuloUnidadesPorBulto };

            return { factor: 1 };
        };

        // 1. Get Reception and Article details
        const { data: recepcion } = await supabase
            .from("recepciones")
            .select(`
                proveedor_id,
                orden_compra:ordenes_compra(proveedor_id)
            `)
            .eq("id", recepcion_id)
            .single();

        const rec = recepcion as any;
        const proveedorId = rec?.proveedor_id || (Array.isArray(rec?.orden_compra) ? rec.orden_compra[0]?.proveedor_id : rec?.orden_compra?.proveedor_id);

        if (!proveedorId) {
            return NextResponse.json({ error: "Proveedor not found for this reception" }, { status: 404 });
        }

        const { data: articulo } = await supabase
            .from("articulos")
            .select("precio_compra, unidades_por_bulto")
            .eq("id", articulo_id)
            .single();

        const { data: mapping } = await supabase
            .from("articulos_proveedores")
            .select("unidad_factura, factor_conversion")
            .eq("proveedor_id", proveedorId)
            .eq("articulo_id", articulo_id)
            .single();

        const { data: proveedor } = await supabase
            .from("proveedores")
            .select("default_unidad_factura")
            .eq("id", proveedorId)
            .single();

        // Calculate normalized quantity
        const conversion = resolveFactorConversion({
            proveedorDefaultUnidad: proveedor?.default_unidad_factura,
            articuloUnidadesPorBulto: articulo?.unidades_por_bulto,
            apUnidadFactura: mapping?.unidad_factura,
            apFactorConversion: mapping?.factor_conversion,
            precioDocumento: body.precio_unitario || 0,
            costoBaseArticulo: articulo?.precio_compra || 0,
            descripcionOcr: body.descripcion_proveedor,
            ocrUnidadMedida: null // Can be added to body if needed
        });

        const cantidadReal = safeParseNumber(cantidad_a_sumar) * conversion.factor;

        // 2. Save/Update Alias (Vinculacion)
        const normalizedDesc = normalizeText(descripcion_proveedor);

        const { data: existingAlias } = await supabase
            .from("articulos_proveedores")
            .select("id, veces_usado")
            .eq("proveedor_id", proveedorId)
            .eq("descripcion_proveedor_norm", normalizedDesc)
            .single();

        // Derive derived unit for alias learning
        const derivedUnit = conversion.factor > 1 ? "BULTO" : "UNIDAD";

        if (existingAlias) {
            console.log(`[VINCULAR] Updating existing alias ${existingAlias.id} with unit ${derivedUnit}`);
            await supabase.from("articulos_proveedores").update({
                articulo_id,
                codigo_proveedor: codigo_proveedor || null,
                descripcion_proveedor,
                descripcion_proveedor_norm: normalizedDesc, // Update norm desc in case it changed
                unidad_factura: derivedUnit,
                factor_conversion: conversion.factor,
                veces_usado: (existingAlias.veces_usado || 0) + 1,
                last_used_at: new Date()
            }).eq("id", existingAlias.id);
        } else {
            console.log(`[VINCULAR] Creating new alias for provider ${proveedorId} with unit ${derivedUnit}`);
            await supabase.from("articulos_proveedores").insert({
                proveedor_id: proveedorId,
                articulo_id,
                descripcion_proveedor,
                descripcion_proveedor_norm: normalizedDesc,
                codigo_proveedor,
                unidad_factura: derivedUnit,
                factor_conversion: conversion.factor,
                veces_usado: 1
            });
        }

        // 3. Update Reception Item
        const { data: item } = await supabase
            .from("recepciones_items")
            .select("id, cantidad_documentada")
            .eq("recepcion_id", recepcion_id)
            .eq("articulo_id", articulo_id)
            .single();

        if (item) {
            const currentDocQty = safeParseNumber(item.cantidad_documentada);
            await supabase.from("recepciones_items").update({
                cantidad_documentada: currentDocQty + cantidadReal,
                precio_documentado: body.precio_unitario || 0
            }).eq("id", item.id);
        } else {
            await supabase.from("recepciones_items").insert({
                recepcion_id,
                articulo_id,
                cantidad_oc: 0,
                cantidad_fisica: 0,
                cantidad_documentada: cantidadReal,
                precio_documentado: body.precio_unitario || 0
            });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Error linking article:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
