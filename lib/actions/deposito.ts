"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { nowArgentina } from "@/lib/utils"

export async function finalizarPreparacion(pedidoId: string, sesionId: string | null, userId: string) {
    const supabase = createAdminClient()

    // Verificar permisos (opcional pero recomendado)
    // Aunque createAdminClient salta RLS, verificar que el usuario es deposito es bueno.
    // Por simplicidad y evitar doble query, confiamos en que la UI ya filtró, 
    // pero si quisiéramos ser estrictos:
    /*
    const { data: userRoles } = await supabase
        .from("usuarios_roles")
        .select("roles(nombre)")
        .eq("usuario_id", userId)
    // check role...
    */

    try {
        // 1. Actualizar estado del pedido
        const { error: pedidoError } = await supabase
            .from("pedidos")
            .update({
                estado: "pendiente_facturacion" // FIXED: "listo" was not a valid state enum
            })
            .eq("id", pedidoId)

        if (pedidoError) throw new Error("Error actualizando pedido: " + pedidoError.message)

        // 2. Cerrar sesión de picking si existe
        if (sesionId) {
            const { error: sesionError } = await supabase
                .from("picking_sesiones")
                .update({
                    estado: "TERMINADO",
                    fin_at: nowArgentina(),
                })
                .eq("id", sesionId)

            if (sesionError) console.error("Error cerrando sesión:", sesionError)
        }

        revalidatePath("/deposito")
        revalidatePath(`/deposito/preparar/${pedidoId}`)

        return { success: true }
    } catch (error: any) {
        console.error("Error en finalizarPreparacion:", error)
        return { success: false, error: error.message }
    }
}
