import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://ugkttgqgyhvkprpdmqql.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U"

const supabase = createClient(supabaseUrl, supabaseKey)

const RECEPCION_ID = "68417dfd-fc8d-4ecc-95c7-d85fbb1fac78"

async function fixPlanchita() {
    console.log("Fixing Planchita Price...")

    const { data: items, error } = await supabase
        .from("recepciones_items")
        .select("*, articulos(descripcion)")
        .eq("recepcion_id", RECEPCION_ID)

    if (error) {
        console.error("Error fetching items:", error)
        return
    }

    // Find the item with 0 price and "Planchita"
    const item = items?.find(i => {
        // Handle array or object
        const art = i.articulos || (i as any).articulo
        const desc = Array.isArray(art) ? art[0]?.descripcion : art?.descripcion
        return desc && desc.toLowerCase().includes("planchita")
    })

    if (!item) {
        console.log("Planchita item not found.")
        items?.forEach(i => console.log(" - " + JSON.stringify(i)))
        return
    }

    console.log(`Item Found: ${JSON.stringify(item.articulos)}`) // Log structure for debug
    console.log(`Current Price: ${item.precio_documentado}`)

    if (item.precio_documentado === 0) {
        // OCR said 794.92
        console.log("Updating to 794.92...")
        const { error } = await supabase
            .from("recepciones_items")
            .update({ precio_documentado: 794.92 })
            .eq("id", item.id)

        if (!error) console.log("Success.")
        else console.error("Error:", error)
    } else {
        console.log("Price is not 0. No action needed.")
    }
}

fixPlanchita()
