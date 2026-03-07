import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const query = searchParams.get("q");

        if (!query || query.length < 3) {
            return NextResponse.json([]);
        }

        // Buscar por descripcion o SKU
        // Usamos una sintaxis más segura para el OR
        const { data: articulos, error } = await supabase
            .from("articulos")
            .select("id, descripcion, sku")
            .or(`sku.ilike.%${query}%,descripcion.ilike.%${query}%`)
            .eq("activo", true)
            .limit(20);

        if (error) {
            console.error("[v0] Supabase error in search:", error);
            throw error;
        }

        if (error) throw error;

        return NextResponse.json(articulos || []);
    } catch (error: any) {
        console.error("[v0] Error buscando artículos:", error);
        return NextResponse.json(
            { error: error.message || "Error buscando artículos" },
            { status: 500 }
        );
    }
}
