import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from "next/server";
import { processWithGemini, parseExcel } from "@/lib/services/ocr";
import { matchItems } from "@/lib/services/matching";
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error
        const formData = await request.formData();
        const file = formData.get("file") as File;
        let proveedorId = formData.get("proveedorId") as string;

        // Optional context for OCR
        const contextProviderName = formData.get("proveedorNombre") as string;

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
        let metadata: any = {};

        // --- 1. PARSE FILE ---
        if (file.type.includes("image") || file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
            // OCR Route
            const context = {
                proveedorNombre: contextProviderName,
                tipoDocumento: "Lista de Precios"
            };
            const result = await processWithGemini(file, context);
            items = result.items;
            metadata = { ...result.metadata, type: 'ocr', raw_text: result.raw_text || "" };

        } else if (file.type.includes("sheet") || file.type.includes("excel") || file.name.match(/\.(xlsx|xls|csv)$/i)) {
            // Excel Route
            const result = await parseExcel(file);
            items = result.items;
            metadata = { ...result.metadata, type: 'excel' };

        } else {
            return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
        }

        // --- 2. AUTO-DETECT PROVIDER (If not provided) ---
        let detectedProviderName = null;
        if (!proveedorId) {
            // Fetch all providers to match against
            const { data: proveedores } = await supabase
                .from("proveedores")
                .select("id, nombre")
                .eq("activo", true);

            if (proveedores) {
                const searchText = (metadata.raw_text || file.name)
                    .toLowerCase()
                    .replace(/[-_]/g, " "); // Normalize separators

                // 1. Strict Match (Full Name)
                let match = proveedores.find(p => searchText.includes(p.nombre.toLowerCase()));

                // 2. Partial Match (First meaningful word)
                // Useful for "Lenterdit SA" vs "Lenterdit..."
                if (!match) {
                    match = proveedores.find(p => {
                        const firstWord = p.nombre.split(" ")[0].toLowerCase();
                        return firstWord.length > 3 && searchText.includes(firstWord);
                    });
                }

                if (match) {
                    proveedorId = match.id;
                    detectedProviderName = match.nombre;
                }
            }
        }

        // --- 3. MATCH ITEMS ---
        // If we still don't have a providerId, we can't match accurately against specific provider codes.
        // But we can try to match description-only or return "unmatched" items for user to select provider.

        let matchedItems = [];
        let unmatchedDbArticles: any[] = [];

        if (proveedorId) {
            const result = await matchItems(supabase, items, proveedorId);
            matchedItems = result.items;
            unmatchedDbArticles = result.unmatchedDbArticles;
        } else {
            // Return items but indicate provider is missing
            matchedItems = items.map(i => ({
                ...i,
                match_result: { status: "not_found", match_type: "MISSING_PROVIDER" }
            }));
        }

        // --- 4. FORMAT RESPONSE FOR PRICE UI ---
        // UI needs: Original Item, Matched Article, Old Price, New Price, Variation

        const uiMappedItems = matchedItems.map(item => {
            const match = item.match_result;
            const articulo = match.articulo || {};

            // Internal Data
            const oldPrice = articulo.precio_compra || 0;
            const unitsPerPack = item.unidades_por_bulto || articulo.unidades_por_bulto || 1;

            // --- SMART PRICE DETECTION ---
            let newPrice = item.precio_unitario;

            // 1. Explicit Bundle Price
            if (!newPrice && item.precio_bulto) {
                if (unitsPerPack > 1) {
                    newPrice = item.precio_bulto / unitsPerPack;
                } else {
                    newPrice = item.precio_bulto;
                }
            }

            // 2. Fallback / Interpretation
            // If we have a price (either explicit unit or just "price"), check if it looks like a bundle price
            // compare to the old price * units
            if (!newPrice && item.precio_unitario === null && item.precio_bulto === null) {
                // Should not happen if parsing worked, but let's handle "defaults"
                // If item.precio_unitario was 0, newPrice is 0. 
            }

            // If we still just have a number in "precio_unitario" (default mapping) but it's HUGE
            if (newPrice && oldPrice > 0) {
                let suspectedUnits = unitsPerPack;

                // A. Try to infer units from description if not known
                if (suspectedUnits === 1 && item.original_desc) {
                    // Look for patterns like "x 12", "c/6", "pack 24"
                    const desc = item.original_desc.toLowerCase();
                    const packMatch = desc.match(/\b(x|c\/|pack|caja|bulto)\s*(\d+)\b/);
                    if (packMatch && packMatch[2]) {
                        const val = parseInt(packMatch[2], 10);
                        if (val > 1 && val < 500) { // Sane limits
                            suspectedUnits = val;
                        }
                    }
                }

                // B. If still 1, try Price Ratio heuristic for common pack sizes
                if (suspectedUnits === 1) {
                    const ratio = newPrice / oldPrice;
                    const commonPacks = [6, 10, 12, 20, 24, 25, 50, 60, 100];
                    // Find if ratio is close to any common pack (e.g. +/- 20%)
                    const match = commonPacks.find(p => Math.abs(ratio - p) / p < 0.25);
                    if (match) {
                        suspectedUnits = match;
                    }
                }

                // C. Normalize if unit count > 1
                if (suspectedUnits > 1) {
                    const estimatedBulkPrice = oldPrice * suspectedUnits;

                    const distToUnit = Math.abs(newPrice - oldPrice);
                    const distToBulk = Math.abs(newPrice - estimatedBulkPrice);

                    // If clearly closer to bulk price
                    if (distToBulk < distToUnit) {
                        // It's a bulk price, convert to unit
                        newPrice = newPrice / suspectedUnits;
                    }
                }
            }

            // Ensure valid number
            newPrice = newPrice || 0;

            // Discounts
            const newD1 = item.descuento || articulo.descuento1 || 0;

            return {
                // Import Data
                original_desc: item.descripcion,
                original_code: item.codigo,
                original_ean: item.codigo, // Redundant but explicit for UI if needed

                // Match Data
                articulo_id: match.articulo_id,
                articulo_desc: articulo.descripcion,
                articulo_sku: articulo.sku,

                // Pricing Data
                old_precio: oldPrice,
                new_precio: newPrice,
                var_precio: oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 100,

                old_descuento1: articulo.descuento1 || 0,
                new_descuento1: newD1,

                // Status
                status: match.status, // found, suggested, not_found
                match_confidence: match.score
            };
        });

        const found = uiMappedItems.filter(i => i.status === "found" || i.status === "suggested");
        const notFound = uiMappedItems.filter(i => i.status === "not_found");

        return NextResponse.json({
            success: true,
            detectedProviderId: proveedorId || null,
            detectedProviderName: detectedProviderName || null,
            stats: {
                total: items.length,
                found: found.length,
                not_found: notFound.length,
                unmatched_db: unmatchedDbArticles.length // New Stat
            },
            items: uiMappedItems,
            unmatchedDbArticles: unmatchedDbArticles, // Send to frontend
            metadata: metadata
        });

    } catch (error: any) {
        console.error("Import Price Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
