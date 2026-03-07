"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina } from "@/lib/utils"

export async function getPendingImports() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("imports")
        .select(`
            *,
            import_items (*)
        `)
        .eq("status", "pending")
        .order("created_at", { ascending: false })

    if (error) throw error

    if (data && data.length > 0) {
        // Collect all candidate sku ids
        const skuIds = new Set<string>()
        data.forEach((imp: any) => {
            if (imp.import_items) {
                imp.import_items.forEach((item: any) => {
                    if (item.candidate_sku_id) skuIds.add(item.candidate_sku_id)
                })
            }
        })

        if (skuIds.size > 0) {
            const skuArray = Array.from(skuIds)
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[DEV-VERIFY] Collected ${skuIds.size} unique candidate_sku_ids.`);
                console.log(`[DEV-VERIFY] First 5 candidate_sku_ids:`, skuArray.slice(0, 5));
            }

            // Usamos admin client para el fetch de productos por si hay RLS
            const adminSupabase = createAdminClient()

            // Fetch products
            const { data: productosData, error: prodError } = await adminSupabase
                .from("articulos")
                .select("id, descripcion, sku, precio_compra, ultimo_costo")
                .in("id", skuArray)

            if (prodError) {
                if (process.env.NODE_ENV !== 'production') {
                    console.error(`[DEV-PRODERROR] Error fetching articulos:`, prodError);
                }
            }

            if (!prodError && productosData) {
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[DEV-VERIFY] Fetched ${productosData.length} productos from DB.`);
                    console.log(`[DEV-VERIFY] First 5 productos ids:`, productosData.slice(0, 5).map(p => p.id));
                }
                const prodMap = new Map(productosData.map((p: any) => [p.id, p]))

                // Attach to items
                data.forEach((imp: any) => {
                    if (imp.import_items) {
                        imp.import_items.forEach((item: any) => {
                            item.linkedArticulo = null;
                            if (item.candidate_sku_id && prodMap.has(item.candidate_sku_id)) {
                                item.linkedArticulo = prodMap.get(item.candidate_sku_id)
                                // if (process.env.NODE_ENV !== 'production') {
                                //     console.log(`[DEV-VERIFY] Item mapped to linkedArticulo:`, item.linkedArticulo.descripcion);
                                // }
                            }
                        })
                    }
                })
            }
        }
    }

    return data
}

export async function approveImport(importId: string, clienteId: string, items: any[]) {
    const supabase = await createClient()

    // 1. Generate Order Number (numeric-only)
    const numeroPedido = await getNextOrderNumber(supabase)

    // 2. Get client info
    const { data: cliente } = await supabase.from("clientes").select("*").eq("id", clienteId).single()
    if (!cliente) throw new Error("Cliente no encontrado")

    // 3. Totals
    let subtotal = 0
    const processedItems = []

    for (const item of items) {
        if (!item.matchedProduct) continue
        const itemSubtotal = item.quantity * (item.matchedProduct.precio_compra || 0)
        subtotal += itemSubtotal
        processedItems.push({
            producto_id: item.matchedProduct.id,
            cantidad: item.quantity,
            precio_base: item.matchedProduct.precio_compra || 0,
            precio_final: item.matchedProduct.precio_compra || 0,
            subtotal: itemSubtotal,
            precio_costo: item.matchedProduct.ultimo_costo || item.matchedProduct.precio_compra || 0
        })
    }

    const iva = cliente.condicion_iva === "responsable_inscripto" ? 0 : subtotal * 0.21
    const percepciones = cliente.aplica_percepciones ? subtotal * 0.03 : 0
    const total = subtotal + iva + percepciones

    // 4. Create Order
    const { data: pedido, error: pedidoError } = await supabase.from("pedidos").insert({
        numero_pedido: numeroPedido,
        cliente_id: clienteId,
        vendedor_id: cliente.vendedor_id,
        fecha: nowArgentina(),
        estado: "pendiente",
        subtotal,
        descuento_general: 0,
        total_flete: 0,
        total_impuestos: iva + percepciones,
        total,
        observaciones: `Aprobado desde importación manual`
    }).select().single()

    if (pedidoError) throw pedidoError

    // 5. Create Details
    const details = processedItems.map(item => ({
        pedido_id: pedido.id,
        articulo_id: item.producto_id,
        cantidad: item.cantidad,
        precio_base: item.precio_base,
        precio_final: item.precio_final,
        subtotal: item.subtotal,
        precio_costo: item.precio_costo
    }))

    const { error: detailsError } = await supabase.from("pedidos_detalle").insert(details)
    if (detailsError) throw detailsError

    // 6. Update Import status
    await supabase.from("imports").update({ status: "completed" }).eq("id", importId)

    revalidatePath("/clientes-pedidos")
    revalidatePath("/clientes-pedidos/import-review")

    return { success: true, pedidoId: pedido.id }
}

export async function rejectImport(importId: string) {
    const supabase = await createClient()
    const { error } = await supabase.from("imports").update({ status: "rejected" }).eq("id", importId)
    if (error) throw error
    revalidatePath("/clientes-pedidos/import-review")
    return { success: true }
}
