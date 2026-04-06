// =====================================================
// AI Brain — Email Processor Pipeline
// Unified processing: extract → classify → execute
// =====================================================

import { classifyAndExtract } from './claude'
import { type ParsedEmail, downloadAttachment } from './gmail'
import { getSupabaseAdmin } from './supabase-admin'
import { extractAttachmentContents, uploadToStorage, type AttachmentContent } from './attachment-content-extractor'
// processEmailAsOrder removed — pedidos via Gmail are now manual-only
import { processEmailAsInvoice } from './email-invoice-processor'
import { processEmailAsPayment } from './email-payment-processor'
import { processEmailAsPriceChange } from './email-pricelist-processor'
import { processEmailAsReclamo } from './email-reclamo-processor'
import type { EnrichedClassificationResult } from './types'

// ─── Types ─────────────────────────────────────────────

export interface EmailProcessingResult {
    processed: boolean
    classification: string | null
    emailDbId: string | null
    eventsCreated: number
    ordersProcessed: number
    ordersAutoCreated: number
    ordersSentToReview: number
    invoicesProcessed: number
    paymentsProcessed: number
    priceChangesProcessed: number
    reclamosProcessed: number
    error?: string
}

export interface BatchProcessingResult {
    totalProcessed: number
    newEmails: number
    classified: number
    eventsCreated: number
    ordersProcessed: number
    ordersAutoCreated: number
    ordersSentToReview: number
    invoicesProcessed: number
    paymentsProcessed: number
    priceChangesProcessed: number
    reclamosProcessed: number
    errors: string[]
}

// ─── Helpers ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateEmailStatus(db: any, emailId: string, status: string, error?: string) {
    await db.from('ai_emails').update({
        processing_status: status,
        ...(error ? { processing_error: error } : {}),
    }).eq('id', emailId)
}

function traceLog(traceId: string, stage: string, message: string, extra?: Record<string, unknown>) {
    const payload = { trace_id: traceId, stage, ...extra }
    console.log(`[Email Pipeline] [${traceId}] [${stage}] ${message}`, extra ? JSON.stringify(payload) : '')
}

function traceError(traceId: string, stage: string, message: string, extra?: Record<string, unknown>) {
    const payload = { trace_id: traceId, stage, ...extra }
    console.error(`[Email Pipeline] ❌ [${traceId}] [${stage}] ${message}`, JSON.stringify(payload))
}

// ─── Single Email Processing ───────────────────────────

/**
 * Processes a single incoming email through the UNIFIED pipeline:
 * 1. Check if already processed (dedup by gmail_id)
 * 2. Download and extract TEXT content from ALL attachments (for classification)
 * 3. Classify AND extract data with Claude (text + attachment content)
 * 4. Save to DB (get savedEmailId)
 * 5. Upload attachments to Storage (using savedEmailId)
 * 6. Process based on classification using extracted data
 * 7. Create agenda events
 */
export async function processIncomingEmail(
    emailData: ParsedEmail,
    targetEmail: string
): Promise<EmailProcessingResult> {
    const db = getSupabaseAdmin()
    const traceId = emailData.gmailId

    const result: EmailProcessingResult = {
        processed: false,
        classification: null,
        emailDbId: null,
        eventsCreated: 0,
        ordersProcessed: 0,
        ordersAutoCreated: 0,
        ordersSentToReview: 0,
        invoicesProcessed: 0,
        paymentsProcessed: 0,
        priceChangesProcessed: 0,
        reclamosProcessed: 0,
    }

    // 1. Dedup check — usar maybeSingle para no fallar si hay 0 o duplicados
    const { data: existing } = await db
        .from('ai_emails')
        .select('id')
        .eq('gmail_id', emailData.gmailId)
        .limit(1)
        .maybeSingle()

    if (existing) {
        return result // Already processed — skip
    }

    traceLog(traceId, 'RECEIVED', `Processing: "${emailData.subject}" from ${emailData.from}`, {
        attachments_count: emailData.attachments.length,
        attachment_names: emailData.attachments.map(a => a.filename),
    })

    // 2. Extract TEXT content from ALL attachments (no upload yet — we don't have savedEmailId)
    let extractedAttachments: AttachmentContent[] = []
    let combinedAttachmentText = ''

    if (emailData.attachments.length > 0) {
        traceLog(traceId, 'EXTRACTING', `Extracting content from ${emailData.attachments.length} attachment(s)...`)
        try {
            const extraction = await extractAttachmentContents(emailData, targetEmail)
            extractedAttachments = extraction.attachments
            combinedAttachmentText = extraction.combinedText

            if (extraction.errors.length > 0) {
                traceLog(traceId, 'EXTRACTING', `Extraction warnings: ${extraction.errors.join('; ')}`, { warnings: extraction.errors })
            }

            traceLog(traceId, 'EXTRACTING', `Extracted content from ${extractedAttachments.length}/${emailData.attachments.length} attachment(s) — ${combinedAttachmentText.length} chars total`)
        } catch (err) {
            traceError(traceId, 'EXTRACTING', `Error extracting attachments: ${err instanceof Error ? err.message : err}`, { error: err instanceof Error ? err.stack : String(err) })
        }
    }

    // 3. Unified Classification with Claude (text + attachment content)
    const textForClassification = emailData.bodyText || emailData.subject || ''
    if (!textForClassification.trim() && !combinedAttachmentText.trim()) {
        traceLog(traceId, 'SKIP', 'No text and no attachment content — skipping')
        return result
    }

    traceLog(traceId, 'CLASSIFYING', `Classifying with Claude (${textForClassification.length} chars body + ${combinedAttachmentText.length} chars attachments)...`)

    const classification: EnrichedClassificationResult = await classifyAndExtract(
        textForClassification,
        combinedAttachmentText,
        {
            from: emailData.from || emailData.fromName || undefined,
            to: emailData.to || undefined,
            subject: emailData.subject || undefined,
            attachments: emailData.attachments.map(a => ({
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
            })),
        }
    )

    result.classification = classification.classification

    traceLog(traceId, 'CLASSIFIED', `Classification: ${classification.classification} (confidence: ${classification.confidence}) — "${classification.summary}"`)
    if (classification.attachmentsSummary) {
        traceLog(traceId, 'CLASSIFIED', `Attachments summary: ${classification.attachmentsSummary}`)
    }

    // 4. Save email to DB
    const { data: savedEmail, error: saveError } = await db
        .from('ai_emails')
        .insert({
            gmail_id: emailData.gmailId,
            thread_id: emailData.threadId,
            from_email: emailData.from,
            from_name: emailData.fromName,
            to_email: emailData.to,
            subject: emailData.subject,
            body_text: emailData.bodyText,
            body_html: emailData.bodyHtml,
            received_at: emailData.receivedAt,
            is_read: false,
            is_processed: true,
            labels: emailData.labels,
            classification: classification.classification,
            entity_type: classification.entityType,
            entity_name: classification.entityName,
            confidence: classification.confidence,
            ai_summary: classification.summary,
            processing_status: 'CLASSIFIED',
        })
        .select('id')
        .single()

    if (saveError) {
        traceError(traceId, 'SAVE', `Failed to INSERT into ai_emails: ${saveError.message}`, { errorCode: saveError.code, errorDetails: saveError.details, classification: classification.classification })
        result.error = `Error guardando email ${emailData.gmailId}: ${saveError.message}`
        return result
    }

    result.processed = true
    result.emailDbId = savedEmail.id
    traceLog(traceId, 'SAVED', `Email saved to DB: ${savedEmail.id}`)

    // Update status to SAVED
    await updateEmailStatus(db, savedEmail.id, 'SAVED')

    // Save classification log (with enriched data)
    const { error: classError } = await db.from('ai_classifications').insert({
        source: 'gmail',
        source_ref_id: emailData.gmailId,
        raw_content: textForClassification.substring(0, 2000),
        classification: classification.classification,
        entity_type: classification.entityType,
        entity_name: classification.entityName,
        confidence: classification.confidence,
        extracted_data: {
            ...classification.extractedData,
            invoiceData: classification.invoiceData || undefined,
            paymentData: classification.paymentData || undefined,
            priceListData: classification.priceListData || undefined,
            reclamoData: classification.reclamoData || undefined,
            attachmentsSummary: classification.attachmentsSummary || undefined,
            hasAttachmentContent: classification.hasAttachmentContent,
        },
    })
    if (classError) {
        traceError(traceId, 'CLASSIFICATION_LOG', `Failed to save classification log: ${classError.message}`, { errorCode: classError.code })
    }

    // 5. Upload ALL attachments to Storage + save metadata (NOW we have savedEmail.id)
    // Previously only extracted attachments were uploaded. Now we upload everything
    // so all files are available for preview/download.
    const failedUploads: string[] = []
    for (const att of emailData.attachments) {
        const extracted = extractedAttachments.find(e => e.attachmentId === att.attachmentId)

        let storagePath: string | null = null
        let buffer: Buffer | null = extracted?.rawBuffer || null

        // If no buffer from extraction, download the attachment directly for storage
        if (!buffer && att.attachmentId) {
            try {
                const downloaded = await downloadAttachment(targetEmail, emailData.gmailId, att.attachmentId)
                buffer = downloaded.data
            } catch (dlErr) {
                traceLog(traceId, 'DOWNLOAD', `Could not download ${att.filename} for storage: ${dlErr instanceof Error ? dlErr.message : dlErr}`)
            }
        }

        // Upload to storage with retry (1 retry on failure)
        if (buffer) {
            // Sanitize filename: remove special chars that Supabase storage doesn't like
            const safeFilename = att.filename.replace(/[#?%&{}\\<>*$!'":@+`|=]/g, '_').replace(/\s+/g, ' ').trim() || 'attachment'

            storagePath = await uploadToStorage(buffer, emailData.gmailId, safeFilename, att.mimeType, savedEmail.id) || null

            // Retry once on failure
            if (!storagePath) {
                traceLog(traceId, 'UPLOAD', `Retrying upload for ${att.filename}...`)
                await new Promise(r => setTimeout(r, 1000))
                storagePath = await uploadToStorage(buffer, emailData.gmailId, safeFilename, att.mimeType, savedEmail.id) || null
            }

            if (storagePath) {
                traceLog(traceId, 'UPLOAD', `Uploaded ${att.filename} → ${storagePath}`)
            } else {
                failedUploads.push(att.filename)
            }
        } else {
            failedUploads.push(att.filename)
        }

        // Save attachment metadata (always, even if upload failed)
        const { error: attError } = await db.from('ai_email_attachments').insert({
            email_id: savedEmail.id,
            filename: att.filename,
            mime_type: att.mimeType,
            size_bytes: att.size,
            storage_path: storagePath,
        })
        if (attError) {
            traceError(traceId, 'ATTACHMENT_META', `Failed to save attachment record ${att.filename}: ${attError.message}`, { errorCode: attError.code })
        }
    }

    // Update status — proceed even if uploads failed (warning only)
    if (failedUploads.length > 0) {
        traceLog(traceId, 'ATTACHMENTS', `${failedUploads.length} upload(s) failed: ${failedUploads.join(', ')} — continuing`)
        await updateEmailStatus(db, savedEmail.id, 'SAVED', `Attachment upload failed: ${failedUploads.join(', ')}`)
    } else {
        await updateEmailStatus(db, savedEmail.id, emailData.attachments.length > 0 ? 'ATTACHMENTS_UPLOADED' : 'SAVED')
    }

    // 6. Process based on classification
    const fechaHoy = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).split(',')[0]

    try {
        if (classification.classification === 'pedido') {
            await processAsPedido(db, emailData, targetEmail, savedEmail.id, classification, fechaHoy, result, extractedAttachments)
        } else if (classification.classification === 'factura_proveedor' || classification.classification === 'orden_compra') {
            await processAsInvoice(db, emailData, targetEmail, savedEmail.id, classification, fechaHoy, result, extractedAttachments)
        } else if (classification.classification === 'pago') {
            await processAsPayment(db, emailData, savedEmail.id, classification, fechaHoy, result)
        } else if (classification.classification === 'cambio_precio') {
            await processAsPriceChange(db, emailData, targetEmail, savedEmail.id, classification, fechaHoy, result, extractedAttachments)
        } else if (classification.classification === 'reclamo') {
            await processAsReclamoHandler(db, emailData, savedEmail.id, classification, fechaHoy, result)
        } else {
            // Standard event creation for other classifications
            if (classification.suggestedEvent) {
                const event = classification.suggestedEvent
                const { error: eventError } = await db.from('ai_agenda_events').insert({
                    title: event.title,
                    description: event.description,
                    event_type: event.eventType,
                    priority: event.priority,
                    status: 'pendiente',
                    due_date: event.dueDate || null,
                    source: 'gmail',
                    source_ref_id: savedEmail.id,
                    related_entity_type: classification.entityType !== 'desconocido' ? classification.entityType : null,
                    related_entity_id: null,
                    metadata: {
                        email_subject: emailData.subject,
                        email_from: emailData.from,
                        extracted_data: classification.extractedData,
                    },
                })
                if (eventError) {
                    traceError(traceId, 'EVENT', `Failed to create agenda event: ${eventError.message}`)
                } else {
                    result.eventsCreated++
                }
            }
        }

        // Mark as DONE (keep processing_error as warning if uploads failed)
        await updateEmailStatus(db, savedEmail.id, 'DONE')
        traceLog(traceId, 'DONE', `Pipeline complete — classification: ${classification.classification}, events: ${result.eventsCreated}, orders: ${result.ordersProcessed}${failedUploads.length > 0 ? `, upload warnings: ${failedUploads.join(', ')}` : ''}`)
    } catch (routeError) {
        const errMsg = routeError instanceof Error ? routeError.message : 'Unknown routing error'
        traceError(traceId, 'ROUTING', `Error in classification handler (${classification.classification}): ${errMsg}`, { stack: routeError instanceof Error ? routeError.stack : undefined })
        await updateEmailStatus(db, savedEmail.id, 'FAILED', errMsg)
        result.error = errMsg
    }

    return result
}

// ─── Batch Processing ──────────────────────────────────

/**
 * Processes a batch of emails, aggregating results.
 * Used by both the sync route and the webhook handler.
 */
export async function processBatchEmails(
    emails: ParsedEmail[],
    targetEmail: string
): Promise<BatchProcessingResult> {
    const result: BatchProcessingResult = {
        totalProcessed: emails.length,
        newEmails: 0,
        classified: 0,
        eventsCreated: 0,
        ordersProcessed: 0,
        ordersAutoCreated: 0,
        ordersSentToReview: 0,
        invoicesProcessed: 0,
        paymentsProcessed: 0,
        priceChangesProcessed: 0,
        reclamosProcessed: 0,
        errors: [],
    }

    for (let i = 0; i < emails.length; i++) {
        const emailData = emails[i]
        try {
            const emailResult = await processIncomingEmail(emailData, targetEmail)

            if (emailResult.processed) {
                result.newEmails++
                result.classified++
            }
            result.eventsCreated += emailResult.eventsCreated
            result.ordersProcessed += emailResult.ordersProcessed
            result.ordersAutoCreated += emailResult.ordersAutoCreated
            result.ordersSentToReview += emailResult.ordersSentToReview
            result.invoicesProcessed += emailResult.invoicesProcessed
            result.paymentsProcessed += emailResult.paymentsProcessed
            result.priceChangesProcessed += emailResult.priceChangesProcessed
            result.reclamosProcessed += emailResult.reclamosProcessed

            if (emailResult.error) {
                result.errors.push(emailResult.error)
            }

            // Delay between emails to avoid Claude rate limits (30k tokens/min)
            if (emailResult.processed && i < emails.length - 1) {
                await new Promise(r => setTimeout(r, 3000))
            }
        } catch (emailError) {
            const errMsg = emailError instanceof Error ? emailError.message : 'Unknown error'
            result.errors.push(`Error procesando email ${emailData.gmailId}: ${errMsg}`)
        }
    }

    return result
}

// ─── Classification-specific handlers ──────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAsPedido(db: any, emailData: ParsedEmail, _targetEmail: string, savedEmailId: string, classification: EnrichedClassificationResult, fechaHoy: string, result: EmailProcessingResult, _extractedAttachments: AttachmentContent[]) {
    // Pedidos via Gmail are NO LONGER auto-processed.
    // They are logged as agenda events so the user can import them manually from /clientes-pedidos.
    console.log(`[Email Pipeline] Email classified as PEDIDO — skipping auto-processing (manual import required)`)

    const senderLabel = emailData.fromName || emailData.from || 'Remitente desconocido'
    const attachmentCount = emailData.attachments.length

    await db.from('ai_agenda_events').insert({
        title: `📥 Pedido recibido por email — ${senderLabel}`,
        description: `Se recibió un pedido de "${senderLabel}" con asunto "${emailData.subject}".${attachmentCount > 0 ? ` Tiene ${attachmentCount} adjunto(s).` : ''} Importar manualmente desde /clientes-pedidos usando el botón "Nuevo Pedido".`,
        event_type: 'pedido_preparar',
        priority: 'alta',
        status: 'pendiente',
        due_date: fechaHoy,
        source: 'gmail',
        source_ref_id: savedEmailId,
        related_entity_type: classification.entityType !== 'desconocido' ? classification.entityType : null,
        metadata: {
            email_subject: emailData.subject,
            email_from: emailData.from,
            manual_import_required: true,
            attachment_count: attachmentCount,
            entity_name: classification.entityName,
        },
    })
    result.eventsCreated++
    result.ordersProcessed++
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAsInvoice(db: any, emailData: ParsedEmail, targetEmail: string, savedEmailId: string, classification: EnrichedClassificationResult, fechaHoy: string, result: EmailProcessingResult, extractedAttachments: AttachmentContent[]) {
    console.log(`[Email Pipeline] Email classified as FACTURA — processing invoice from: ${emailData.from}`)
    console.log(`[Email Pipeline] InvoiceData from classifier: ${classification.invoiceData ? JSON.stringify(classification.invoiceData).substring(0, 200) : 'none'}`)
    try {
        // Pass Claude's extracted invoice data and pre-downloaded attachments (for XLSX)
        const invoiceResult = await processEmailAsInvoice(emailData, targetEmail, savedEmailId, classification.invoiceData, extractedAttachments)
        result.invoicesProcessed++
        console.log(`[Email Pipeline] Invoice result: comprobanteCreated=${invoiceResult.comprobanteCreated}, ccMovementCreated=${invoiceResult.ccMovementCreated}, proveedorFound=${invoiceResult.proveedorFound}, error=${invoiceResult.error || 'none'}`)

        if (invoiceResult.comprobanteCreated) {
            await db.from('ai_agenda_events').insert({
                title: `🧾 Factura cargada — ${invoiceResult.proveedorName || emailData.fromName || emailData.from}`,
                description: `Se cargó automáticamente ${invoiceResult.invoiceData?.tipo_comprobante || 'comprobante'} ${invoiceResult.invoiceData?.numero_comprobante || ''} por $${invoiceResult.invoiceData?.total?.toLocaleString('es-AR') || '?'} vinculado a OC.${invoiceResult.invoiceData?.fecha_vencimiento ? ` Vence: ${invoiceResult.invoiceData.fecha_vencimiento}` : ''}`,
                event_type: 'vencimiento_proveedor',
                priority: 'alta',
                status: 'pendiente',
                due_date: invoiceResult.invoiceData?.fecha_vencimiento || fechaHoy,
                source: 'gmail',
                source_ref_id: savedEmailId,
                related_entity_type: 'proveedor',
                related_entity_id: invoiceResult.proveedorId,
                metadata: { email_subject: emailData.subject, email_from: emailData.from, invoice: invoiceResult.invoiceData, comprobante_id: invoiceResult.comprobanteId },
            })
            result.eventsCreated++
        } else if (invoiceResult.ccMovementCreated) {
            await db.from('ai_agenda_events').insert({
                title: `🧾 Factura de servicio — ${invoiceResult.proveedorName || emailData.fromName || emailData.from}`,
                description: `Se registró automáticamente en la cuenta corriente del proveedor: ${invoiceResult.invoiceData?.tipo_comprobante || ''} ${invoiceResult.invoiceData?.numero_comprobante || ''} por $${invoiceResult.invoiceData?.total?.toLocaleString('es-AR') || '?'}.${invoiceResult.invoiceData?.fecha_vencimiento ? ` Vence: ${invoiceResult.invoiceData.fecha_vencimiento}` : ''}`,
                event_type: 'vencimiento_proveedor',
                priority: 'alta',
                status: 'pendiente',
                due_date: invoiceResult.invoiceData?.fecha_vencimiento || fechaHoy,
                source: 'gmail',
                source_ref_id: savedEmailId,
                related_entity_type: 'proveedor',
                related_entity_id: invoiceResult.proveedorId,
                metadata: { email_subject: emailData.subject, email_from: emailData.from, invoice: invoiceResult.invoiceData, is_service: true },
            })
            result.eventsCreated++
        } else if (invoiceResult.error) {
            await db.from('ai_agenda_events').insert({
                title: `⚠️ Factura requiere revisión — ${emailData.fromName || emailData.from}`,
                description: `Se recibió una factura pero no se pudo procesar automáticamente: ${invoiceResult.error}`,
                event_type: 'vencimiento_proveedor',
                priority: 'alta',
                status: 'pendiente',
                due_date: fechaHoy,
                source: 'gmail',
                source_ref_id: savedEmailId,
                metadata: { email_subject: emailData.subject, email_from: emailData.from, error: invoiceResult.error },
            })
            result.eventsCreated++
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        result.error = `Error procesando factura: ${msg}`
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAsPayment(db: any, emailData: ParsedEmail, savedEmailId: string, classification: EnrichedClassificationResult, fechaHoy: string, result: EmailProcessingResult) {
    console.log(`[Email Pipeline] Email classified as PAGO — processing payment...`)
    try {
        // Use Claude's enriched payment data instead of just extractedData
        const paymentData = classification.paymentData
        const paymentResult = await processEmailAsPayment(
            emailData,
            {
                amount: paymentData?.monto || classification.extractedData?.amount,
                referenceNumber: paymentData?.numero_referencia || classification.extractedData?.referenceNumber,
                entityType: paymentData?.pagador_tipo || classification.entityType,
                entityName: paymentData?.pagador_nombre || classification.entityName || undefined,
                date: paymentData?.fecha_pago || classification.extractedData?.date,
                medioPago: paymentData?.medio_pago || undefined,
                banco: paymentData?.banco || undefined,
            },
            savedEmailId
        )
        result.paymentsProcessed++

        if (paymentResult.paymentCreated) {
            await db.from('ai_agenda_events').insert({
                title: `💰 Pago registrado — ${paymentResult.entityName || emailData.fromName || emailData.from}`,
                description: `Se registró un pago de $${paymentResult.amount?.toLocaleString('es-AR') || '?'} de ${paymentResult.entityType === 'cliente' ? 'cliente' : 'proveedor'} ${paymentResult.entityName || ''}.${paymentData?.medio_pago ? ` Medio: ${paymentData.medio_pago}.` : ''}${paymentData?.banco ? ` Banco: ${paymentData.banco}.` : ''}`,
                event_type: 'pago_imputar',
                priority: 'media',
                status: 'pendiente',
                due_date: fechaHoy,
                source: 'gmail',
                source_ref_id: savedEmailId,
                related_entity_type: paymentResult.entityType !== 'desconocido' ? paymentResult.entityType : null,
                related_entity_id: paymentResult.entityId,
                metadata: { email_subject: emailData.subject, email_from: emailData.from, amount: paymentResult.amount, entity_type: paymentResult.entityType, payment_data: paymentData },
            })
            result.eventsCreated++
        } else {
            const event = classification.suggestedEvent
            if (event) {
                await db.from('ai_agenda_events').insert({
                    title: event.title,
                    description: event.description + (paymentResult.error ? ` (Error: ${paymentResult.error})` : ''),
                    event_type: event.eventType,
                    priority: event.priority,
                    status: 'pendiente',
                    due_date: event.dueDate || null,
                    source: 'gmail',
                    source_ref_id: savedEmailId,
                    metadata: { email_subject: emailData.subject, email_from: emailData.from, error: paymentResult.error },
                })
                result.eventsCreated++
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        result.error = `Error procesando pago: ${msg}`
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAsPriceChange(db: any, emailData: ParsedEmail, targetEmail: string, savedEmailId: string, classification: EnrichedClassificationResult, fechaHoy: string, result: EmailProcessingResult, extractedAttachments: AttachmentContent[]) {
    console.log(`[Email Pipeline] Email classified as CAMBIO_PRECIO — processing...`)
    try {
        // Pass Claude's extracted price list data and pre-downloaded attachments (for XLSX deep analysis)
        const priceResult = await processEmailAsPriceChange(emailData, targetEmail, savedEmailId, classification.priceListData, extractedAttachments)
        result.priceChangesProcessed++

        if (priceResult.importCreated) {
            await db.from('ai_agenda_events').insert({
                title: `📊 Cambio de precios — ${priceResult.proveedorName || emailData.fromName || emailData.from}`,
                description: `Se recibió una nueva lista de precios${priceResult.proveedorName ? ` de ${priceResult.proveedorName}` : ''}.${priceResult.fechaVigencia ? ` Vigencia: ${priceResult.fechaVigencia}.` : ''} Importación pendiente — ir a /articulos para aplicar.`,
                event_type: 'cambio_precio',
                priority: 'alta',
                status: 'pendiente',
                due_date: priceResult.fechaVigencia || fechaHoy,
                source: 'gmail',
                source_ref_id: savedEmailId,
                related_entity_type: 'proveedor',
                related_entity_id: priceResult.proveedorId,
                metadata: { email_subject: emailData.subject, email_from: emailData.from, import_id: priceResult.importId, fecha_vigencia: priceResult.fechaVigencia, proveedor_id: priceResult.proveedorId },
            })
            result.eventsCreated++
        } else {
            const event = classification.suggestedEvent
            if (event) {
                await db.from('ai_agenda_events').insert({
                    title: event.title,
                    description: event.description + (priceResult.error ? ` (Error: ${priceResult.error})` : ''),
                    event_type: event.eventType,
                    priority: event.priority,
                    status: 'pendiente',
                    due_date: event.dueDate || null,
                    source: 'gmail',
                    source_ref_id: savedEmailId,
                    metadata: { email_subject: emailData.subject, email_from: emailData.from },
                })
                result.eventsCreated++
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        result.error = `Error procesando cambio de precios: ${msg}`
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAsReclamoHandler(db: any, emailData: ParsedEmail, savedEmailId: string, classification: EnrichedClassificationResult, fechaHoy: string, result: EmailProcessingResult) {
    console.log(`[Email Pipeline] Email classified as RECLAMO — processing complaint...`)
    try {
        const reclamoResult = await processEmailAsReclamo(emailData, classification.reclamoData, savedEmailId)
        result.reclamosProcessed++

        if (!reclamoResult.reclamoCreated && !reclamoResult.error) {
            // Fallback: create a generic event
            if (classification.suggestedEvent) {
                const event = classification.suggestedEvent
                await db.from('ai_agenda_events').insert({
                    title: event.title,
                    description: event.description,
                    event_type: event.eventType,
                    priority: event.priority,
                    status: 'pendiente',
                    due_date: event.dueDate || fechaHoy,
                    source: 'gmail',
                    source_ref_id: savedEmailId,
                    metadata: { email_subject: emailData.subject, email_from: emailData.from },
                })
                result.eventsCreated++
            }
        } else if (reclamoResult.reclamoCreated) {
            result.eventsCreated++
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        result.error = `Error procesando reclamo: ${msg}`
    }
}
