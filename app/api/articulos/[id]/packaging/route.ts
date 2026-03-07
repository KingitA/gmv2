import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export const dynamic = "force-dynamic";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error
        const { id } = await params;
        const { unidades_por_bulto } = await request.json();

        if (!unidades_por_bulto || unidades_por_bulto <= 0) {
            return NextResponse.json(
                { error: "unidades_por_bulto debe ser mayor a 0" },
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

        // Update article packaging
        const { data, error } = await supabase
            .from("articulos")
            .update({ unidades_por_bulto })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error updating packaging:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
