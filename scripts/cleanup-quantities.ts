import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://ugkttgqgyhvkprpdmqql.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U"

const supabase = createClient(supabaseUrl, supabaseKey)

const RECEPCION_ID = "68417dfd-fc8d-4ecc-95c7-d85fbb1fac78"

async function cleanupQuantities() {
    console.log(`Resetting documented quantities for reception: ${RECEPCION_ID}`)

    // 1. Reset all items for this reception
    const { error } = await supabase
        .from("recepciones_items")
        .update({
            cantidad_documentada: 0,
            precio_documentado: 0,

            // Clear traceability fields
            cantidad_base: null,
            factor_conversion: null,
            conversion_source: null,
            requires_review: false
        })
        .eq("recepcion_id", RECEPCION_ID)

    if (error) {
        console.error("Error resetting quantities:", error)
    } else {
        console.log("Successfully reset quantities to 0")
    }

    // 2. Also clear any logs for this reception to start fresh
    const { error: errorLogs } = await supabase
        .from("ocr_conversion_warnings")
        .delete()
        .eq("recepcion_id", RECEPCION_ID)

    if (errorLogs) {
        console.warn("Could not clear warnings:", errorLogs)
    } else {
        console.log("Cleared old warnings")
    }
}

cleanupQuantities()
