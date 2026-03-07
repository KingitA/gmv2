import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
    try {
        // Verify cron secret (optional security layer)
        const authHeader = request.headers.get("authorization")
        if (
            process.env.CRON_SECRET &&
            authHeader !== `Bearer ${process.env.CRON_SECRET}`
        ) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const supabase = await createClient()

        // Find orders that were soft-deleted more than 45 days ago
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - 45)

        // 1. Get IDs of orders to purge
        const { data: ordersToPurge, error: fetchError } = await supabase
            .from("pedidos")
            .select("id, numero_pedido")
            .eq("estado", "eliminado")
            .lt("eliminado_at", cutoffDate.toISOString())

        if (fetchError) {
            console.error("[CRON] Error fetching orders to purge:", fetchError)
            return NextResponse.json(
                { error: "Error fetching orders to purge" },
                { status: 500 }
            )
        }

        if (!ordersToPurge || ordersToPurge.length === 0) {
            return NextResponse.json({
                success: true,
                message: "No orders to purge",
                purged: 0,
            })
        }

        const orderIds = ordersToPurge.map((o) => o.id)

        // 2. Delete associated detail rows first
        const { error: detailError } = await supabase
            .from("pedidos_detalle")
            .delete()
            .in("pedido_id", orderIds)

        if (detailError) {
            console.error("[CRON] Error deleting pedidos_detalle:", detailError)
            return NextResponse.json(
                { error: "Error deleting order details" },
                { status: 500 }
            )
        }

        // 3. Delete the orders
        const { error: deleteError } = await supabase
            .from("pedidos")
            .delete()
            .in("id", orderIds)

        if (deleteError) {
            console.error("[CRON] Error deleting pedidos:", deleteError)
            return NextResponse.json(
                { error: "Error deleting orders" },
                { status: 500 }
            )
        }

        console.log(
            `[CRON] Purged ${ordersToPurge.length} deleted orders:`,
            ordersToPurge.map((o) => o.numero_pedido).join(", ")
        )

        return NextResponse.json({
            success: true,
            purged: ordersToPurge.length,
            orders: ordersToPurge.map((o) => o.numero_pedido),
        })
    } catch (error) {
        console.error("[CRON] Error in purge-deleted-orders:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}
