import { nowArgentina, todayArgentina } from "@/lib/utils"
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string; itemId: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const { id: recepcionId, itemId } = await params;
    const body = await request.json();
    const { accion, precio_nuevo } = body; // accion: 'actualizar_costo' | 'imputar_diferencia' | 'reclamar'

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

    try {
        // 1. Fetch Item and Reception Item to get Article ID, Quantity, Prices and Provider
        const { data: item, error: fetchError } = await supabase
            .from("recepciones_items")
            .select(`
        *, 
        articulo:articulos(*),
        recepcion:recepciones(id, proveedor_id)
      `)
            .eq("id", itemId)
            .eq("recepcion_id", recepcionId)
            .single();

        if (fetchError || !item) {
            return NextResponse.json({ error: "Item not found" }, { status: 404 });
        }

        // 2. Handle Actions
        if (accion === "actualizar_costo") {
            if (!precio_nuevo || precio_nuevo <= 0) {
                return NextResponse.json({ error: "Invalid price" }, { status: 400 });
            }

            // Update Article Master Data
            const { error: updateArtError } = await supabase
                .from("articulos")
                .update({
                    precio_compra: precio_nuevo,
                    ultimo_costo: precio_nuevo,
                    fecha_actualizacion: nowArgentina()
                })
                .eq("id", item.articulo_id);

            if (updateArtError) {
                console.error("Error updating article:", updateArtError);
                return NextResponse.json({ error: "Failed to update article price" }, { status: 500 });
            }
        } else if (accion === "imputar_diferencia") {
            // Calculate difference to impute
            const precioOC = item.precio_oc || 0;
            const precioDoc = item.precio_documentado || 0;

            // Difference per unit
            const diffUnit = precioDoc - precioOC;

            // Total difference
            // We generally use 'cantidad_documentada' as the accepted quantity for billing context
            const qty = item.cantidad_documentada || 0;
            const montoImputar = diffUnit * qty;

            if (Math.abs(montoImputar) < 0.01) {
                // Too small, just ignore/verify
            } else {
                // Insert into Account Current
                // Check if provider exists? Guaranteed by DB constraint usually.
                const proveedorId = item.recepcion.proveedor_id;

                if (!proveedorId) {
                    return NextResponse.json({ error: "Proveedor not found on Reception" }, { status: 400 });
                }

                const descripcion = `Ajuste Precio Recepción #${recepcionId.slice(0, 8)} - Item: ${item.articulo.sku}`;

                const { error: insertCcError } = await supabase
                    .from("cuenta_corriente_proveedores")
                    .insert({
                        proveedor_id: proveedorId,
                        tipo_movimiento: 'ajuste_precio',
                        monto: montoImputar, // Can be positive (Debt) or negative (Credit)
                        descripcion: descripcion,
                        referencia_id: recepcionId,
                        referencia_tipo: 'recepcion',
                        fecha: nowArgentina()
                    });

                if (insertCcError) {
                    console.error("Error inserting CC movement:", insertCcError);
                    // We fail early or warn? Let's fail to avoid data mismatch
                    return NextResponse.json({ error: "Failed to register account movement: " + insertCcError.message }, { status: 500 });
                }
            }
        }

        // 3. Mark Item as Verified
        // We attempt to set 'precio_verificado'
        const updates: any = {};
        updates.precio_verificado = true;

        const { error: updateItemError } = await supabase
            .from("recepciones_items")
            .update(updates)
            .eq("id", itemId);

        if (updateItemError) {
            console.warn("Could not set precio_verificado:", updateItemError.message);
        }

        return NextResponse.json({ success: true, message: "Price processed successfully" });

    } catch (error: any) {
        console.error("Error in verify-price:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
