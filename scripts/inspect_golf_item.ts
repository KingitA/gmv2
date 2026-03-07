import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://ugkttgqgyhvkprpdmqql.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U"

const supabase = createClient(supabaseUrl, supabaseKey)

const RECEPCION_ID = "68417dfd-fc8d-4ecc-95c7-d85fbb1fac78"

async function inspect() {
    // 1. Get Golf Item
    const { data: items } = await supabase
        .from("recepciones_items")
        .select("*, articulo(descripcion)")
        .eq("recepcion_id", RECEPCION_ID)
        .ilike("articulo.descripcion", "%GOLF%")

    console.log("--- ITEM GOLF ---")
    console.log(JSON.stringify(items, null, 2))

    // 2. Get Documents
    const { data: docs } = await supabase
        .from("recepciones_documentos")
        .select("id, tipo_documento, created_at, datos_ocr")
        .eq("recepcion_id", RECEPCION_ID)
        .order("created_at")

    console.log("\n--- DOCUMENTOS ---")
    docs?.forEach(d => {
        console.log(`ID: ${d.id} | Type: ${d.tipo_documento} | Created: ${d.created_at}`)
        const golf = d.datos_ocr?.items?.find((i: any) => i.descripcion_ocr.toLowerCase().includes("golf"))
        if (golf) {
            console.log(`  CONTAINS GOLF: Cant ${golf.cantidad} | Unit ${golf.unidad_medida}`)
        } else {
            console.log(`  (No golf item found in OCR)`)
        }
    })
}

inspect()
