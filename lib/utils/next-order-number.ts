/**
 * Próximo número de pedido (6 dígitos, p. ej. "000032"). Lo usan TODAS las
 * puertas: ERP, vendedor, mostrador, depósito y mail.
 *
 * Número seguro (05/11/2026): sale de la base con pedido_numero_reservar()
 * (supabase/migrations/20261105_pedidos_origen_numeracion.sql), una secuencia
 * atómica que arranca después del número más alto y saltea los ya usados: dos
 * pedidos a la vez nunca reciben el mismo. Antes se leía el máximo de los
 * últimos 50 y se sumaba 1, y dos a la vez podían salir repetidos.
 *
 * Sin la migración aplicada (la función no existe) cae al cálculo viejo.
 *
 * @param supabase - Supabase client instance (regular or admin)
 */
export async function getNextOrderNumber(supabase: any): Promise<string> {
    const { data: reservado, error: rpcError } = await supabase.rpc("pedido_numero_reservar")
    if (!rpcError && typeof reservado === "string" && reservado) return reservado
    if (rpcError && !funcionInexistente(rpcError)) throw new Error(`No se pudo reservar el número de pedido: ${rpcError.message}`)

    // Get the maximum numeric order number
    const { data, error } = await supabase
        .from("pedidos")
        .select("numero_pedido")
        .not("numero_pedido", "is", null)
        .order("numero_pedido", { ascending: false })
        .limit(50)

    if (error) {
        console.error("Error fetching max order number:", error)
        // Fallback: count-based
        const { count } = await supabase.from("pedidos").select("*", { count: "exact", head: true })
        return String((count || 0) + 1).padStart(6, "0")
    }

    // Find the highest numeric value among all numero_pedido
    let maxNum = 0
    if (data && data.length > 0) {
        for (const row of data) {
            const numericPart = row.numero_pedido?.replace(/[^0-9]/g, "")
            if (numericPart) {
                const parsed = parseInt(numericPart, 10)
                if (!isNaN(parsed) && parsed > maxNum) {
                    maxNum = parsed
                }
            }
        }
    }

    return String(maxNum + 1).padStart(6, "0")
}

/** La función de la base todavía no existe (migración sin aplicar). */
function funcionInexistente(e: { code?: string; message?: string }): boolean {
    const msg = e.message || ""
    return e.code === "PGRST202" || e.code === "42883" || (/pedido_numero_reservar/.test(msg) && /not find|does not exist|no existe/i.test(msg))
}
