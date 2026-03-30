"use server"

import { GoogleGenerativeAI } from "@google/generative-ai"
import { searchProductsByVector } from "./embeddings"
import { createAdminClient } from "@/lib/supabase/admin"

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || ""
const genAI = new GoogleGenerativeAI(apiKey)

export type ParsedItem = {
    originalText: string
    quantity: number
    matchedProduct?: any
    confidence: "HIGH" | "MEDIUM" | "LOW"
}

export type ParseResult = {
    candidateCustomer: string | null
    candidateCustomerData?: { id: string; razon_social: string } | null
    items: ParsedItem[]
    totalDetected: number
    needsReview: number
    rawAnalysis?: any // For debugging
    errors?: string[]
}

/**
 * Server Action for manual file uploads from the UI
 */
export async function parseOrderFile(formData: FormData): Promise<ParseResult> {
    const files = formData.getAll("file") as File[]
    if (!files || files.length === 0) {
        throw new Error("No files uploaded")
    }

    const aggregatedItems: ParsedItem[] = []
    const errors: string[] = []
    let detectedCustomer: string | null = null
    let totalDetected = 0
    let needsReview = 0

    console.log(`Processing ${files.length} uploaded files...`)

    for (const file of files) {
        try {
            const bytes = await file.arrayBuffer()
            const buffer = Buffer.from(bytes)
            const mimeType = file.type || "image/jpeg"
            const fileName = file.name || "upload.jpg"

            const result = await processOrder(buffer, fileName, mimeType)

            aggregatedItems.push(...result.items)
            if (result.candidateCustomer && !detectedCustomer) {
                detectedCustomer = result.candidateCustomer
            }
            totalDetected += result.totalDetected
            needsReview += result.needsReview
        } catch (error: any) {
            console.error(`Error processing file ${file.name}:`, error)
            errors.push(`${file.name}: ${error.message || "Error desconocido"}`)
        }
    }

    if (aggregatedItems.length === 0 && errors.length > 0) {
        throw new Error(`Fallaron todos los archivos: ${errors.join(", ")}`)
    }

    return {
        candidateCustomer: detectedCustomer,
        items: aggregatedItems,
        totalDetected,
        needsReview,
        errors: errors.length > 0 ? errors : undefined
    }
}

/**
 * Core processing logic that can be used by both UI and Webhooks
 */
export async function processOrder(buffer: Buffer, fileName: string, mimeType: string): Promise<ParseResult> {
    // Determine if it's XLSX specifically
    const isXlsx = mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || fileName.endsWith(".xlsx") || fileName.endsWith(".xls")

    if (isXlsx) {
        try {
            // ── Claude-based XLSX deep analysis ──────────────
            const { analyzeXlsxOrder } = await import("@/lib/ai/claude-xlsx-analyzer")

            console.log(`[processOrder] 🧠 Sending XLSX to Claude for deep analysis: ${fileName}`)
            const xlsxAnalysis = await analyzeXlsxOrder(buffer, fileName)

            if (!xlsxAnalysis.items || xlsxAnalysis.items.length === 0) {
                throw new Error("No se detectaron artículos en el archivo. Verifica que las cantidades estén en formato numérico.")
            }

            console.log(`[processOrder] ✅ Claude extracted ${xlsxAnalysis.items.length} items, customer: ${xlsxAnalysis.customer || 'none'}`)

            // Also try to detect customer from header cells (backup for Claude)
            const xlsx = await import("xlsx")
            const workbook = xlsx.read(buffer, { type: "buffer" })
            let headerCustomer: string | null = null

            for (const sheetName of workbook.SheetNames) {
                if (headerCustomer) break
                const worksheet = workbook.Sheets[sheetName]
                const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as any[][]
                for (let r = 0; r < Math.min(rows.length, 10); r++) {
                    const row = rows[r]
                    if (!row) continue
                    for (let c = 0; c < Math.min(row.length, 6); c++) {
                        const rawCell = String(row[c] || "").trim().toUpperCase()
                        const normalizedCell = rawCell.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                        if (normalizedCell === "CLIENTE" || normalizedCell === "CLIENTE:" || normalizedCell === "CLIENTE -") {
                            let cust = String(row[c + 1] || "").trim()
                            if (!cust && c + 2 < row.length) cust = String(row[c + 2] || "").trim()
                            if (!cust && c + 3 < row.length) cust = String(row[c + 3] || "").trim()
                            if (cust) {
                                headerCustomer = cust.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/:/g, '').replace(/\s+/g, ' ').toLowerCase()
                                break
                            }
                        }
                    }
                    if (headerCustomer) break
                }
            }

            const finalParsedData = {
                customer: xlsxAnalysis.customer || null,
                headerCustomer: headerCustomer,
                items: xlsxAnalysis.items.map(item => ({
                    description: item.description,
                    quantity: item.quantity,
                    code: item.code,
                    brand: item.brand,
                    color: item.color,
                }))
            }

            console.log("Total items extracted via Claude:", finalParsedData.items.length)
            console.log("Detected Customer:", finalParsedData.customer || headerCustomer || "None")

            return await processMatches(finalParsedData)

        } catch (xlsxErr: any) {
            console.error("Error parsing/processing XLSX:", xlsxErr)
            throw new Error(xlsxErr.message || "Error al procesar el archivo Excel")
        }
    }

    // 2. Processing Images/PDFs
    const base64Data = buffer.toString("base64")
    const generationConfig = {
        maxOutputTokens: 4096,
        temperature: 0.1,
        responseMimeType: "application/json",
    }
    let model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig })

    const prompt = `
    Analyze this order image/document.
    Your task is to extract items where the CUSTOMER HAS REQUESTED A QUANTITY.

    STRICT RULES:
    1. Only extract items where there is an EXPLICIT REQUESTED QUANTITY (e.g., hand-written or typed in a quantity column).
    2. IGNORE "Bulto", "Units per Box", or "Pack Size" information. 
    3. If there is a number like 12 or 120, check if it's the requested amount or just the packaging size. 
    4. Try to detect the customer name (e.g. next to "cliente:" or at the top of the page). If you cannot find a clear name, set "customer" to null.
    5. Return ONLY a JSON list of items found and the customer name.

    JSON Structure:
    {
      "customer": "Name of the single customer found, or null",
      "items": [
        { "description": "...", "quantity": 12, "code": "...", "brand": "...", "color": "..." }
      ]
    }
    `
    console.log("Sending non-XLSX file to Gemini...")
    let result;
    try {
        result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType,
                },
            },
        ])
    } catch (e: any) {
        console.warn("Gemini 2.0 Flash failed for non-XLSX, trying fallbacks...", e.message)
        try {
            model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001", generationConfig })
            result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType,
                    },
                },
            ])
        } catch (e2) {
            console.warn("Gemini 2.0 Flash 001 failed for non-XLSX, trying gemini-flash-latest...", e2)
            model = genAI.getGenerativeModel({ model: "gemini-flash-latest", generationConfig })
            result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType,
                    },
                },
            ])
        }
    }

    const response = await result.response
    const text = response.text()

    const parsedData = tryParseJson(text)

    if (!parsedData) {
        console.error("Failed to parse Gemini JSON for non-XLSX. Raw text sample:", text.substring(0, 500))
        throw new Error("El pedido es demasiado grande o la respuesta de la IA se cortó. Por favor intenta subirlo en partes si es posible o revisa los artículos cargados.")
    }

    console.log("Gemini Extracted:", parsedData)
    return await processMatches(parsedData)
}

/**
 * Process order from plain text (e.g., body of an email or WhatsApp message)
 */
export async function processOrderText(text: string): Promise<ParseResult> {
    const generationConfig = {
        maxOutputTokens: 2048,
        temperature: 0.1,
        responseMimeType: "application/json",
    }
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig })

    const prompt = `
    Analyze this message content to extract ALL requested items and quantities.
    The message might be an email, a WhatsApp chat, or an order message.
    
    STRICT RULES:
    1. Extract EVERY SINGLE LINE that has a quantity + product description. Do NOT skip any item.
    2. Each line is typically formatted as: "<quantity> <product description>" (e.g., "12 colgate clasico x70", "1 caja trapo gris eco max").
    3. IGNORE "Bulto", "Units per Box", or "Pack Size" information.
    4. Try to detect the customer name. Common patterns:
       - "Pedido <customer_name>:" in the subject or body (e.g., "Pedido chin chu lin:" means customer is "chin chu lin")
       - "Cliente: <name>"
       - If you cannot find a clear name, set "customer" to null.
    5. Return ALL items found. It is CRITICAL to not miss any item. Count the lines carefully.
    6. If the message has a subject line like "Asunto: Pedido X" or body starts with "Pedido X:", then "X" is the customer name.

    JSON Structure:
    {
      "customer": "Name of the single customer found, or null",
      "items": [
        { "description": "...", "quantity": 12, "code": "...", "brand": "...", "color": "..." }
      ]
    }

    IMPORTANT: A single message may contain MULTIPLE orders or requests. Extract ALL items from ALL orders.
    The message may reference different customers, products from different categories, etc. Extract EVERYTHING.

    MESSAGE CONTENT:
    ${text}
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    const responseText = response.text()
    const parsedData = tryParseJson(responseText)

    if (!parsedData) {
        throw new Error("Failed to parse AI response for order text")
    }

    return await processMatches(parsedData)
}

/**
 * Result from multi-customer email body analysis
 */
export interface MultiOrderParseResult {
    orders: Array<{
        customer: string | null
        items: ParsedItem[]
        parseResult: ParseResult
    }>
    attachmentHints: Array<{
        customer: string
        filenameHint: string | null
    }>
}

/**
 * Process order text that may contain MULTIPLE orders for DIFFERENT customers.
 * Returns separate ParseResults for each customer/order found.
 * Also extracts "attachment hints" — when the body says something like
 * "el excel es de juanenea" or "el pedido del archivo adjunto es de X".
 */
export async function processOrderTextMulti(text: string): Promise<MultiOrderParseResult> {
    const generationConfig = {
        maxOutputTokens: 4096,
        temperature: 0.1,
        responseMimeType: "application/json",
    }
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig })

    const prompt = `
    Analyze this email/message content. It may contain MULTIPLE separate orders for DIFFERENT customers.
    
    STRICT RULES:
    1. A single email body might say something like:
       "Pedido chin chu lin:
        12 colgate clasico x70
        1 caja trapo gris eco max
        
        El pedido del excel es de juanenea gabriel"
       In this case, there are TWO things happening:
       a) Items listed directly in the body belong to customer "chin chu lin"
       b) An ATTACHMENT is referenced for customer "juanenea gabriel" — this goes in "attachmentHints"
    
    2. For each separate ORDER with items listed in the body, create a separate entry in the "orders" array.
    3. Each order MUST have its own "customer" name (extracted from patterns like "Pedido X:", "Cliente: X", etc.)
    4. If text references an attachment/excel/file belonging to a different customer (e.g. "el excel es de X", 
       "el pedido del archivo es de X", "lo del excel es pedido de X"), add that to "attachmentHints".
    5. Do NOT create order items for references to attachments — those items are IN the attachments, not in the body.
    6. If there's only ONE customer and items are listed, return a single order.
    7. Phrases like "Gracias", "Saludos" are NOT items.

    JSON Structure:
    {
      "orders": [
        {
          "customer": "chin chu lin",
          "items": [
            { "description": "colgate clasico x70", "quantity": 12 },
            { "description": "caja trapo gris eco max", "quantity": 1 }
          ]
        }
      ],
      "attachmentHints": [
        {
          "customer": "juanenea gabriel",
          "filenameHint": "excel" 
        }
      ]
    }

    If the body has NO items listed (only references to attachments), return:
    { "orders": [], "attachmentHints": [...] }

    MESSAGE CONTENT:
    ${text}
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    const responseText = response.text()
    const parsedData = tryParseJson(responseText)

    if (!parsedData) {
        throw new Error("Failed to parse AI multi-order response")
    }

    const multiResult: MultiOrderParseResult = {
        orders: [],
        attachmentHints: parsedData.attachmentHints || [],
    }

    // Process each order separately through the matching pipeline
    const rawOrders = parsedData.orders || []
    for (const rawOrder of rawOrders) {
        if (!rawOrder.items || rawOrder.items.length === 0) continue

        const matchData = {
            customer: rawOrder.customer || null,
            items: rawOrder.items,
        }

        try {
            const parseResult = await processMatches(matchData)
            multiResult.orders.push({
                customer: rawOrder.customer || null,
                items: parseResult.items,
                parseResult,
            })
        } catch (err) {
            console.error(`[processOrderTextMulti] Error processing order for ${rawOrder.customer}:`, err)
        }
    }

    return multiResult
}

/**
 * Shared logic to match detected items with the database
 */
async function processMatches(parsedData: any): Promise<ParseResult> {
    const processedItems: ParsedItem[] = []
    let needsReviewCount = 0

    const itemsToProcess = parsedData.items || []

    // Batch processing to avoid hitting rate limits (429 Too Many Requests) on Gemini Embeddings API
    const BATCH_SIZE = 10
    const DELAY_MS = 1000 // 1 second delay between batches

    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
        const batch = itemsToProcess.slice(i, i + BATCH_SIZE)
        console.log(`Processing vector matches batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(itemsToProcess.length / BATCH_SIZE)}...`)

        const processItemPromises = batch.map(async (item: any) => {
            let match: any = null
            let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW"

            // Failsafe extraction of original text:
            const baseDescription = item.description || item.originalText || ""
            const originalTextForFrontend = `${item.code ? item.code + " " : ""}${baseDescription}`.trim() || "ARTÍCULO SIN DESCRIPCIÓN"

            try {
                const supabase = createAdminClient()

                // 1. FIRST PRIORITY: EXACT SKU MATCH IN DATABASE
                let cleanCode = item.code ? String(item.code).trim() : ""
                let exactSkuMatch = null

                // Extract code from parentheses in description like "(#000022)" or "(033100)"
                if (!cleanCode && baseDescription) {
                    const codeInParens = baseDescription.match(/\(#?(\d+)\)/)
                    if (codeInParens) {
                        cleanCode = codeInParens[1].replace(/^0+/, '') || '0' // strip leading zeros
                    }
                }

                if (cleanCode !== "") {
                    // Try exact match first
                    const { data } = await supabase
                        .from("articulos")
                        .select("id, descripcion, sku")
                        .ilike("sku", cleanCode)
                        .maybeSingle()

                    if (data) {
                        exactSkuMatch = data
                    } else {
                        // Try without leading zeros (e.g. "000022" → "22")
                        const stripped = cleanCode.replace(/^0+/, '') || '0'
                        if (stripped !== cleanCode) {
                            const { data: d2 } = await supabase
                                .from("articulos")
                                .select("id, descripcion, sku")
                                .ilike("sku", stripped)
                                .maybeSingle()
                            if (d2) exactSkuMatch = d2
                        }
                    }
                }

                // Alternate exact match: Try extracting the first word if it looks like an SKU model (at least 3 chars alphanumeric)
                if (!exactSkuMatch && baseDescription) {
                    const firstWordMatch = baseDescription.trim().match(/^([A-Za-z0-9\-_]+)(?:\s|$)/);
                    if (firstWordMatch && firstWordMatch[1].length >= 3) {
                        const possibleCode = firstWordMatch[1];
                        const { data } = await supabase
                            .from("articulos")
                            .select("id, descripcion, sku")
                            .ilike("sku", possibleCode)
                            .maybeSingle()

                        if (data) {
                            exactSkuMatch = data
                            cleanCode = possibleCode
                        }
                    }
                }

                if (exactSkuMatch) {
                    match = exactSkuMatch
                    confidence = "HIGH"
                }

                // 2. SECOND PRIORITY: VECTOR / FUZZY MATCH IF NO EXACT SKU
                if (!match) {
                    const searchQuery = `${item.code || ""} ${item.brand || ""} ${baseDescription} ${item.color || ""}`.trim()
                    const candidates = await searchProductsByVector(searchQuery, 0.4, 5)

                    if (candidates && candidates.length > 0) {
                        const bestCandidate = candidates[0]
                        if (bestCandidate.similarity > 0.82) {
                            match = bestCandidate
                            confidence = "HIGH"
                        } else if (bestCandidate.similarity > 0.75) {
                            match = bestCandidate
                            confidence = "MEDIUM"
                        } else {
                            match = bestCandidate
                            confidence = "LOW"
                        }
                    } else {
                        // 3. THIRD PRIORITY: DIRECT BACKUP ILIKE QUERY ON DB IN CASE VECTOR IS EMPTY
                        if (baseDescription.length > 3) {
                            const { data: fallbackMatch } = await supabase
                                .from("articulos")
                                .select("id, descripcion, sku")
                                .ilike("descripcion", `%${baseDescription}%`)
                                .limit(1)
                                .maybeSingle()

                            if (fallbackMatch) {
                                match = fallbackMatch
                                confidence = "MEDIUM" // Fallback query is considered medium confidence
                            }
                        }
                    }
                }
            } catch (e: any) {
                console.error(`Error matching item '${item.description}':`, e.message || e)
            }

            // Log match result for debugging
            if (match) {
                console.log(`[processMatches] ✅ "${originalTextForFrontend}" → matched to id=${match.id}, desc="${match.descripcion || match.sku || '?'}", confidence=${confidence}`)
            } else {
                console.log(`[processMatches] ❌ "${originalTextForFrontend}" → NO MATCH FOUND`)
            }

            return {
                originalText: originalTextForFrontend,
                quantity: parseFloat(item.quantity) || 0,
                matchedProduct: match,
                confidence: confidence
            }
        })

        const batchResults = await Promise.all(processItemPromises)
        for (const res of batchResults) {
            if (res.confidence !== "HIGH") needsReviewCount++
            processedItems.push(res)
        }

        // Wait before next batch if not the last one
        if (i + BATCH_SIZE < itemsToProcess.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS))
        }
    }

    let candidateCustomerData = null
    const customerStr = parsedData.headerCustomer || parsedData.customer

    if (customerStr && typeof customerStr === 'string' && customerStr.trim().length > 0) {
        try {
            const supabase = createAdminClient()
            let cleanStr = customerStr.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/cliente:?\s*/g, '')

            let { data: exactClientMatch } = await supabase
                .from("clientes")
                .select("id, razon_social, nombre")
                .or(`razon_social.ilike.%${cleanStr}%,nombre.ilike.%${cleanStr}%`)
                .limit(1)
                .maybeSingle()

            if (exactClientMatch) {
                candidateCustomerData = exactClientMatch
                // console.log(`Matched customer '${customerStr}' EXACTLY to DB client:`, candidateCustomerData.razon_social)
            } else {
                const searchParts = cleanStr.split(' ').filter((p: string) => p.length >= 3)

                if (searchParts.length > 0) {
                    let query = supabase.from("clientes").select("id, razon_social, nombre")
                    const orQueries = searchParts.map((part: string) => `razon_social.ilike.%${part}%,nombre.ilike.%${part}%`).join(',')
                    query = query.or(orQueries)

                    const { data: clientesEncontrados } = await query

                    if (clientesEncontrados && clientesEncontrados.length > 0) {
                        let bestMatch = clientesEncontrados[0]
                        let maxScore = -1
                        for (const c of clientesEncontrados) {
                            let score = 0
                            const normRazon = (c.razon_social || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                            const normNombre = (c.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                            for (const p of searchParts) {
                                if (normRazon.includes(p)) score += 2
                                if (normNombre.includes(p)) score += 1
                            }
                            if (score > maxScore) {
                                maxScore = score
                                bestMatch = c
                            }
                        }
                        candidateCustomerData = bestMatch
                        // console.log(`Matched customer '${customerStr}' FUZZY to DB client:`, candidateCustomerData.razon_social)
                    } else {
                        // console.log(`Could not find a DB match for customer string: '${customerStr}'`)
                    }
                }
            }
        } catch (err) {
            console.error("Error searching customer candidate:", err)
        }
    }

    if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV-CLIENT] extractedHeaderCustomer=${parsedData.headerCustomer || 'null'} geminiCustomer=${parsedData.customer || 'null'} matchedClient=${candidateCustomerData?.razon_social || 'null'}`);
    }

    return {
        candidateCustomer: customerStr || null,
        candidateCustomerData,
        items: processedItems,
        totalDetected: processedItems.length,
        needsReview: needsReviewCount,
        rawAnalysis: parsedData
    }
}

/**
 * Fallback parser for truncated JSON
 */
function tryParseJson(str: string) {
    try {
        return JSON.parse(str)
    } catch (e) {
        // Attempt to close truncation
        let fixed = str.trim()
        if (fixed.endsWith(",")) fixed = fixed.slice(0, -1)

        // Count braces and brackets
        const openBraces = (fixed.match(/\{/g) || []).length
        const closeBraces = (fixed.match(/\}/g) || []).length
        const openBrackets = (fixed.match(/\[/g) || []).length
        const closeBrackets = (fixed.match(/\]/g) || []).length

        // Add missing closing elements
        for (let i = 0; i < (openBrackets - closeBrackets); i++) fixed += "]"
        for (let i = 0; i < (openBraces - closeBraces); i++) fixed += "}"

        try {
            return JSON.parse(fixed)
        } catch (e2) {
            return null
        }
    }
}
