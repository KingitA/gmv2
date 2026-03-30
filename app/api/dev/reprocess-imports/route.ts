import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processMatches } from '@/lib/actions/ai-order-import'

export async function GET() {
    try {
        const supabase = createAdminClient()

        const { data: imports, error: importsError } = await supabase
            .from("imports")
            .select("id, meta")
            .eq("status", "pending")

        if (importsError || !imports || imports.length === 0) {
            return NextResponse.json({ success: true, message: "No pendings or error", error: importsError })
        }

        let totalReprocessed = 0

        for (const imp of imports) {
            const { data: items } = await supabase
                .from("import_items")
                .select("*")
                .eq("import_id", imp.id)

            if (!items) continue

            const batchToProcess = items.map(dbItem => {
                const desc = dbItem.raw_data?.description || dbItem.raw_data?.originalText || ""
                return {
                    db_id: dbItem.id,
                    description: desc,
                    quantity: dbItem.raw_data?.quantity || 1
                }
            })

            const matchingResults = await processMatches(batchToProcess)

            for (let i = 0; i < batchToProcess.length; i++) {
                const dbId = batchToProcess[i].db_id
                const result = matchingResults[i]
                
                const isMatch = result.confidence === "HIGH" || result.confidence === "MEDIUM"

                await supabase
                    .from("import_items")
                    .update({
                        candidate_sku_id: result.matchedProduct?.id || null,
                        match_confidence: result.confidence === 'HIGH' ? 0.95 : (result.confidence === 'MEDIUM' ? 0.75 : 0.4),
                        match_method: result.confidence === 'HIGH' ? 'exact_sku' : 'ai_vector',
                        status: isMatch ? 'matched' : 'pending'
                    })
                    .eq("id", dbId)
            }
            totalReprocessed++
        }

        return NextResponse.json({ success: true, processed: totalReprocessed })
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message })
    }
}
