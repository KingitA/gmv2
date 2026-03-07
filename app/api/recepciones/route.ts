import { nowArgentina, todayArgentina } from "@/lib/utils"
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await request.json();
        const { orden_compra_id, proveedor_id, usuario_id } = body;

        if (!orden_compra_id && !proveedor_id) {
            return NextResponse.json(
                { error: "Orden de compra ID or Proveedor ID is required" },
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

        if (orden_compra_id) {
            const { data: existingReception } = await supabase
                .from("recepciones")
                .select("id")
                .eq("orden_compra_id", orden_compra_id)
                .in("estado", ["borrador", "en_proceso"])
                .single();

            if (existingReception) {
                return NextResponse.json({
                    id: existingReception.id,
                    message: "Existing active reception found",
                    isNew: false,
                });
            }
        }

        // 2. Create new reception
        const { data: newReception, error: createError } = await supabase
            .from("recepciones")
            .insert({
                orden_compra_id: orden_compra_id || null,
                proveedor_id: proveedor_id || null,
                usuario_id,
                estado: "borrador",
                fecha_inicio: nowArgentina(),
            })
            .select()
            .single();

        if (createError) {
            throw new Error(`Error creating reception: ${createError.message}`);
        }

        // 3. Populate initial items from OC details (including prices)
        // We fetch OC items and insert them into recepciones_items
        const { data: ocItems, error: ocItemsError } = await supabase
            .from("ordenes_compra_detalle")
            .select("articulo_id, cantidad_pedida, precio_unitario, descuento1, descuento2, descuento3, descuento4")
            .eq("orden_compra_id", orden_compra_id);

        if (ocItemsError) {
            throw new Error(`Error fetching OC items: ${ocItemsError.message}`);
        }

        if (orden_compra_id && ocItems && ocItems.length > 0) {
            const receptionItems = ocItems.map((item: any) => {
                let finalPrice = item.precio_unitario;
                finalPrice = finalPrice * (1 - (item.descuento1 || 0) / 100);
                finalPrice = finalPrice * (1 - (item.descuento2 || 0) / 100);
                finalPrice = finalPrice * (1 - (item.descuento3 || 0) / 100);
                finalPrice = finalPrice * (1 - (item.descuento4 || 0) / 100);

                return {
                    recepcion_id: newReception.id,
                    articulo_id: item.articulo_id,
                    cantidad_oc: item.cantidad_pedida,
                    cantidad_fisica: 0,
                    cantidad_documentada: 0,
                    precio_oc: finalPrice, // Keep precision
                    precio_documentado: 0,
                    precio_real: 0,
                    estado_linea: "pendiente",
                };
            });

            const { error: itemsError } = await supabase
                .from("recepciones_items")
                .insert(receptionItems);

            if (itemsError) {
                throw new Error(`Error populating reception items: ${itemsError.message}`);
            }
        }

        return NextResponse.json({
            ...newReception,
            isNew: true,
        });
    } catch (error: any) {
        console.error("Error creating reception:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
