import { createClient } from "@supabase/supabase-js"

const supabaseUrl = "https://ugkttgqgyhvkprpdmqql.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U"

const supabase = createClient(supabaseUrl, supabaseKey)

const RECEPCION_ID = "68417dfd-fc8d-4ecc-95c7-d85fbb1fac78"

async function debugPlanchita() {
    console.log("Dumping all items to find Planchita...")

    const { data: docs } = await supabase
        .from("recepciones_documentos")
        .select("*")
        .eq("recepcion_id", RECEPCION_ID)

    docs?.forEach(doc => {
        const ocrItems = doc.datos_ocr?.items || []
        console.log(`\nDoc ${doc.id} (${doc.tipo_documento}) Items: ${ocrItems.length}`)
        ocrItems.forEach((i: any) => {
            console.log(` - ${i.descripcion_ocr} | Qty: ${i.cantidad} | Price: ${i.precio_unitario}`)
        })
    })
}

debugPlanchita()
