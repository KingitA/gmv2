import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { processWithGemini, parseExcel } from "@/lib/services/ocr";
import { matchItems } from "@/lib/services/matching";
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;
        const proveedorId = formData.get("proveedorId") as string;

        // Optional context for OCR
        const proveedorNombre = formData.get("proveedorNombre") as string;

        if (!file) {
            return NextResponse.json({ error: "File is required" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: { persistSession: false, autoRefreshToken: false },
            }
        );

        let items: any[] = [];
        let metadata = {};

        // 1. Parse File (Excel or Image)
        if (file.type.includes("image") || file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
            // OCR Route
            const context = {
                proveedorNombre: proveedorNombre,
                tipoDocumento: "Pedido/Orden" // Default
            };
            const result = await processWithGemini(file, context);
            items = result.items;
            metadata = { ...result.metadata, type: 'ocr', raw_text: result.raw_text };

        } else if (file.type.includes("sheet") || file.type.includes("excel") || file.name.match(/\.(xlsx|xls|csv)$/i)) {
            // Excel Route
            const result = await parseExcel(file);
            items = result.items;
            metadata = { ...result.metadata, type: 'excel' };

        } else {
            return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
        }

        // 2. Match Items against Catalog
        // We always try to match against the selected provider if available.
        // If no provider selected yet (optional flow), we might verify generic mapping later?
        // Current requirement: "Usuario selecciona archivo + Proveedor" -> So providerId is likely present.

        let matchedItems: any[] = [];
        if (proveedorId) {
            const matchResult = await matchItems(supabase, items, proveedorId);
            matchedItems = matchResult.items;
        } else {
            // No provider? Just return extracted text?
            // Or maybe try to match globally? (Not implemented safely yet)
            // For now return items without match info or empty match info
            matchedItems = items.map(i => ({
                ...i,
                match_result: { status: "not_found", match_type: "NONE" }
            }));
        }

        // 3. Format Response for UI
        const found = matchedItems.filter(i => i.match_result.status === "found");
        const suggested = matchedItems.filter(i => i.match_result.status === "suggested");
        const notFound = matchedItems.filter(i => i.match_result.status === "not_found");

        // Format for the UI "autofill" feature
        // We want to return a flat list that the UI can use to populate the table.
        // The UI needs: { articulo_id, cantidad, precio_unitario, descuento... }

        const uiMappedItems = matchedItems.map(item => {
            const match = item.match_result;
            const articulo = match.articulo || {};

            return {
                original_desc: item.descripcion,
                original_code: item.codigo,

                // Matched data
                articulo_id: match.articulo_id,
                articulo_desc: articulo.descripcion,
                articulo_sku: articulo.sku,

                // Values for Input
                cantidad_pedida: item.cantidad || 0,
                // If excel has price, use it. Else use current buy price.
                precio_unitario: item.precio_unitario || articulo.precio_compra || 0,
                // Descuento logic:
                // If excel has one discount, map it to descuento1? 
                // Or if DB has discounts, keep them? 
                // Plan said: "precios y descuentos ... Cargados si el archivo los trae."
                // So if file has discount, it overrides? Or applies to d1?
                // Let's assume file discount -> d1.
                descuento1: item.descuento || articulo.descuento1 || 0,
                descuento2: articulo.descuento2 || 0,
                descuento3: articulo.descuento3 || 0,
                descuento4: articulo.descuento4 || 0,

                status: match.status, // found, suggested, not_found
                match_confidence: match.score
            };
        });

        return NextResponse.json({
            success: true,
            stats: {
                total: items.length,
                found: found.length + suggested.length,
                not_found: notFound.length
            },
            items: uiMappedItems,
            metadata: metadata
        });

    } catch (error: any) {
        console.error("Import Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
