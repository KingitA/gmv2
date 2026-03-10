import { nowArgentina, todayArgentina } from "@/lib/utils"
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: recepcion_id } = await params;
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

        // 1. Fetch reception items WITH conversion factor AND related OC details
        // Note: We need to join ordenes_compra to get the details
        const { data: reception, error: receptionError } = await supabase
            .from("recepciones")
            .select(`
                proveedor_id,
                items:recepciones_items (
                    articulo_id, 
                    cantidad_fisica,
                    articulo:articulos(unidades_por_bulto)
                ),
                orden_compra:ordenes_compra(
                    detalles:ordenes_compra_detalle(
                        articulo_id,
                        tipo_cantidad
                    )
                )
            `)
            .eq("id", recepcion_id)
            .single();

        if (receptionError) throw receptionError;
        const items = reception.items;

        // 2. Update stock for each item
        for (const item of items) {
            if (item.cantidad_fisica > 0) {
                // CRITICAL: cantidad_fisica is ALWAYS stored in packs (bultos)
                // Stock is ALWAYS managed in units (unidades)
                // Therefore: ALWAYS multiply by unidades_por_bulto

                const articulo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;
                const unitsPerPack = articulo?.unidades_por_bulto || 1;
                const totalUnits = item.cantidad_fisica * unitsPerPack;

                // Insert movement
                await supabase.from("movimientos_stock").insert({
                    articulo_id: item.articulo_id,
                    tipo_movimiento: "ingreso_compra",
                    cantidad: totalUnits,
                    referencia_id: recepcion_id,
                    observaciones: `Ingreso por Recepción: ${item.cantidad_fisica} bultos x ${unitsPerPack} u/b = ${totalUnits} unidades`
                });

                // Update article stock
                const { error: rpcError } = await supabase.rpc('actualizar_stock', {
                    p_articulo_id: item.articulo_id,
                    p_cantidad: totalUnits
                });

                if (rpcError) {
                    // Fallback: Read and Update (Not safe for concurrency but works for MVP)
                    const { data: art } = await supabase.from("articulos").select("stock_actual").eq("id", item.articulo_id).single();
                    if (art) {
                        await supabase.from("articulos").update({
                            stock_actual: (art.stock_actual || 0) + totalUnits
                        }).eq("id", item.articulo_id);
                    }
                }
            }
        }

        // 3. Update reception status
        const { data: updatedReception, error: updateError } = await supabase
            .from("recepciones")
            .update({
                estado: "finalizada",
                fecha_fin: nowArgentina()
            })
            .eq("id", recepcion_id)
            .select()
            .single();

        if (updateError) throw updateError;

        // 4. Update Purchase Order status
        // Check if fully received (simplified logic: if reception finalized, we mark OC as received)
        // In a real scenario we would check if all items were received.
        if (updatedReception.orden_compra_id) {
            await supabase
                .from("ordenes_compra")
                .update({ estado: "recibida_completa" })
                .eq("id", updatedReception.orden_compra_id);

            // --- CUENTA CORRIENTE LOGIC START ---
            // 1. Remove/Reverse the Order liability from Current Account
            // We search for a movement of type 'orden_compra' linked to this OC
            // Instead of deleting, it's safer to "Resolve" it, but for now we delete or mark matched?
            // User requirement: "elimina de la cta cte la orden de compra" -> Delete row or status update.
            // Let's trying deleting only if exists to be clean, or insert a reversal? 
            // Better: Delete the provisional movement.
            const { error: deleteOCError } = await supabase
                .from("cuenta_corriente_proveedores")
                .delete()
                .eq("referencia_id", updatedReception.orden_compra_id)
                .eq("referencia_tipo", "orden_compra");

            if (deleteOCError) console.warn("Could not remove OC from CC:", deleteOCError);
        }

        // 2. Add Documents liabilities
        // Fetch uploaded documents for this reception (Facturas, Presupuestos)
        const { data: documentos } = await supabase
            .from("recepciones_documentos") // Ensure this table exists and tracks 'monto_total'
            .select("*")
            .eq("recepcion_id", recepcion_id);

        if (documentos && documentos.length > 0) {
            // Determine effective Provider ID
            const finalProveedorId = updatedReception.proveedor_id || updatedReception.orden_compra?.proveedor_id;

            if (!finalProveedorId) {
                console.error("Could not finalize CC entry: No proveedor_id found on reception or OC");
            } else {
                for (const doc of documentos) {
                    // Extract rich metadata from JSON or fallback to columns
                    const ocrData = doc.datos_ocr || {};
                    const monto = ocrData.total || doc.monto_total || 0;
                    const numero = ocrData.numero_comprobante || doc.numero_comprobante || '';
                    const fechaDoc = ocrData.fecha_emision || doc.fecha_comprobante || nowArgentina();
                    const observacion = ocrData.observaciones || '';

                    if (monto > 0) {
                        await supabase.from("cuenta_corriente_proveedores").insert({
                            proveedor_id: finalProveedorId,
                            tipo_movimiento: doc.tipo_documento || 'factura',
                            monto: monto,
                            descripcion: `Ingreso Documento: ${doc.tipo_documento} ${numero} ${observacion ? `(${observacion})` : ''}`,
                            referencia_id: recepcion_id,
                            referencia_tipo: 'recepcion',
                            fecha: fechaDoc,
                            // Store extra metadata if schema supports it, or put in descripcion
                        });
                        console.log(`[FINALIZE] Created CC entry for doc ${doc.id}: $${monto}`);
                    }
                }
            }
        }
        // --- CUENTA CORRIENTE LOGIC END ---

        return NextResponse.json({ success: true, reception: updatedReception });

    } catch (error: any) {
        console.error("Error finalizing reception:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
