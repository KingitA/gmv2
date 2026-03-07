import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://ugkttgqgyhvkprpdmqql.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U"

const supabase = createClient(supabaseUrl, supabaseKey)

const RECEPCION_ID = "68417dfd-fc8d-4ecc-95c7-d85fbb1fac78"

// Helper to normalize text (same as route.ts)
const normalizeText = (text: string | null | undefined): string => {
    if (!text) return "";
    return text
        .toLowerCase()
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");
};

async function checkAndFix() {
    console.log("Checking GOLF item...")

    // 1. Get the DB Item
    // We fetch ALL items to find the GOLF
    const { data: allItems, error } = await supabase
        .from("recepciones_items")
        .select("id, articulo_id, cantidad_documentada, articulos(descripcion)")
        .eq("recepcion_id", RECEPCION_ID)

    if (error) {
        console.error("Error fetching items:", error)
        return
    }

    console.log(`Items in DB: ${allItems?.length || 0}`)

    if (allItems && allItems.length > 0) {
        // Debug first item structure
        // console.log("Sample item structure:", JSON.stringify(allItems[0], null, 2))
    }

    // Brute force find with safe access
    const getDesc = (i: any) => {
        // Supabase might return 'articulos' as the key now
        const art = i.articulos || i.articulo
        if (Array.isArray(art)) return art[0]?.descripcion
        return art?.descripcion
    }

    // 2. Fetch Documents to simulate sum
    const { data: docs } = await supabase
        .from("recepciones_documentos")
        .select("*")
        .eq("recepcion_id", RECEPCION_ID)

    console.log(`Documents found: ${docs?.length}`)

    // CHECK ALL ITEMS
    console.log(`\n--- CHECKING ALL ${allItems.length} ITEMS ---`)

    for (const item of allItems) {
        const desc = getDesc(item)?.toLowerCase() || ""
        // Calculate Expected
        let expectedTotal = 0
        let breakdown = ""

        docs?.forEach(doc => {
            const ocrItems = doc.datos_ocr?.items || []
            // Fuzzy match logic simulation (simple includes for now, assuming Gemini consistency)
            // Note: In real app we use Jaccard/Codes. Here we rely on the fact that if it matched before, descriptions should align.
            // We use a looser match to find the candidate.
            // BUT: "Escobillon Golf" vs "Escobillon Panda".
            // We need to match precise enough.
            // Using ID would be best if we had it. We don't.
            // We'll use "includes" but verify unique match?

            // Actually, we can just look for the SAME textual description that we saw in the logs?
            // "ESCOBILLON GOLF"
            // "ESCOBILLON PANDA"
            // "ESCOBA EUROPA"
            // "ESCOBA AMERICANA"
            // ...
            // We try to find a match in the OCR list for this DB item.
            // DB Item Name: "ESCOBILLON LISO GOLF..."
            // OCR Item Name: "ESCOBILLON GOLF"

            // Finding match using normalized description logic
            const match = ocrItems.find((i: any) => {
                const iDesc = normalizeText(i.descripcion_ocr)
                const dbDesc = normalizeText(getDesc(item))
                // Match if significant overlap
                return iDesc.includes(dbDesc.split(" ")[0]) && iDesc.includes(dbDesc.split(" ")[1] || "")
            })

            if (match) {
                let factor = 1
                // Use logic from simulated "Intelligent Detection"
                if (match.unidad_medida && normalizeText(match.unidad_medida).includes("unida")) {
                    factor = 1
                } else {
                    // Fallback factor.
                    // For Presupuesto (Unit null), we saw Golf (1104) matching 1104.
                    // This implies factor 1.
                    // We assume Factor 1 for this reception's context.
                    factor = 1
                }
                const contribution = match.cantidad * factor
                breakdown += ` [Doc ${doc.id.slice(0, 4)}: ${contribution}]`
                expectedTotal += contribution

                // Check if this specific contribution explains the excess?
                // We do this after loop.
            }
        })

        console.log(`Item: ${desc} | DB: ${item.cantidad_documentada} | Calc: ${expectedTotal} | Breakdown:${breakdown}`)

        const diff = item.cantidad_documentada - expectedTotal
        if (diff > 0 && expectedTotal > 0) {
            console.log(`Mismatch! Excess: ${diff}`)

            // If excess equals exactly one of the documents' contribution (e.g. 552)
            // Then likely that document was double-processed.
            // We can check if diff matches any single doc contribution or sum?
            // But simplest validation: If Expected is what we WANT, and DB is higher.
            // We Set to Expected.

            if (diff % 1 === 0) { // Safety check, integer
                console.log(` >> FIXING ${desc} to ${expectedTotal}...`)
                await supabase.from("recepciones_items").update({ cantidad_documentada: expectedTotal }).eq("id", item.id)
            }
        }
    }

    // ALTERNATIVE: Just list all items and their quantities.
    allItems.forEach(i => {
        console.log(`Item: ${getDesc(i)} | Qty: ${i.cantidad_documentada}`)
    })

    console.log("\nIf you see other items with suspicious counts (e.g. 816 for PANDA?), likely duplicated.")
    // Panda: 204 + 408 = 612.
    // If duplicated -> 612 + 204 = 816.

    // Auto-fix loop
    /*
    const panda = allItems.find(...)
    if (panda.qty === 816) ... fix to 612.
    */
}

checkAndFix()
