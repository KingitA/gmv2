// =====================================================
// AI Brain — Email Order Processor
// Connects Gmail sync with existing order import pipeline
// =====================================================

import { downloadAttachment, downloadDriveFileAndExport, type ParsedEmail } from './gmail'
import { getSupabaseAdmin } from './supabase-admin'
import { processOrder, processOrderText, processOrderTextMulti, type ParseResult } from '@/lib/actions/ai-order-import'
import Anthropic from '@anthropic-ai/sdk'

// Lazy singleton for Claude
let _anthropic: Anthropic | null = null
function getAnthropicClient(): Anthropic {
    if (!_anthropic) {
        _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    }
    return _anthropic
}

export interface OrderProcessingResult {
    processed: boolean
    autoCreated: boolean
    importId?: string
    pedidoId?: string
    pedidoIds?: string[]
    itemsDetected: number
    ordersCreated: number
    ordersSentToReview: number
    needsReview: boolean
    clienteFound: boolean
    errors: string[]
}

/**
 * Procesa un email clasificado como "pedido":
 * 1. Primero parsea el BODY para detectar múltiples pedidos y attachment hints
 * 2. Descarga y parsea TODOS los adjuntos con Gemini (via processOrder)
 * 3. Usa los attachment hints del body para asignar clientes a los adjuntos
 * 4. Cada pedido (del body o adjunto) genera un pedido separado
 */
export async function processEmailAsOrder(
    emailData: ParsedEmail,
    emailAccountAddress: string,
    savedEmailId: string,
    preDownloadedAttachments?: Array<{ filename: string; mimeType: string; rawBuffer: Buffer; attachmentId: string }>
): Promise<OrderProcessingResult> {
    const db = getSupabaseAdmin()

    // Use Argentina timezone for dates
    const fechaHoy = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).split(',')[0]

    console.log(`[EmailOrderProcessor] Processing email as order: "${emailData.subject}" from ${emailData.from} (fecha: ${fechaHoy})`)

    // Collect parse results from ALL sources
    const allParseResults: { result: ParseResult; fileName: string; customerOverride?: string }[] = []

    // ── 1. Parse email body FIRST to get multi-order context + attachment hints ──
    let attachmentHints: Array<{ customer: string; filenameHint: string | null }> = []

    if (emailData.bodyText) {
        const bodyText = emailData.subject
            ? `Asunto: ${emailData.subject}\n\n${emailData.bodyText.trim()}`
            : emailData.bodyText.trim()

        if (bodyText.length > 20) {
            console.log(`[EmailOrderProcessor] Parsing email body for multi-customer orders...`)
            try {
                const multiResult = await processOrderTextMulti(bodyText)

                // Save attachment hints for step 2
                attachmentHints = multiResult.attachmentHints || []
                if (attachmentHints.length > 0) {
                    console.log(`[EmailOrderProcessor] Body references ${attachmentHints.length} attachment(s):`, attachmentHints.map(h => `"${h.customer}" (hint: ${h.filenameHint})`).join(', '))
                }

                // Add body orders (items listed directly in the email body)
                for (const order of multiResult.orders) {
                    if (order.parseResult && order.parseResult.items.length > 0) {
                        // Override the candidateCustomer with what we extracted from multi-parsing
                        if (order.customer) {
                            order.parseResult.candidateCustomer = order.customer
                        }
                        allParseResults.push({
                            result: order.parseResult,
                            fileName: 'email-body',
                            customerOverride: order.customer || undefined,
                        })
                        console.log(`[EmailOrderProcessor] ✅ Body order: ${order.parseResult.items.length} items for customer "${order.customer || 'unknown'}"`)
                    }
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error'
                if (!msg.includes('No se detectaron artículos')) {
                    console.error(`[EmailOrderProcessor] Error processing email body:`, msg)
                }
                // Fallback: try legacy single-order processing
                try {
                    const result = await processOrderText(bodyText)
                    if (result && result.items.length > 0) {
                        allParseResults.push({ result, fileName: 'email-body' })
                        console.log(`[EmailOrderProcessor] ✅ Fallback: Parsed ${result.items.length} items from email body`)
                    }
                } catch (e2) {
                    // Ignore
                }
            }
        }
    }

    // ── 2. Process ALL attachments ──────────────────────
    if (emailData.attachments.length > 0) {
        console.log(`[EmailOrderProcessor] Found ${emailData.attachments.length} attachment(s), downloading ALL...`)

        for (const att of emailData.attachments) {
            // Skip non-document attachments (signatures, icons, etc.)
            const validTypes = [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-excel',
                'application/octet-stream',
                'image/jpeg',
                'image/png',
                'image/webp',
                'text/csv',
            ]

            const isValidFile = validTypes.some(t => att.mimeType.includes(t))
                || att.filename.match(/\.(pdf|xlsx?|csv|jpe?g|png|webp)$/i)

            if (!isValidFile) {
                console.log(`[EmailOrderProcessor] Skipping attachment: ${att.filename} (${att.mimeType})`)
                continue
            }

            try {
                // Use pre-downloaded buffer if available, otherwise download
                let buffer: Buffer
                const preDownloaded = preDownloadedAttachments?.find(p => p.attachmentId === att.attachmentId)
                if (preDownloaded) {
                    buffer = preDownloaded.rawBuffer
                    console.log(`[EmailOrderProcessor] Using pre-downloaded: ${att.filename}`)
                } else {
                    console.log(`[EmailOrderProcessor] Downloading: ${att.filename}`)
                    const downloaded = await downloadAttachment(
                        emailAccountAddress,
                        emailData.gmailId,
                        att.attachmentId
                    )
                    buffer = downloaded.data
                }

                const result = await processOrder(buffer, att.filename, att.mimeType)

                if (result && result.items.length > 0) {
                    // Check if body provided a customer override for this attachment
                    let customerOverride: string | undefined
                    if (attachmentHints.length > 0) {
                        // Try to match by filename hint
                        const hint = attachmentHints.find(h => {
                            if (!h.filenameHint) return false
                            const hintLower = h.filenameHint.toLowerCase()
                            const filenameLower = att.filename.toLowerCase()
                            return filenameLower.includes(hintLower) || hintLower.includes('excel') || hintLower.includes('xlsx') || hintLower.includes('archivo')
                        })
                        if (hint) {
                            customerOverride = hint.customer
                            console.log(`[EmailOrderProcessor] 📎 Matched attachment "${att.filename}" to customer "${hint.customer}" from body hint`)
                        } else if (attachmentHints.length === 1 && emailData.attachments.filter(a =>
                            validTypes.some(t => a.mimeType.includes(t)) || a.filename.match(/\.(pdf|xlsx?|csv|jpe?g|png|webp)$/i)
                        ).length === 1) {
                            // Only one attachment hint and one valid attachment — auto-match
                            customerOverride = attachmentHints[0].customer
                            console.log(`[EmailOrderProcessor] 📎 Auto-matched single attachment "${att.filename}" to customer "${customerOverride}" from body hint`)
                        }
                    }

                    if (customerOverride) {
                        result.candidateCustomer = customerOverride
                    }

                    allParseResults.push({ result, fileName: att.filename, customerOverride })
                    console.log(`[EmailOrderProcessor] ✅ Parsed ${result.items.length} items from ${att.filename}${customerOverride ? ` (customer: ${customerOverride})` : ''}`)
                } else {
                    console.log(`[EmailOrderProcessor] ${att.filename}: parsed but 0 items found`)
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error'
                if (msg.includes('No se detectaron artículos')) {
                    console.log(`[EmailOrderProcessor] ${att.filename}: no order items found`)
                } else {
                    console.error(`[EmailOrderProcessor] Error processing ${att.filename}:`, msg)
                }
            }
        }
    }

    // ── 2b. Drive Smart Attachments & Body Links ───────────────────────────
    const driveIdsToProcess = new Map<string, string>() // fileId -> filename

    if (emailData.driveAttachments) {
        for (const att of emailData.driveAttachments) {
            driveIdsToProcess.set(att.fileId, att.filename)
        }
    }

    const fullBody = [emailData.bodyText, emailData.bodyHtml].join(' ')
    const driveRegex = /(?:drive\.google\.com\/file\/d\/|docs\.google\.com\/spreadsheets\/d\/)([-_a-zA-Z0-9]+)/g
    let match
    while ((match = driveRegex.exec(fullBody)) !== null) {
        if (!driveIdsToProcess.has(match[1])) {
            driveIdsToProcess.set(match[1], `Drive_Link_${match[1]}.xlsx`)
        }
    }

    let createdDriveAgendaEvent = false

    if (driveIdsToProcess.size > 0) {
        console.log(`[EmailOrderProcessor] Found ${driveIdsToProcess.size} Drive file(s)/link(s) to process.`)

        for (const [fileId, filename] of Array.from(driveIdsToProcess.entries())) {
            try {
                console.log(`[EmailOrderProcessor] Attempting to download Drive file ${fileId} via API...`)
                const driveFile = await downloadDriveFileAndExport(emailAccountAddress, fileId)
                const result = await processOrder(driveFile.data, filename, driveFile.mimeType)

                if (result && result.items.length > 0) {
                    allParseResults.push({ result, fileName: filename })
                    console.log(`[EmailOrderProcessor] ✅ Successfully parsed ${result.items.length} items from Drive export`)
                }
            } catch (err) {
                // Fallback to Agenda event if Drive fails
                console.log(`[EmailOrderProcessor] Drive download failed or no items found for ${fileId}, creating agenda event.`)
                try {
                    const driveUrl = `https://docs.google.com/spreadsheets/d/${fileId}`
                    await db.from('agenda').insert({
                        title: `Pedido mediante enlace/adjunto de Drive`,
                        description: `Remitente: ${emailData.from}\nAsunto: ${emailData.subject}\n\nEnlace: ${driveUrl}`,
                        event_type: 'pedido_link_drive',
                        priority: 'alta',
                        status: 'pendiente',
                        source: 'gmail',
                        source_ref_id: emailData.gmailId,
                        metadata: { drive_url: driveUrl, from: emailData.from, subject: emailData.subject }
                    })
                    createdDriveAgendaEvent = true
                    console.log(`[EmailOrderProcessor] Drive link agenda event created for ${fileId}`)
                } catch (agendaErr) {
                    console.error('[EmailOrderProcessor] Failed to create agenda event for Drive link', agendaErr)
                }
            }
        }
    }

    // ── 3. No items found at all ─────────────────────────
    if (allParseResults.length === 0) {
        if (createdDriveAgendaEvent) {
            console.log(`[EmailOrderProcessor] Drive link/attachment detected and sent to agenda. No items extracted.`)
            return {
                processed: true,
                autoCreated: false,
                itemsDetected: 0,
                ordersCreated: 0,
                ordersSentToReview: 0,
                needsReview: true,
                clienteFound: false,
                errors: ['Drive link/attachment detectado: Evento añadido a la agenda'],
            }
        }

        console.log(`[EmailOrderProcessor] No order items detected in email "${emailData.subject}"`)
        return {
            processed: true,
            autoCreated: false,
            itemsDetected: 0,
            ordersCreated: 0,
            ordersSentToReview: 0,
            needsReview: false,
            clienteFound: false,
            errors: ['No se detectaron artículos en este email'],
        }
    }

    console.log(`[EmailOrderProcessor] Total: ${allParseResults.length} source(s) with items, processing each...`)

    // ── 4. Process each parse result as a separate order ──
    const totalItems = allParseResults.reduce((sum, p) => sum + p.result.items.length, 0)
    const pedidoIds: string[] = []
    const importIds: string[] = []
    const errors: string[] = []
    let clienteFound = false

    // ── STEP 0: Detect if sender is a vendedor ──────────
    let vendedorId: string | null = null
    let vendedorClientes: any[] = []

    // Helper: search vendedor by email (checks both 'email' and 'emails_alternativos')
    async function findVendedorByEmail(emailToFind: string): Promise<{ id: string; nombre: string; email: string } | null> {
        const emailLower = emailToFind.toLowerCase().trim()
        // Try primary email first
        const { data: vendedor } = await db
            .from('vendedores')
            .select('id, nombre, email, emails_alternativos')
            .ilike('email', emailLower)
            .limit(1)
            .maybeSingle()

        if (vendedor) return vendedor

        // Try alternative emails (space-separated in emails_alternativos)
        const { data: allVendedores } = await db
            .from('vendedores')
            .select('id, nombre, email, emails_alternativos')
            .not('emails_alternativos', 'is', null)

        if (allVendedores) {
            for (const v of allVendedores) {
                const altEmails = (v.emails_alternativos || '').toLowerCase().split(/\s+/).filter(Boolean)
                if (altEmails.includes(emailLower)) return v
            }
        }
        return null
    }

    // Try direct sender first
    if (emailData.from) {
        const senderEmail = emailData.from.toLowerCase().trim()
        const vendedor = await findVendedorByEmail(senderEmail)

        if (vendedor) {
            vendedorId = vendedor.id
            console.log(`[EmailOrderProcessor] 🧑‍💼 Sender is vendedor: ${vendedor.nombre} (${vendedor.email})`)
        }
    }

    // If sender is the company account (forward), look for original sender in body
    if (!vendedorId && emailData.bodyText) {
        // Extract forwarded sender email from patterns like:
        // "De: momarsilva@gmail.com" or "From: Name <email>" or "---------- Forwarded message ----------\nDe: Name <email>"
        const forwardPatterns = [
            /(?:De|From)\s*:\s*(?:[^<]*<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i,
            /(?:forwarded|reenviado)[\s\S]*?(?:De|From)\s*:\s*(?:[^<]*<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i,
        ]

        for (const pattern of forwardPatterns) {
            const match = emailData.bodyText.match(pattern)
            if (match && match[1]) {
                const forwardedEmail = match[1].toLowerCase().trim()
                // Don't match our own accounts
                if (forwardedEmail.includes('megasur.clientes') || forwardedEmail.includes('megasur.proveedores')) continue

                const vendedor = await findVendedorByEmail(forwardedEmail)

                if (vendedor) {
                    vendedorId = vendedor.id
                    console.log(`[EmailOrderProcessor] 🧑‍💼 Forwarded sender is vendedor: ${vendedor.nombre} (${vendedor.email}) — extracted from body`)
                    break
                }
            }
        }
    }

    // Load vendedor's clients
    if (vendedorId) {
        const { data: clientes } = await db
            .from('clientes')
            .select('id, nombre, razon_social, direccion, localidad, mail, codigo_cliente')
            .eq('vendedor_id', vendedorId)
            .eq('activo', true)

        vendedorClientes = clientes || []
        console.log(`[EmailOrderProcessor] 📋 Vendedor has ${vendedorClientes.length} clients`)
    }

    for (const { result: parseResult, fileName, customerOverride } of allParseResults) {
        console.log(`[EmailOrderProcessor] Processing "${fileName}" (${parseResult.items.length} items)...`)

        // ── 4a. Identify client using AI ──────────────────
        let clienteId: string | null = null

        const customerStr = customerOverride || parseResult.candidateCustomer || ''

        console.log(`[EmailOrderProcessor] Customer hint: "${customerStr}" (vendedor: ${vendedorId ? 'yes' : 'no'})`)

        // FAST PATH: Try exact email match first (no AI needed)
        if (!clienteId && emailData.from) {
            const senderEmail = emailData.from.toLowerCase().trim()
            // Only match if sender is NOT our own company accounts
            if (!senderEmail.includes('megasur.clientes') && !senderEmail.includes('megasur.proveedores')) {
                const { data: clienteByMail } = await db
                    .from('clientes')
                    .select('id, nombre')
                    .ilike('mail', senderEmail)
                    .eq('activo', true)
                    .limit(1)
                    .maybeSingle()
                if (clienteByMail) {
                    clienteId = clienteByMail.id
                    console.log(`[EmailOrderProcessor] ✅ Client matched by email: ${clienteByMail.nombre}`)
                }
            }
        }

        // AI PATH: Use Claude to identify the client
        if (!clienteId && customerStr) {
            try {
                // Build the list of candidate clients
                let candidateClients: any[] = []

                if (vendedorId && vendedorClientes.length > 0) {
                    // Vendedor: search only in their clients
                    candidateClients = vendedorClientes
                } else {
                    // No vendedor: load all active clients (limited fields to keep prompt small)
                    const { data: allClients } = await db
                        .from('clientes')
                        .select('id, nombre, codigo_cliente, direccion, localidad, mail')
                        .eq('activo', true)
                        .limit(500)
                    candidateClients = allClients || []
                }

                if (candidateClients.length > 0) {
                    // Format client list for Claude
                    const clientList = candidateClients.map(c =>
                        `ID:${c.id} | Código:${c.codigo_cliente || '-'} | Nombre:${c.nombre || '-'} | Dirección:${c.direccion || '-'} | Localidad:${c.localidad || '-'} | Mail:${c.mail || '-'}`
                    ).join('\n')

                    const prompt = `Sos un asistente de una distribuidora. Necesito que identifiques a qué cliente se refiere un pedido.

TEXTO DEL PEDIDO/CLIENTE: "${customerStr}"
ASUNTO DEL EMAIL: "${emailData.subject || ''}"
${vendedorId ? 'NOTA: Este pedido viene de un vendedor/viajante, los clientes listados son SOLO los de ese vendedor.' : ''}

LISTA DE CLIENTES:
${clientList}

INSTRUCCIONES:
- Analizá el texto y pensá como una persona: El texto puede (o no) contener: direccion (con o sin numero), localidad, nombre del cliente, codigo del cliente.
Es muy probable que NO se indique cual es la referencia. Van a pasar los pedidos como "sarmiento", debemos interpretar y filtrar los clientes que coincidan.
Hay que entender si el pedido lo envia un viajante, que zonas atiende ese viajante o que pedidos envia recurrentemente
- Necesitamos saber a que se refiere y priorizar en este orden:
1) si se refiere a codigo de cliente debemos vincularlo al cliente con ese codigo.
2) si se refiere al nombre del cliente debemos vincularlo al cliente con ese nombre. OJO este puede contener nombres repetidos con otros clientes, por ejemplo "huang chao yan" no es el mismo cliente que "huang chao li"
en caso de encontrar mas de una coincidencia debemos filtrar esos clientes, y buscar otras coincidencias como si el pedido lo envia el viajante, a que localidad pertenece, direccion y cualquier otra dato que obtengamos.
3) si se refiere a la calle del cliente, debemos buscar dentro de los clientes de este vendedor, que cliente corresponde a esa calle, puede haber uno o mas clientes en la misma direccion, si indica el numero debemos indicar el mas aproximado.
Por ejemplo, envian "zapiola 1200" y tenemos un cliente del mismo vendedor en "zapiola 2450" y "zapiola 1250", claramente se refiere a zapiola 1250.
- OJO, hay localidades como necochea, que las calles son numeros, entonces nos van a pasar el pedido como "CHINO 59", en este caso, si se que el viajante que envia el mail vende en necochea, veo que todos los pedidos que esta pasando el viajante son de necochea, es obvio que si dice "chino 59" esta hablando de la calle del cliente y no el codigo.
-Para ayudar en contexto, debemos analizar que pedidos esta enviando un viajante, si esta pasando pedidos de necochea ya sea en el mismo mail o en los ultimos que envio, es obvio que esta atendiendo la zona necochea, hay que darle prioridad a esa zona

Respondé SOLO con el ID del cliente (el UUID) o "NONE" si no podés identificarlo. Nada más.`

                    const client = getAnthropicClient()
                    const response = await client.messages.create({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 100,
                        messages: [{ role: 'user', content: prompt }],
                    })

                    const aiResponse = (response.content[0] as any).text?.trim() || ''
                    console.log(`[EmailOrderProcessor] 🧠 Claude identified client: "${aiResponse}"`)

                    // Validate the response is a valid UUID from our list
                    if (aiResponse && aiResponse !== 'NONE') {
                        const cleanId = aiResponse.replace(/[^a-f0-9-]/g, '').trim()
                        const found = candidateClients.find(c => c.id === cleanId)
                        if (found) {
                            clienteId = found.id
                            console.log(`[EmailOrderProcessor] ✅ AI matched client: ${found.nombre} (${found.direccion}, ${found.localidad})`)
                        } else {
                            console.log(`[EmailOrderProcessor] ⚠️ AI returned ID not in candidate list: ${aiResponse}`)
                        }
                    }
                }
            } catch (aiErr) {
                console.error(`[EmailOrderProcessor] AI client identification error:`, aiErr)
            }
        }

        // Also try candidateCustomerData from the parsing phase (backup)
        if (!clienteId && parseResult.candidateCustomerData) {
            clienteId = parseResult.candidateCustomerData.id
            console.log(`[EmailOrderProcessor] ✅ Using candidateCustomerData from parsing: ${parseResult.candidateCustomerData.razon_social}`)
        }

        if (clienteId) clienteFound = true

        // ── 4b. Detect forma de facturación override ────
        let facturacionOverride: string | null = null
        const fullText = (customerStr + ' ' + (emailData.subject || '') + ' ' + (emailData.bodyText || '')).toLowerCase()

        // Check "Final/Mixto" FIRST (more specific patterns)
        if (fullText.includes('mitad y mitad') || fullText.includes('factura y presupuesto') || fullText.includes('factura y remito') || fullText.match(/\bfinal\b/)) {
            facturacionOverride = 'Final'
            console.log(`[EmailOrderProcessor] 📋 Facturación override: Final (Mixto)`)
        } else if (fullText.includes('presupuesto') || fullText.includes('remito') || fullText.includes('negro') || fullText.includes('sin iva')) {
            facturacionOverride = 'Presupuesto'
            console.log(`[EmailOrderProcessor] 📋 Facturación override: Presupuesto`)
        } else if (fullText.includes('con iva') || fullText.match(/factura\s*a\b/) || fullText.includes('facturado') || fullText.includes('responsable inscripto')) {
            facturacionOverride = 'Factura'
            console.log(`[EmailOrderProcessor] 📋 Facturación override: Factura`)
        }

        // ── 4c. Decide: auto-create, accumulate, or send to review ────
        const matchedItems = parseResult.items.filter(i => i.matchedProduct)
        const unmatchedItems = parseResult.items.filter(i => !i.matchedProduct)
        const canAutoCreate = clienteId && matchedItems.length > 0 && unmatchedItems.length === 0

        console.log(`[EmailOrderProcessor] "${fileName}": ${matchedItems.length} matched, ${unmatchedItems.length} unmatched, clienteId=${clienteId || 'none'}, canAutoCreate=${canAutoCreate}`)

        if (canAutoCreate) {
            try {
                // Check if this client has a pending order → accumulate instead of creating new
                const { data: existingPendiente } = await db
                    .from('pedidos')
                    .select('id, numero_pedido')
                    .eq('cliente_id', clienteId)
                    .eq('estado', 'pendiente')
                    .is('eliminado_at', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()

                if (existingPendiente) {
                    // Accumulate items into existing pending order
                    console.log(`[EmailOrderProcessor] 📦 Found pending order ${existingPendiente.numero_pedido} for this client — accumulating`)
                    await accumulateIntoOrder(db, existingPendiente.id, matchedItems, facturacionOverride)
                    pedidoIds.push(existingPendiente.id)
                    console.log(`[EmailOrderProcessor] ✅ Accumulated ${matchedItems.length} items into order ${existingPendiente.numero_pedido}`)
                } else {
                    const pedidoId = await createOrderFromEmail(db, clienteId!, parseResult.items, emailData, fechaHoy, vendedorId, facturacionOverride)
                    pedidoIds.push(pedidoId)
                    console.log(`[EmailOrderProcessor] ✅ Auto-created order from "${fileName}": ${pedidoId}`)
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Error auto-creating'
                console.error(`[EmailOrderProcessor] Error auto-creating from "${fileName}":`, msg)
                errors.push(`${fileName}: ${msg}`)
                // Fall through to save as import
                try {
                    const importId = await saveEmailToImports(db, emailData, clienteId, parseResult, fileName)
                    importIds.push(importId)
                } catch (e2) {
                    errors.push(`${fileName} (import fallback): ${e2 instanceof Error ? e2.message : 'Error'}`)
                }
            }
        } else {
            if (!clienteId) {
                console.log(`[EmailOrderProcessor] ⚠️ No client found — sending to review: "${fileName}"`)
            } else if (unmatchedItems.length > 0) {
                console.log(`[EmailOrderProcessor] ⚠️ ${unmatchedItems.length} articles NOT matched perfectly — sending to review: "${fileName}"`)
            } else {
                console.log(`[EmailOrderProcessor] ⚠️ Sending to review: "${fileName}"`)
            }
            try {
                const importId = await saveEmailToImports(db, emailData, clienteId, parseResult, fileName)
                importIds.push(importId)
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Error saving import'
                errors.push(`${fileName}: ${msg}`)
            }
        }
    }

    return {
        processed: true,
        autoCreated: pedidoIds.length > 0,
        pedidoId: pedidoIds[0],
        pedidoIds,
        importId: importIds[0],
        itemsDetected: totalItems,
        ordersCreated: pedidoIds.length,
        ordersSentToReview: importIds.length,
        needsReview: importIds.length > 0,
        clienteFound,
        errors,
    }
}

// ── Helper: Create order automatically ─────────────────
async function createOrderFromEmail(
    db: ReturnType<typeof getSupabaseAdmin>,
    clienteId: string,
    items: ParseResult['items'],
    emailData: ParsedEmail,
    fechaHoy: string,
    vendedorId?: string | null,
    facturacionOverride?: string | null
) {
    // 1. Generate order number (numeric-only)
    const { getNextOrderNumber } = await import('@/lib/utils/next-order-number')
    const numeroPedido = await getNextOrderNumber(db)

    // 2. Get client info
    const { data: cliente, error: clienteError } = await db
        .from('clientes')
        .select('*')
        .eq('id', clienteId)
        .single()

    if (clienteError || !cliente) {
        throw new Error(`Cliente no encontrado: ${clienteId}`)
    }

    // 3. Process items and totals
    let subtotal = 0
    const matchedItems = items.filter(item => item.matchedProduct && item.matchedProduct.id)
    const unmatchedItems = items.filter(item => !item.matchedProduct || !item.matchedProduct.id)

    if (matchedItems.length === 0) {
        throw new Error(`No hay artículos válidos — ${unmatchedItems.length} artículo(s) no pudieron ser identificados en la base de datos`)
    }

    // Fetch authoritative prices from DB to avoid null fields and 0 prices from vector searches
    const matchedIds = matchedItems.map(i => i.matchedProduct.id)
    console.log(`[createOrderFromEmail] Fetching prices for ${matchedIds.length} matched articles:`, matchedIds)
    const { data: fullArticles } = await db
        .from('articulos')
        .select('id, precio_compra, ultimo_costo, precio_venta')
        .in('id', matchedIds)

    const articlesMap = new Map(fullArticles?.map(a => [a.id, a]) || [])

    const processedItems = matchedItems.map(item => {
        const p = item.matchedProduct
        const dbArt = articlesMap.get(p.id) || {}

        const actPrecioBase = dbArt.precio_compra ?? dbArt.precio_venta ?? p.precio_compra ?? p.precio_venta ?? 0
        const actPrecioCosto = dbArt.ultimo_costo ?? dbArt.precio_compra ?? p.ultimo_costo ?? p.precio_compra ?? 0

        const itemSubtotal = item.quantity * actPrecioBase
        subtotal += itemSubtotal
        return {
            producto_id: p.id,
            cantidad: item.quantity,
            precio_base: actPrecioBase,
            precio_final: actPrecioBase,
            subtotal: itemSubtotal,
            precio_costo: actPrecioCosto,
        }
    })

    if (processedItems.length === 0) {
        throw new Error('No hay artículos válidos para crear el pedido')
    }

    // Build note for unmatched items
    let unmatchedNote = ''
    if (unmatchedItems.length > 0) {
        const unmatchedList = unmatchedItems.map(i => `${i.quantity}x ${i.originalText}`).join(', ')
        unmatchedNote = ` | ⚠️ ${unmatchedItems.length} artículo(s) no matcheados: ${unmatchedList}`
    }

    const iva = cliente.condicion_iva === 'responsable_inscripto' ? 0 : subtotal * 0.21
    const percepciones = cliente.aplica_percepciones ? subtotal * 0.03 : 0
    const total = subtotal + iva + percepciones

    // 4. Insert order — use Argentina date
    const { data: pedido, error: pedidoError } = await db.from('pedidos').insert({
        numero_pedido: numeroPedido,
        cliente_id: clienteId,
        vendedor_id: vendedorId || cliente.vendedor_id,
        fecha: fechaHoy,
        estado: 'pendiente',
        subtotal,
        descuento_general: 0,
        total_flete: 0,
        total_impuestos: iva + percepciones,
        total,
        metodo_facturacion_pedido: facturacionOverride || null,
        observaciones: `Importado automáticamente desde Gmail — Asunto: "${emailData.subject}" — De: ${emailData.from}${unmatchedNote}`,
    }).select().single()

    if (pedidoError) throw pedidoError

    // 5. Insert details
    const details = processedItems.map(item => ({
        pedido_id: pedido.id,
        articulo_id: item.producto_id,
        cantidad: item.cantidad,
        precio_base: item.precio_base,
        precio_final: item.precio_final,
        subtotal: item.subtotal,
        precio_costo: item.precio_costo,
    }))

    const { error: detailsError } = await db.from('pedidos_detalle').insert(details)
    if (detailsError) throw detailsError

    return pedido.id
}

// ── Helper: Accumulate items into an existing pending order ──
async function accumulateIntoOrder(
    db: ReturnType<typeof getSupabaseAdmin>,
    pedidoId: string,
    items: ParseResult['items'],
    facturacionOverride?: string | null
) {
    const matchedItems = items.filter(i => i.matchedProduct && i.matchedProduct.id)
    if (matchedItems.length === 0) return

    // Fetch current items in the order
    const { data: existingItems } = await db
        .from('pedidos_detalle')
        .select('id, articulo_id, cantidad, precio_base, precio_final, subtotal, precio_costo')
        .eq('pedido_id', pedidoId)

    // Fetch authoritative prices
    const matchedIds = matchedItems.map(i => i.matchedProduct.id)
    const { data: fullArticles } = await db
        .from('articulos')
        .select('id, precio_compra, ultimo_costo, precio_venta')
        .in('id', matchedIds)
    const articlesMap = new Map(fullArticles?.map(a => [a.id, a]) || [])

    let addedSubtotal = 0

    for (const item of matchedItems) {
        const p = item.matchedProduct
        const dbArt = articlesMap.get(p.id) || {} as any
        const actPrecioBase = dbArt.precio_compra ?? dbArt.precio_venta ?? p.precio_compra ?? 0
        const actPrecioCosto = dbArt.ultimo_costo ?? dbArt.precio_compra ?? p.ultimo_costo ?? 0

        // Check if this article already exists in the order
        const existing = (existingItems || []).find((e: any) => e.articulo_id === p.id)

        if (existing) {
            // Update quantity (accumulate)
            const newCantidad = existing.cantidad + item.quantity
            const newSubtotal = newCantidad * actPrecioBase
            await db.from('pedidos_detalle').update({
                cantidad: newCantidad,
                precio_base: actPrecioBase,
                precio_final: actPrecioBase,
                subtotal: newSubtotal,
                precio_costo: actPrecioCosto,
            }).eq('id', existing.id)
            addedSubtotal += item.quantity * actPrecioBase
            console.log(`[AccumulateOrder] Updated ${p.descripcion || p.id}: ${existing.cantidad} → ${newCantidad}`)
        } else {
            // Insert new item
            const itemSubtotal = item.quantity * actPrecioBase
            await db.from('pedidos_detalle').insert({
                pedido_id: pedidoId,
                articulo_id: p.id,
                cantidad: item.quantity,
                precio_base: actPrecioBase,
                precio_final: actPrecioBase,
                subtotal: itemSubtotal,
                precio_costo: actPrecioCosto,
            })
            addedSubtotal += itemSubtotal
            console.log(`[AccumulateOrder] Added new: ${p.descripcion || p.id} x${item.quantity}`)
        }
    }

    // Recalculate order totals
    const { data: allItems } = await db
        .from('pedidos_detalle')
        .select('subtotal')
        .eq('pedido_id', pedidoId)

    const newSubtotal = (allItems || []).reduce((s: number, i: any) => s + (Number(i.subtotal) || 0), 0)
    const updateData: any = { subtotal: newSubtotal, total: newSubtotal }
    if (facturacionOverride) {
        updateData.metodo_facturacion_pedido = facturacionOverride
    }
    await db.from('pedidos').update(updateData).eq('id', pedidoId)
}

// ── Helper: Save to imports for manual review ──────────
async function saveEmailToImports(
    db: ReturnType<typeof getSupabaseAdmin>,
    emailData: ParsedEmail,
    clienteId: string | null,
    result: ParseResult,
    fileName: string
) {
    // 1. Create import record
    const { data: importRec, error: importError } = await db.from('imports').insert({
        type: 'auto_order_gmail',
        status: 'pending',
        meta: {
            source: 'gmail',
            sender: emailData.from,
            sender_name: emailData.fromName,
            subject: emailData.subject,
            file_name: fileName,
            cliente_id: clienteId,
            cliente_nombre: result.candidateCustomerData?.razon_social || null,
            candidate_customer: result.candidateCustomer,
            total_items: result.totalDetected,
            needs_review: result.needsReview,
            gmail_id: emailData.gmailId,
        }
    }).select().single()

    if (importError) throw importError

    // 2. Create import items
    const items = result.items.map((item) => ({
        import_id: importRec.id,
        raw_data: {
            description: item.originalText,
            quantity: item.quantity,
        },
        status: item.confidence === 'HIGH' ? 'matched' : 'pending',
        candidate_sku_id: item.matchedProduct?.id || null,
        match_confidence: item.confidence === 'HIGH' ? 0.95 : (item.confidence === 'MEDIUM' ? 0.75 : 0.4),
        match_method: 'ai_vector',
    }))

    const { error: itemsError } = await db.from('import_items').insert(items)
    if (itemsError) throw itemsError

    return importRec.id
}
