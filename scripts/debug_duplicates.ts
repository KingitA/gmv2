import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://ugkttgqgyhvkprpdmqql.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U"

const supabase = createClient(supabaseUrl, supabaseKey)

const RECEPCION_ID = "68417dfd-fc8d-4ecc-95c7-d85fbb1fac78"

async function debugDetailed() {
    console.log(`Debugging duplicates for reception: ${RECEPCION_ID}`)

    // 1. Check Items
    const { data: items } = await supabase
        .from("recepciones_items")
        .select("id, articulo_id, cantidad_documentada, cantidad_base, conversion_source, factor_conversion, articulo(descripcion)")
        .eq("recepcion_id", RECEPCION_ID)

    console.log("--- RECEPCIONES ITEMS [Detailed] ---")
    items?.forEach((item: any) => {
        // Only show items with quantity > 0 to reduce noise
        if (item.cantidad_documentada > 0) {
            const desc = Array.isArray(item.articulo) ? item.articulo[0]?.descripcion : item.articulo?.descripcion
            console.log(`Item: ${desc}`)
            console.log(`Qty Doc: ${item.cantidad_documentada} | Factor: ${item.factor_conversion} | Source: ${item.conversion_source}`)
        }
    })

    // 2. Check Documents
    const { data: docs } = await supabase
        .from("recepciones_documentos")
        .select("id, tipo_documento, created_at, datos_ocr")
        .eq("recepcion_id", RECEPCION_ID)

    console.log(`\n--- DOCUMENTOS FOUND: ${docs?.length} ---`)
    docs?.forEach((doc: any, index: number) => {
        console.log(`\n[DOC ${index + 1}] ID: ${doc.id} | Type: ${doc.tipo_documento} | Created: ${doc.created_at}`)
        const ocrItems = doc.datos_ocr?.items || []
        console.log(`Items count: ${ocrItems.length}`)

        // Filter for the specific problematic item "ESCOBILLON GOLF"
        const problemItems = ocrItems.filter((i: any) =>
            i.descripcion_ocr.includes("GOLF") ||
            i.descripcion_ocr.includes("ESCOBILLON")
        )

        problemItems.forEach((item: any) => {
            console.log(`   >>> MATCH CANDIDATE: "${item.descripcion_ocr}" | Cant: ${item.cantidad} | Unit: "${item.unidad_medida}" | Code: "${item.codigo_visible}"`)
        })
    })
}

debugDetailed()
