import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: proveedor_id } = await params;

        if (!proveedor_id) {
            return NextResponse.json(
                { error: "Proveedor ID is required" },
                { status: 400 }
            );
        }

        const supabase = createAdminClient();

        const { data: mappings, error } = await supabase
            .from("articulos_proveedores")
            .select("descripcion_proveedor, articulo_id")
            .eq("proveedor_id", proveedor_id);

        if (error) {
            throw error;
        }

        return NextResponse.json(mappings || []);

    } catch (error: any) {
        console.error("Error fetching provider mappings:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
