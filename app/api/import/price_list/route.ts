import { nowArgentina, todayArgentina } from "@/lib/utils"
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MatchingEngine } from '@/lib/matching/matcher';
import { ImportItemRaw } from '@/lib/matching/types';
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
    const supabase = createAdminClient();
    const engine = new MatchingEngine();
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await req.json();
        let { provider_id, items, filename } = body;

        console.log(`[Import] Received: provider=${provider_id}, filename=${filename}, items=${items?.length}`);

        if ((!provider_id || provider_id === "auto" || provider_id === "") && filename) {
            const { data: allProviders } = await supabase.from('proveedores').select('id, nombre');
            if (allProviders) {
                const lowerFilename = filename.toLowerCase();
                console.log(`[AutoDetect] Trying to match filename '${lowerFilename}' against ${allProviders.length} providers.`);

                // Strategy 1: Full name inclusion
                const sorted = allProviders.sort((a: any, b: any) => b.nombre.length - a.nombre.length);
                let found = sorted.find((p: any) => lowerFilename.includes(p.nombre.toLowerCase()));

                // Strategy 2: First word match (e.g. "Lenterdit" in "LENTERDIT S.A.")
                if (!found) {
                    found = sorted.find((p: any) => {
                        const firstWord = p.nombre.split(' ')[0].toLowerCase();
                        return firstWord.length > 3 && lowerFilename.includes(firstWord);
                    });
                }

                if (found) {
                    provider_id = found.id;
                    console.log(`[AutoDetect] SUCCESS: Map '${filename}' -> Provider: ${found.nombre}`);
                } else {
                    console.log(`[AutoDetect] FAILED: No tokens matched for '${filename}'`);
                    console.log(`[AutoDetect] Available: ${sorted.map((p: any) => p.nombre).join(', ')}`);
                }
            }
        }

        if (!provider_id || !items || !Array.isArray(items)) {
            return NextResponse.json({ error: "Invalid payload: Provider ID missing and could not be detected from filename." }, { status: 400 });
        }

        // 1. Create Import Header
        // Ensure "meta" stores helpful context
        const { data: importHeader, error: importError } = await supabase
            .from('imports')
            .insert({
                type: 'price_list',
                status: 'processing',
                meta: {
                    provider_id,
                    filename,
                    total_items: items.length,
                    processed_at: nowArgentina()
                },
                created_by: (await supabase.auth.getUser()).data.user?.id
            })
            .select()
            .single();

        if (importError) throw importError;

        const importId = importHeader.id;
        const results = [];

        // 2. Process Items
        // Loop through the robustly parsed items.
        // We expect 'items' to be of type ParsedItem[] (from lib/parsing/price_list_parser.ts)
        // containing fields like: code, ean, description, description_norm, cost_unit, pack_qty, unit_price, case_price, etc.

        for (const item of items) {
            // Construct standard raw item for the MatchingEngine
            // distinct from the rich structure we save to DB.
            const rawItem: ImportItemRaw = {
                description: item.description_norm || item.description, // Prefer normalized description for matching
                code: item.code,
                ean: item.ean,
                price: item.cost_unit, // Use calculated unit cost for "price"
                ...item
            };

            // CALL THE ENGINE
            const matchResult = await engine.resolveItem(rawItem, provider_id);

            // Prepare record for 'import_items'
            // We explicitely map the new columns we added to the schema.
            results.push({
                import_id: importId,
                raw_data: item, // Store the full parsed object

                // New Columns mapping
                supplier_code: item.code,
                ean: item.ean,
                description_norm: item.description_norm,
                pack_qty: item.pack_qty,
                unit_price: item.unit_price,
                case_price: item.case_price,
                cost_unit: item.cost_unit,
                cost_case: item.cost_case,
                requires_review: item.requires_review,
                parse_notes: item.parse_notes,

                status: matchResult.status, // 'matched' or 'pending'
                candidate_sku_id: matchResult.bestCandidate?.sku_id,
                match_confidence: matchResult.bestCandidate?.score || 0,
                match_method: matchResult.bestCandidate?.method,
                match_details: {
                    candidates: matchResult.allCandidates, // Store top K
                    signals: matchResult.bestCandidate?.signals
                }
            });
        }

        // 3. Batch Insert into import_items
        const { error: itemsError } = await supabase
            .from('import_items')
            .insert(results);

        if (itemsError) throw itemsError;

        // 4. Update Header Status
        await supabase
            .from('imports')
            .update({ status: 'completed' })
            .eq('id', importId);

        return NextResponse.json({ success: true, importId });

    } catch (error: any) {
        console.error("Import price_list error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
