"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { createPedido, type CondicionProveedor, type CondicionMarca } from "@/lib/actions/pedidos"

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

export async function approveImport(
    importId: string,
    clienteId: string,
    items: any[],
    condicionesProveedor?: CondicionProveedor[],
    condicionesMarca?: CondicionMarca[],
) {
    const supabase = await createClient()

    // Delegar en createPedido: usa el mismo motor de precios que la carga manual
    // (listas por segmento, descuentos del cliente, y listas especiales por proveedor
    // — leídas automáticamente de cliente_proveedor_condicion + el override de este import).
    const itemsPedido = (items || [])
        .filter((i: any) => i.matchedProduct?.id && (i.quantity ?? 0) > 0)
        .map((i: any) => ({
            producto_id: i.matchedProduct.id,
            cantidad: i.quantity,
            precio_unitario: 0,   // ignorado: el precio se calcula desde lista/segmento/especial
            descuento: 0,
        }))

    if (itemsPedido.length === 0) throw new Error("El pedido no tiene artículos vinculados")

    const pedido = await createPedido({
        cliente_id: clienteId,
        items: itemsPedido,
        observaciones: "Aprobado desde importación",
        condiciones_proveedor: condicionesProveedor,
        condiciones_marca: condicionesMarca,
    })

    // Marcar la importación como completada
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
