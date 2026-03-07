import { nowArgentina, todayArgentina } from "@/lib/utils"
import { NextRequest, NextResponse } from "next/server"
import { processOrder, processOrderText } from "@/lib/actions/ai-order-import"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Webhook for automated order ingestion
 * Receives data from Gmail (via Make.com/Zapier/etc) or WhatsApp
 */
export async function POST(req: NextRequest) {
    try {
        let body: any = {}
        const contentType = req.headers.get("content-type") || ""

        if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData()
            body.source = formData.get("source")?.toString().trim() || ""
            body.sender = formData.get("sender")?.toString().trim() || ""
            body.content = formData.get("content")?.toString().trim() || ""
            body.apiKey = formData.get("apiKey")?.toString().trim() || ""

            const file = formData.get("file") as File | null
            if (file) {
                body.fileName = file.name
                body.mimeType = file.type
                const arrayBuffer = await file.arrayBuffer()
                body.fileContent = Buffer.from(arrayBuffer).toString('base64')
            }
        } else {
            body = await req.json()
        }

        console.log("Webhook received body:", JSON.stringify({ ...body, fileContent: body.fileContent ? "[BASE64_DATA_HIDDEN]" : null }, null, 2))
        const { source, sender, content, fileName, fileContent, mimeType, apiKey } = body

        // 1. Validate API Key (Simple check for now, should be in DB)
        const SYSTEM_API_KEY = process.env.AUTOMATION_API_KEY
        if (apiKey !== SYSTEM_API_KEY) {
            console.error(`Auth failed. Received: '${apiKey}', Expected: '${SYSTEM_API_KEY}'`)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const supabase = createAdminClient()
        // We return immediately to Make.com so it doesn't timeout (40s max)
        // and we process the actual file/text in the background.

        const backgroundProcess = async () => {
            try {
                let result
                // 2. Process Content
                if (fileContent && fileName) {
                    const buffer = Buffer.from(fileContent, "base64")
                    result = await processOrder(buffer, fileName, mimeType || "application/octet-stream")
                } else if (content) {
                    result = await processOrderText(content)
                } else {
                    console.error("Webhook background: No content provided")
                    return
                }

                // 3. Identify Client
                let clienteId = null
                if (sender) {
                    const { data: clienteByMail } = await supabase.from("clientes").select("id").filter("mail", "eq", sender).maybeSingle()
                    if (clienteByMail) {
                        clienteId = clienteByMail.id
                    } else {
                        const { data: clienteByTel } = await supabase.from("clientes").select("id").filter("telefono", "eq", sender).maybeSingle()
                        if (clienteByTel) clienteId = clienteByTel.id
                    }
                }

                if (!clienteId && result.candidateCustomerData) {
                    clienteId = result.candidateCustomerData.id
                } else if (!clienteId && result.candidateCustomer) {
                    const { data: clienteByName } = await supabase.from("clientes").select("id").ilike("razon_social", `%${result.candidateCustomer}%`).limit(1).maybeSingle()
                    if (clienteByName) clienteId = clienteByName.id
                }

                // 4. Handle Staging / Final Creation
                const canAutoCreate = clienteId && result.needsReview === 0 && result.items.length > 0
                console.log(`Webhook background: Handling Staging. canAutoCreate=${canAutoCreate}, clienteId=${clienteId}`)

                if (canAutoCreate) {
                    console.log("Webhook background: Attempting createOrderAutomated...")
                    const orderId = await createOrderAutomated(supabase, clienteId, result.items, source)
                    console.log("Webhook background: createOrderAutomated success. orderId:", orderId)
                } else {
                    console.log("Webhook background: Attempting saveToImports for manual review...")
                    const importId = await saveToImports(supabase, source, sender, clienteId, result)
                    console.log("Webhook background: saveToImports success. importId:", importId)
                }
            } catch (bgError: any) {
                if (bgError.message && bgError.message.includes("No se detectaron artículos")) {
                    console.log("Webhook background: Successfully ignored non-order attachment.")
                } else {
                    console.error("Webhook background fatal error:", bgError)
                }
            }
        }

        // DO NOT AWAIT backgroundProcess() so the endpoint responds immediately
        backgroundProcess()

        return NextResponse.json({ success: true, message: "Accepted for processing", accepted: true }, { status: 202 })

    } catch (error: any) {
        console.error("Webhook error:", error)

        // If the AI specifically says no items were detected, it's likely a non-order attachment
        // We shouldn't throw a 500 error here or Make.com will stop the scenario.
        if (error.message && error.message.includes("No se detectaron artículos")) {
            return NextResponse.json({
                success: true,
                ignored: true,
                reason: "No items detected in this file"
            })
        }

        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

async function createOrderAutomated(supabase: any, clienteId: string, items: any[], source: string) {
    // 1. Generate Order Number
    const { count } = await supabase.from("pedidos").select("*", { count: "exact", head: true })
    const numeroPedido = `AUTO-${String((count || 0) + 1).padStart(6, "0")}`

    // 2. Get client info
    const { data: cliente, error: clienteError } = await supabase.from("clientes").select("*").eq("id", clienteId).single()

    if (clienteError || !cliente) {
        throw new Error(`Cliente no encontrado con ID: ${clienteId}`)
    }

    // 3. Process items and totals
    let subtotal = 0
    const processedItems = items.map(item => {
        const p = item.matchedProduct
        const itemSubtotal = item.quantity * (p.precio_compra || 0)
        subtotal += itemSubtotal
        return {
            producto_id: p.id,
            cantidad: item.quantity,
            precio_base: p.precio_compra || 0,
            precio_final: p.precio_compra || 0,
            subtotal: itemSubtotal,
            precio_costo: p.ultimo_costo || p.precio_compra || 0
        }
    })

    const iva = cliente.condicion_iva === "responsable_inscripto" ? 0 : subtotal * 0.21
    const percepciones = cliente.aplica_percepciones ? subtotal * 0.03 : 0
    const total = subtotal + iva + percepciones

    // 4. Insert Order
    const { data: pedido, error: pedidoError } = await supabase.from("pedidos").insert({
        numero_pedido: numeroPedido,
        cliente_id: clienteId,
        vendedor_id: cliente.vendedor_id,
        fecha: nowArgentina(),
        estado: "pendiente",
        subtotal,
        descuento_general: 0,
        total_flete: 0,
        total_impuestos: iva + percepciones,
        total,
        observaciones: `Importado automáticamente desde ${source}`
    }).select().single()

    if (pedidoError) throw pedidoError

    // 5. Insert Details
    const details = processedItems.map(item => ({
        pedido_id: pedido.id,
        articulo_id: item.producto_id,
        cantidad: item.cantidad,
        precio_base: item.precio_base,
        precio_final: item.precio_final,
        subtotal: item.subtotal,
        precio_costo: item.precio_costo
    }))

    const { error: detailsError } = await supabase.from("pedidos_detalle").insert(details)
    if (detailsError) throw detailsError

    return pedido.id
}

async function saveToImports(supabase: any, source: string, sender: string, clienteId: string | null, result: any) {
    // 1. Header
    const { data: importRec, error: importError } = await supabase.from("imports").insert({
        type: `auto_order_${source}`,
        status: "pending",
        meta: {
            source,
            sender,
            cliente_id: clienteId,
            cliente_nombre: result.candidateCustomerData?.razon_social || null,
            candidate_customer: result.candidateCustomer,
            total_items: result.totalDetected,
            needs_review: result.needsReview
        }
    }).select().single()

    if (importError) throw importError

    // 2. Items
    const items = result.items.map((item: any) => ({
        import_id: importRec.id,
        raw_data: {
            description: item.originalText,
            quantity: item.quantity
        },
        status: item.confidence === "HIGH" ? "matched" : "pending",
        candidate_sku_id: item.matchedProduct?.id || null,
        match_confidence: item.confidence === "HIGH" ? 0.95 : (item.confidence === "MEDIUM" ? 0.75 : 0.4),
        match_method: "ai_vector"
    }))

    const { error: itemsError } = await supabase.from("import_items").insert(items)
    if (itemsError) throw itemsError

    return importRec.id
}
