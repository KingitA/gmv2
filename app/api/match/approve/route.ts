import { nowArgentina, todayArgentina } from "@/lib/utils"
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeText } from '@/lib/matching/normalizer';
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await req.json();
        const { import_item_id, selected_sku_id, match_method, score } = body;

        if (!import_item_id || !selected_sku_id) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // 1. Get the item to verify raw data
        const { data: item, error: fetchError } = await supabase
            .from('import_items')
            .select(`
            *,
            imports ( id, type, meta )
        `)
            .eq('id', import_item_id)
            .single();

        if (fetchError || !item) {
            return NextResponse.json({ error: "Item not found" }, { status: 404 });
        }

        // Extract provider info from import metadata or raw data
        // Assuming typical data structure: import meta has provider_id, or item raw_data has it
        const providerId = item.imports?.meta?.provider_id || item.raw_data.provider_id;

        if (!providerId) {
            return NextResponse.json({ error: "Provider ID missing from context" }, { status: 400 });
        }

        const rawData = item.raw_data;
        const normDesc = normalizeText(rawData.description);

        // 2. Upsert Match (Persistent Memory)
        // We try to match by Code first if available, else by Normalized Description
        const upsertData = {
            proveedor_id: providerId,
            articulo_id: selected_sku_id,
            descripcion_proveedor: rawData.description,
            descripcion_proveedor_norm: normDesc,
            codigo_proveedor: rawData.code || null,
            confianza: match_method === 'manual' ? 'manual' : 'auto_verified',
            last_used_at: nowArgentina(),
            updated_at: nowArgentina()
        };

        // We increment usage if exists, otherwise set to 1.
        // Supabase upsert doesn't easily do "increment if exists" in one atomic go without RPC or conflict handling.
        // For now simple upsert with Conflict on (proveedor_id, codigo_proveedor) OR (proveedor_id, descripcion_proveedor_norm)
        // This is tricky because we might have multiple constraints.
        // Script 039 added unique constraint on (proveedor_id, descripcion_proveedor_norm).
        // Script 040 added index on (proveedor_id, codigo_proveedor).

        // Strategy: Try to find existing record to update, else insert.
        let existingMatch = null;

        if (rawData.code) {
            const { data } = await supabase.from('articulos_proveedores')
                .select('id, veces_usado')
                .eq('proveedor_id', providerId)
                .eq('codigo_proveedor', rawData.code)
                .maybeSingle();
            existingMatch = data;
        }

        if (!existingMatch) {
            const { data } = await supabase.from('articulos_proveedores')
                .select('id, veces_usado')
                .eq('proveedor_id', providerId)
                .eq('descripcion_proveedor_norm', normDesc)
                .maybeSingle();
            existingMatch = data;
        }

        if (existingMatch) {
            await supabase.from('articulos_proveedores').update({
                articulo_id: selected_sku_id, // Update target if changed
                last_used_at: new Date(),
                veces_usado: (existingMatch.veces_usado || 0) + 1,
                confianza: 'manual' // If user approved it, it's manually verified now
            }).eq('id', existingMatch.id);
        } else {
            await supabase.from('articulos_proveedores').insert({
                ...upsertData,
                veces_usado: 1
            });
        }

        // 3. Update Import Item Status
        const { error: updateError } = await supabase
            .from('import_items')
            .update({
                status: 'approved',
                candidate_sku_id: selected_sku_id,
                match_method: match_method,
                match_confidence: score,
                match_details: { approved_at: new Date() }
            })
            .eq('id', import_item_id);

        if (updateError) throw updateError;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Match approve error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
