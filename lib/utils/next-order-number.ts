/**
 * Generates the next sequential numeric order number.
 * Queries the max existing numero_pedido and returns max + 1, padded to 6 digits.
 * 
 * @param supabase - Supabase client instance (regular or admin)
 * @returns The next order number as a zero-padded string (e.g., "000032")
 */
export async function getNextOrderNumber(supabase: any): Promise<string> {
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
