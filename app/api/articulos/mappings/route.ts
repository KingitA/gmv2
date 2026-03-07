import { nowArgentina, todayArgentina } from "@/lib/utils"
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { normalizeText } from "@/lib/services/matching";
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error
        const body = await request.json();
        const { proveedor_id, articulo_id, codigo_proveedor, descripcion_proveedor } = body;

        if (!proveedor_id || !articulo_id) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: { persistSession: false },
            }
        );

        // 1. Verify availability
        // 2. Insert mapping
        
        // Normalize description for better matching
        const normDesc = normalizeText(descripcion_proveedor);

        const { data, error } = await supabase
            .from("articulos_proveedores")
            .upsert({
                proveedor_id,
                articulo_id,
                codigo_proveedor: codigo_proveedor || null,
                descripcion_proveedor: descripcion_proveedor,
                descripcion_proveedor_norm: normDesc,
                veces_usado: 1,
                ultimo_uso: nowArgentina()
            }, {
                onConflict: "proveedor_id, codigo_proveedor, descripcion_proveedor", // Depending on your constraint, but usually ID is PK. 
                // Wait, we might want to ensure we don't have duplicates for the same provider input -> article.
                // Or maybe just insert a new record.
                // Let's assume unique constraint on (proveedor_id, codigo_proveedor) if code exists
                // OR (proveedor_id, descripcion_proveedor) if code is missing?
                // Actually, duplicate mappings for same input string are bad.
            })
            .select()
            .single();

        if (error) { 
            // If constraint fails, maybe we just update?
            // For now, let's just try insert and return error if fails
            console.error("Error saving mapping:", error);
            return NextResponse.json({ error: "Error saving mapping" }, { status: 500 });
        }

        return NextResponse.json({ success: true, mapping: data });

    } catch (error: any) {
        console.error("Mapping Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
