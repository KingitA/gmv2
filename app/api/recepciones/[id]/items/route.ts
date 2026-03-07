import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const { item_id, cantidad_fisica, articulo_id } = body;

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

        // If item_id is provided, update existing item
        if (item_id) {
            const { data, error } = await supabase
                .from("recepciones_items")
                .update({ cantidad_fisica })
                .eq("id", item_id)
                .eq("recepcion_id", recepcion_id)
                .select()
                .single();

            if (error) throw error;
            return NextResponse.json(data);
        }
        // If no item_id but articulo_id, it might be a new item not in OC
        else if (articulo_id) {
            // Check if item exists in this reception
            const { data: existingItem } = await supabase
                .from("recepciones_items")
                .select("id")
                .eq("recepcion_id", recepcion_id)
                .eq("articulo_id", articulo_id)
                .single();

            if (existingItem) {
                const { data, error } = await supabase
                    .from("recepciones_items")
                    .update({ cantidad_fisica })
                    .eq("id", existingItem.id)
                    .select()
                    .single();
                if (error) throw error;
                return NextResponse.json(data);
            } else {
                // Insert new item (was not in OC)
                const { data, error } = await supabase
                    .from("recepciones_items")
                    .insert({
                        recepcion_id,
                        articulo_id,
                        cantidad_oc: 0,
                        cantidad_fisica,
                        cantidad_documentada: 0,
                        estado_linea: 'no_pedido'
                    })
                    .select()
                    .single();

                if (error) throw error;
                return NextResponse.json(data);
            }
        }

        return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });

    } catch (error: any) {
        console.error("Error updating reception item:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
