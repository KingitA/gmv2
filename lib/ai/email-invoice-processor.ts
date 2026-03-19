// =====================================================
// AI Brain — Email Invoice Processor
// Processes supplier invoices from emails
// =====================================================

import { downloadAttachment, type ParsedEmail } from './gmail'
import { analyzeXlsxInvoice } from './claude-xlsx-analyzer'
import type { AttachmentContent } from './attachment-content-extractor'
import { getSupabaseAdmin } from './supabase-admin'
import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(apiKey)

export interface InvoiceProcessingResult {
    processed: boolean
    comprobanteCreated: boolean
    comprobanteId?: string
    ccMovementCreated: boolean
    ccMovementId?: string
    isService: boolean
    proveedorFound: boolean
    proveedorId?: string
    proveedorName?: string
    invoiceData?: ParsedInvoiceData
    error?: string
}

interface ParsedInvoiceData {
    tipo_comprobante: string | null
    numero_comprobante: string | null
    fecha_comprobante: string | null
    fecha_vencimiento: string | null
    cuit_emisor: string | null
    razon_social_emisor: string | null
    total: number | null
    subtotal_neto: number | null
    iva: number | null
    percepciones: number | null
    concepto: string | null
}

/**
 * Procesa un email clasificado como factura/orden_compra:
 * 1. Uses pre-extracted invoice data from Claude if available
 * 2. Falls back to parsing attachments with Gemini if needed
 * 3. Busca el proveedor por CUIT, email, o nombre
 * 4. Busca si hay una OC pendiente del proveedor
 * 5. Si hay OC → crea comprobante_compra vinculado
 * 6. Si no hay OC (servicio) → crea movimiento en cuenta_corriente_proveedores
 */
export async function processEmailAsInvoice(
    emailData: ParsedEmail,
    emailAccountAddress: string,
    savedEmailId: string,
    preExtractedData?: import('./types').ExtractedInvoiceData,
    preDownloadedAttachments?: AttachmentContent[]
): Promise<InvoiceProcessingResult> {
    const db = getSupabaseAdmin()
    const fechaHoy = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).split(',')[0]

    console.log(`[InvoiceProcessor] Processing invoice email: "${emailData.subject}" from ${emailData.from}`)

    // ── 1. Get invoice data ─────────────────────────────
    let invoiceData: ParsedInvoiceData | null = null

    // Priority 1: Use pre-extracted data from Claude unified classifier
    if (preExtractedData && (preExtractedData.total || preExtractedData.numero_comprobante)) {
        invoiceData = preExtractedData
        console.log(`[InvoiceProcessor] ✅ Using Claude pre-extracted data: ${invoiceData.tipo_comprobante} ${invoiceData.numero_comprobante} — $${invoiceData.total}`)
    }

    // Priority 2: Try pre-downloaded XLSX attachments via Claude
    if (!invoiceData && preDownloadedAttachments) {
        const xlsxAtts = preDownloadedAttachments.filter(att =>
            att.mimeType.includes('spreadsheet') || att.mimeType.includes('excel') ||
            att.filename.match(/\.xlsx?$/i)
        )
        for (const att of xlsxAtts) {
            try {
                console.log(`[InvoiceProcessor] 🧠 Analyzing XLSX invoice with Claude: ${att.filename}`)
                const xlsxData = await analyzeXlsxInvoice(att.rawBuffer, att.filename)
                if (xlsxData && (xlsxData.total || xlsxData.numero_comprobante)) {
                    invoiceData = xlsxData
                    console.log(`[InvoiceProcessor] ✅ Claude parsed XLSX invoice: ${xlsxData.tipo_comprobante} ${xlsxData.numero_comprobante} — $${xlsxData.total}`)
                    break
                }
            } catch (err) {
                console.error(`[InvoiceProcessor] Error analyzing XLSX: ${att.filename}:`, err instanceof Error ? err.message : err)
            }
        }
    }

    // Priority 3: Parse ALL PDF/image attachments with Gemini OCR
    // ALWAYS run this even if we got data from Priority 1, because the email
    // may contain multiple invoices (e.g. factura + adquisicion de stock)
    const parsedInvoices: ParsedInvoiceData[] = []
    const attachmentBuffers: Map<string, { buffer: Buffer, filename: string, mimeType: string }> = new Map()
    if (emailData.attachments.length > 0) {
        for (const att of emailData.attachments) {
            const validTypes = [
                'application/pdf',
                'image/jpeg', 'image/png', 'image/webp',
                'application/octet-stream',
            ]
            const isValid = validTypes.some(t => att.mimeType.includes(t))
                || att.filename.match(/\.(pdf|jpe?g|png|webp)$/i)

            if (!isValid) continue

            try {
                console.log(`[InvoiceProcessor] Downloading: ${att.filename}`)
                const { data: buffer } = await downloadAttachment(
                    emailAccountAddress,
                    emailData.gmailId,
                    att.attachmentId
                )

                // Store buffer for article-level OCR later
                attachmentBuffers.set(att.filename, { buffer, filename: att.filename, mimeType: att.mimeType })

                const parsed = await parseInvoiceWithGemini(buffer, att.filename, att.mimeType)

                if (parsed && (parsed.total || parsed.numero_comprobante)) {
                    console.log(`[InvoiceProcessor] ✅ Parsed invoice from ${att.filename}: ${parsed.tipo_comprobante} ${parsed.numero_comprobante} — $${parsed.total}`)
                    // Store the filename so we can find the buffer later
                    ;(parsed as any)._sourceFilename = att.filename
                    parsedInvoices.push(parsed)
                }
            } catch (err) {
                console.error(`[InvoiceProcessor] Error processing ${att.filename}:`, err instanceof Error ? err.message : err)
            }
        }
        // Use the first parsed attachment as main invoiceData only if we don't have one yet
        if (!invoiceData && parsedInvoices.length > 0) {
            invoiceData = parsedInvoices[0]
        }
    }

    // If no attachment parsed, try extracting from email body
    if (!invoiceData && emailData.bodyText) {
        try {
            invoiceData = await parseInvoiceFromText(emailData.bodyText)
        } catch (err) {
            console.error(`[InvoiceProcessor] Error parsing body:`, err)
        }
    }

    if (!invoiceData) {
        console.log(`[InvoiceProcessor] Could not parse invoice data from email`)
        return {
            processed: true,
            comprobanteCreated: false,
            ccMovementCreated: false,
            isService: false,
            proveedorFound: false,
            error: 'No se pudo extraer datos de factura del email',
        }
    }

    // ── 2. Find the supplier ──────────────────────────
    // PRIORITY ORDER: Invoice content first, then email metadata
    let proveedorId: string | null = null
    let proveedorName: string | null = null

    // ── Step 1: By CUIT from invoice (most reliable)
    if (invoiceData.cuit_emisor) {
        const cuitClean = invoiceData.cuit_emisor.replace(/[-\s]/g, '')
        console.log(`[InvoiceProcessor] 🔍 Step 1: Searching by CUIT: ${cuitClean}`)

        // Try exact match
        const { data: prov } = await db
            .from('proveedores')
            .select('id, nombre')
            .eq('cuit', cuitClean)
            .maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
            console.log(`[InvoiceProcessor] ✅ Found by CUIT (clean): ${proveedorName}`)
        }

        // Try with dashes format (XX-XXXXXXXX-X)
        if (!proveedorId && cuitClean.length === 11) {
            const cuitFormatted = `${cuitClean.slice(0, 2)}-${cuitClean.slice(2, 10)}-${cuitClean.slice(10)}`
            const { data: prov2 } = await db
                .from('proveedores')
                .select('id, nombre')
                .eq('cuit', cuitFormatted)
                .maybeSingle()
            if (prov2) {
                proveedorId = prov2.id
                proveedorName = prov2.nombre
                console.log(`[InvoiceProcessor] ✅ Found by CUIT (formatted): ${proveedorName}`)
            }
        }

        // Try ILIKE for partial CUIT matches
        if (!proveedorId) {
            const { data: prov3 } = await db
                .from('proveedores')
                .select('id, nombre')
                .ilike('cuit', `%${cuitClean}%`)
                .limit(1)
                .maybeSingle()
            if (prov3) {
                proveedorId = prov3.id
                proveedorName = prov3.nombre
                console.log(`[InvoiceProcessor] ✅ Found by CUIT (partial): ${proveedorName}`)
            }
        }

        if (!proveedorId) console.log(`[InvoiceProcessor] ❌ Not found by CUIT`)
    }

    // ── Step 2: By razón social from invoice (content of the actual document)
    if (!proveedorId && invoiceData.razon_social_emisor) {
        const razonSocial = invoiceData.razon_social_emisor.trim()
        console.log(`[InvoiceProcessor] 🔍 Step 2: Searching by razón social: "${razonSocial}"`)

        // Try full name first
        const { data: prov } = await db
            .from('proveedores')
            .select('id, nombre')
            .ilike('nombre', `%${razonSocial}%`)
            .limit(1)
            .maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
            console.log(`[InvoiceProcessor] ✅ Found by razón social (full): ${proveedorName}`)
        }

        // Try word-by-word (e.g., "CUSAT - Custodia Satelital" → search "CUSAT", then "Custodia", etc.)
        if (!proveedorId) {
            const words = razonSocial
                .replace(/[-–—_\.]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 3)
                .filter(w => !['S.A.', 'S.R.L.', 'SRL', 'S.A', 'SA', 'SAS', 'CIA', 'INC', 'LTD', 'LTDA', 'THE', 'DEL', 'LOS', 'LAS', 'POR', 'PARA', 'CON'].includes(w.toUpperCase()))

            for (const word of words) {
                const { data: provWord } = await db
                    .from('proveedores')
                    .select('id, nombre')
                    .ilike('nombre', `%${word}%`)
                    .limit(1)
                    .maybeSingle()
                if (provWord) {
                    proveedorId = provWord.id
                    proveedorName = provWord.nombre
                    console.log(`[InvoiceProcessor] ✅ Found by razón social word "${word}": ${proveedorName}`)
                    break
                }
            }
        }

        if (!proveedorId) console.log(`[InvoiceProcessor] ❌ Not found by razón social`)
    }

    // ── Step 3: By email subject keywords (e.g., "Fwd: CUSAT" → search "CUSAT")
    if (!proveedorId && emailData.subject) {
        console.log(`[InvoiceProcessor] 🔍 Step 3: Searching by subject: "${emailData.subject}"`)
        const subjectClean = emailData.subject
            .replace(/^(fwd?|re|rv|reenviado|reenviar)\s*:\s*/gi, '')
            .replace(/factura|boleta|comprobante|pago|vencimiento|aviso|tu\s|electronica?|nuevo|servicios?\s+fiscales/gi, '')
            .trim()
        const words = subjectClean.split(/\s+/).filter(w => w.length >= 3)
        for (const word of words) {
            const { data: prov } = await db
                .from('proveedores')
                .select('id, nombre')
                .ilike('nombre', `%${word}%`)
                .limit(1)
                .maybeSingle()
            if (prov) {
                proveedorId = prov.id
                proveedorName = prov.nombre
                console.log(`[InvoiceProcessor] ✅ Found by subject keyword "${word}": ${proveedorName}`)
                break
            }
        }
        if (!proveedorId) console.log(`[InvoiceProcessor] ❌ Not found by subject keywords`)
    }

    // ── Step 4: By email domain (last resort, skip generic domains)
    if (!proveedorId && emailData.from) {
        const domainMatch = emailData.from.match(/@([^.]+)\./i)
        if (domainMatch && domainMatch[1].length >= 3) {
            const domainName = domainMatch[1]
            const genericDomains = ['gmail', 'hotmail', 'outlook', 'yahoo', 'live', 'mail', 'icloud', 'protonmail']
            if (!genericDomains.includes(domainName.toLowerCase())) {
                console.log(`[InvoiceProcessor] 🔍 Step 4: Searching by email domain: "${domainName}"`)
                const { data: prov } = await db
                    .from('proveedores')
                    .select('id, nombre')
                    .ilike('nombre', `%${domainName}%`)
                    .limit(1)
                    .maybeSingle()
                if (prov) {
                    proveedorId = prov.id
                    proveedorName = prov.nombre
                    console.log(`[InvoiceProcessor] ✅ Found by email domain: ${proveedorName}`)
                }
            }
        }
    }

    // ── Step 5: By sender name (fromName)
    if (!proveedorId && emailData.fromName) {
        console.log(`[InvoiceProcessor] 🔍 Step 5: Searching by sender name: "${emailData.fromName}"`)
        const { data: prov } = await db
            .from('proveedores')
            .select('id, nombre')
            .ilike('nombre', `%${emailData.fromName}%`)
            .limit(1)
            .maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
            console.log(`[InvoiceProcessor] ✅ Found by sender name: ${proveedorName}`)
        }
    }

    if (!proveedorId) {
        const errorMsg = `No se encontró el proveedor. Búsqueda: CUIT=${invoiceData.cuit_emisor || 'N/A'}, Razón Social=${invoiceData.razon_social_emisor || 'N/A'}, Email=${emailData.from || 'N/A'}`
        console.log(`[InvoiceProcessor] ❌ ${errorMsg}`)

        try {
            // Create a general task in the agenda so the user manually loads this invoice
            await db.from('ai_agenda_events').insert({
                title: `Factura pendiente de ${invoiceData.razon_social_emisor || emailData.fromName || emailData.from}`,
                description: `Se detectó una factura pero no se pudo identificar de qué proveedor es.\n\n` +
                    `Monto: $${invoiceData.total || 'N/A'}\n` +
                    `Comprobante: ${invoiceData.tipo_comprobante || ''} ${invoiceData.numero_comprobante || 'N/A'}\n` +
                    `CUIT Extraído: ${invoiceData.cuit_emisor || 'N/A'}\n\n` +
                    `Por favor, buscala en tu correo ("${emailData.subject}") y cargala manualmente.`,
                event_type: 'tarea_general',
                priority: 'alta',
                status: 'pendiente',
                source: 'gmail',
                source_ref_id: savedEmailId,
                metadata: {
                    error: 'proveedor_not_found',
                    invoiceData
                }
            })
            console.log(`[InvoiceProcessor] 📝 Created agenda event for unmatched invoice.`)
        } catch (agendaErr) {
            console.error('[InvoiceProcessor] Failed to create agenda event for unmatched invoice', agendaErr)
        }

        return {
            processed: true,
            comprobanteCreated: false,
            ccMovementCreated: false,
            isService: false,
            proveedorFound: false,
            invoiceData,
            error: errorMsg,
        }
    }

    console.log(`[InvoiceProcessor] Found supplier: ${proveedorName} (${proveedorId})`)

    // ── 3. Check for purchase orders that need invoices ──────────
    // A factura can arrive AFTER the merchandise was received.
    // Look for any OC that is not finalized/cancelled.
    const { data: pendingOC } = await db
        .from('ordenes_compra')
        .select('id, numero_orden, estado')
        .eq('proveedor_id', proveedorId)
        .not('estado', 'in', '("finalizada","cancelada")')
        .order('fecha_orden', { ascending: false })
        .limit(1)
        .maybeSingle()

    // ── 4. Create comprobante or CC movement ──────────
    const tipoComp = mapTipoComprobante(invoiceData.tipo_comprobante)

    if (pendingOC) {
        // Has a pending purchase order → create comprobante_compra linked to OC
        console.log(`[InvoiceProcessor] Found pending OC: ${pendingOC.numero_orden}`)

        try {
            const { data: comprobante, error } = await db.from('comprobantes_compra').insert({
                orden_compra_id: pendingOC.id,
                tipo_comprobante: tipoComp,
                numero_comprobante: invoiceData.numero_comprobante || `GMAIL-${Date.now()}`,
                fecha_comprobante: invoiceData.fecha_comprobante || fechaHoy,
                proveedor_id: proveedorId,
                total_factura_declarado: invoiceData.total || 0,
                total_calculado: 0,
                descuento_fuera_factura: 0,
                estado: 'pendiente_recepcion',
                diferencia_centavos: 0,
            }).select().single()

            if (error) throw error

            // Update the existing OC movement in CC to become the factura
            // (instead of creating a new one, which would duplicate the debt)
            const isCredit = ['NCA', 'NCB', 'NCC'].includes(tipoComp)
            const monto = invoiceData.total || 0
            const montoFinal = isCredit ? -Math.abs(monto) : Math.abs(monto)
            const descripcion = [tipoComp, invoiceData.numero_comprobante, invoiceData.razon_social_emisor].filter(Boolean).join(' — ')

            // Find existing OC movement in CC
            const { data: existingCC } = await db.from('cuenta_corriente_proveedores')
                .select('id')
                .eq('proveedor_id', proveedorId)
                .eq('referencia_tipo', 'orden_compra')
                .eq('referencia_id', pendingOC.id)
                .limit(1)
                .maybeSingle()

            let ccResult: any = null
            if (existingCC) {
                // Update the OC movement → becomes the factura
                const { data: updated } = await db.from('cuenta_corriente_proveedores')
                    .update({
                        tipo_movimiento: isCredit ? 'nota_credito' : 'factura',
                        monto: montoFinal,
                        descripcion,
                        numero_comprobante: invoiceData.numero_comprobante || null,
                        tipo_comprobante: tipoComp,
                        fecha: invoiceData.fecha_comprobante || fechaHoy,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingCC.id)
                    .select()
                    .single()
                ccResult = updated
                console.log(`[InvoiceProcessor] ✅ Updated CC movement ${existingCC.id} from OC to ${tipoComp}`)
            } else {
                // No existing OC movement found, create new one
                ccResult = await createCCMovement(db, proveedorId, invoiceData, tipoComp, fechaHoy)
            }

            // Calculate and set vencimiento on the CC movement
            if (ccResult && !isCredit) {
                try {
                    const { data: prov } = await db.from('proveedores')
                        .select('plazo_dias, plazo_desde, nombre')
                        .eq('id', proveedorId)
                        .single()

                    const plazoDias = prov?.plazo_dias || 30
                    const plazoDesde = prov?.plazo_desde || 'fecha_factura'

                    let fechaBase = invoiceData.fecha_comprobante || fechaHoy
                    // If plazo is from recepcion, check if there's a finished recepcion
                    if (plazoDesde === 'fecha_recepcion') {
                        const { data: rec } = await db.from('recepciones')
                            .select('fecha_fin')
                            .eq('orden_compra_id', pendingOC.id)
                            .eq('estado', 'finalizada')
                            .limit(1)
                            .maybeSingle()
                        if (rec?.fecha_fin) fechaBase = rec.fecha_fin.split('T')[0]
                    }

                    const fechaVenc = new Date(fechaBase + 'T00:00:00')
                    fechaVenc.setDate(fechaVenc.getDate() + plazoDias)
                    const fechaVencStr = invoiceData.fecha_vencimiento || fechaVenc.toISOString().split('T')[0]

                    // Update CC with vencimiento
                    await db.from('cuenta_corriente_proveedores')
                        .update({ fecha_vencimiento: fechaVencStr })
                        .eq('id', ccResult.id)

                    // Create vencimiento entry
                    await db.from('vencimientos').insert({
                        proveedor_id: proveedorId,
                        tipo: 'factura',
                        concepto: descripcion,
                        monto: montoFinal,
                        fecha_vencimiento: fechaVencStr,
                        estado: 'pendiente',
                        referencia_id: ccResult.id,
                        referencia_tipo: 'cuenta_corriente',
                        dias_alerta: 3,
                    })
                } catch (vErr) {
                    console.error('[InvoiceProcessor] Error creating vencimiento for OC invoice:', vErr)
                }
            }

            console.log(`[InvoiceProcessor] ✅ Created comprobante ${comprobante.id} linked to OC ${pendingOC.numero_orden}`)

            // ── 5. Article-level OCR: extract items from PDF and update recepciones_items
            // Find the recepcion for this OC
            const { data: recepcion } = await db.from('recepciones')
                .select('id')
                .eq('orden_compra_id', pendingOC.id)
                .limit(1)
                .maybeSingle()

            if (recepcion) {
                // Run OCR for the main invoice attachment
                const sourceFile = (invoiceData as any)?._sourceFilename
                const attData = sourceFile ? attachmentBuffers.get(sourceFile) : null
                if (attData) {
                    try {
                        await runArticleLevelOCR(db, recepcion.id, proveedorId, attData.buffer, attData.filename, attData.mimeType, tipoComp, comprobante.id)
                    } catch (ocrErr) {
                        console.error('[InvoiceProcessor] Article OCR error (main):', ocrErr)
                    }
                }
            }

            // Process additional attachments from same email
            // Filter out the one that matches the main invoice (by numero_comprobante)
            const additionalInvoices = parsedInvoices.filter(pi =>
                pi.numero_comprobante !== invoiceData?.numero_comprobante
            )
            if (additionalInvoices.length > 0) {
                for (const addInv of additionalInvoices) {
                    const addTipo = mapTipoComprobante(addInv.tipo_comprobante)
                    try {
                        console.log(`[InvoiceProcessor] Processing additional: ${addTipo} ${addInv.numero_comprobante}`)
                        // Create comprobante_compra for the additional invoice too
                        const { data: addComp } = await db.from('comprobantes_compra').insert({
                            orden_compra_id: pendingOC.id,
                            tipo_comprobante: addTipo,
                            numero_comprobante: addInv.numero_comprobante || `GMAIL-ADD-${Date.now()}`,
                            fecha_comprobante: addInv.fecha_comprobante || fechaHoy,
                            proveedor_id: proveedorId,
                            total_factura_declarado: addInv.total || 0,
                            total_calculado: 0,
                            descuento_fuera_factura: 0,
                            estado: 'pendiente_recepcion',
                            diferencia_centavos: 0,
                        }).select('id').single()
                        // Create CC movement
                        await createCCMovement(db, proveedorId, addInv, addTipo, fechaHoy)
                        // Article-level OCR for additional
                        if (recepcion && addComp) {
                            const addFile = (addInv as any)?._sourceFilename
                            const addAtt = addFile ? attachmentBuffers.get(addFile) : null
                            if (addAtt) {
                                try {
                                    await runArticleLevelOCR(db, recepcion.id, proveedorId, addAtt.buffer, addAtt.filename, addAtt.mimeType, addTipo, addComp.id)
                                } catch (ocrErr) {
                                    console.error('[InvoiceProcessor] Article OCR error (additional):', ocrErr)
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`[InvoiceProcessor] Error processing additional invoice:`, err)
                    }
                }
            }

            return {
                processed: true,
                comprobanteCreated: true,
                comprobanteId: comprobante.id,
                ccMovementCreated: !!ccResult,
                ccMovementId: ccResult?.id,
                isService: false,
                proveedorFound: true,
                proveedorId,
                proveedorName: proveedorName || undefined,
                invoiceData,
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error creating comprobante'
            console.error(`[InvoiceProcessor] Error:`, msg)
            return {
                processed: true,
                comprobanteCreated: false,
                ccMovementCreated: false,
                isService: false,
                proveedorFound: true,
                proveedorId,
                proveedorName: proveedorName || undefined,
                invoiceData,
                error: msg,
            }
        }
    } else {
        // No pending OC → this is a service invoice (gas, internet, etc.)
        console.log(`[InvoiceProcessor] No pending OC — treating as service invoice`)

        try {
            const ccResult = await createCCMovement(db, proveedorId, invoiceData, tipoComp, fechaHoy)

            console.log(`[InvoiceProcessor] ✅ Created CC movement for service invoice: ${ccResult?.id}`)

            // Process additional attachments from same email
            const additionalInvoices = parsedInvoices.filter(pi =>
                pi.numero_comprobante !== invoiceData?.numero_comprobante
            )
            if (additionalInvoices.length > 0) {
                for (const addInv of additionalInvoices) {
                    const addTipo = mapTipoComprobante(addInv.tipo_comprobante)
                    try {
                        console.log(`[InvoiceProcessor] Processing additional service invoice: ${addTipo} ${addInv.numero_comprobante}`)
                        await createCCMovement(db, proveedorId, addInv, addTipo, fechaHoy)
                    } catch (err) {
                        console.error(`[InvoiceProcessor] Error processing additional:`, err)
                    }
                }
            }

            return {
                processed: true,
                comprobanteCreated: false,
                ccMovementCreated: true,
                ccMovementId: ccResult?.id,
                isService: true,
                proveedorFound: true,
                proveedorId,
                proveedorName: proveedorName || undefined,
                invoiceData,
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error creating CC movement'
            console.error(`[InvoiceProcessor] Error:`, msg)
            return {
                processed: true,
                comprobanteCreated: false,
                ccMovementCreated: false,
                isService: true,
                proveedorFound: true,
                proveedorId,
                proveedorName: proveedorName || undefined,
                invoiceData,
                error: msg,
            }
        }
    }

    // ── Process additional attachments (if email had multiple PDFs) ──
    // This runs only for the service/no-OC branch since OC branch already returned
    // For the OC branch, additional invoices would need manual handling
}

// Process extra invoices from multi-attachment emails
async function processAdditionalInvoices(
    db: ReturnType<typeof getSupabaseAdmin>,
    parsedInvoices: ParsedInvoiceData[],
    proveedorId: string,
    fechaHoy: string
) {
    // Skip index 0 (already processed as main invoice)
    for (let i = 1; i < parsedInvoices.length; i++) {
        const inv = parsedInvoices[i]
        const tipoComp = mapTipoComprobante(inv.tipo_comprobante)
        try {
            console.log(`[InvoiceProcessor] Processing additional attachment #${i + 1}: ${tipoComp} ${inv.numero_comprobante}`)
            await createCCMovement(db, proveedorId, inv, tipoComp, fechaHoy)
        } catch (err) {
            console.error(`[InvoiceProcessor] Error processing additional invoice #${i + 1}:`, err)
        }
    }
}
async function parseInvoiceWithGemini(
    buffer: Buffer,
    filename: string,
    mimeType: string
): Promise<ParsedInvoiceData | null> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const base64Data = buffer.toString('base64')
    const geminiMime = mimeType.startsWith('image/') ? mimeType : 'application/pdf'

    const prompt = `Analizá este documento y extraé los datos fiscales de la factura/comprobante.

Respondé SOLO con JSON válido, sin comentarios:
{
  "tipo_comprobante": "FA" | "FB" | "FC" | "NCA" | "NCB" | "NCC" | "NDA" | "NDB" | "NDC" | null,
  "numero_comprobante": "0001-00012345" o similar, o null,
  "fecha_comprobante": "YYYY-MM-DD" o null,
  "fecha_vencimiento": "YYYY-MM-DD" o null,
  "cuit_emisor": "20-12345678-9" o null,
  "razon_social_emisor": "Nombre del emisor" o null,
  "total": número total de la factura o null,
  "subtotal_neto": número neto sin IVA o null,
  "iva": monto de IVA o null,
  "percepciones": monto de percepciones o null,
  "concepto": "producto" | "servicio" | "mixto" | null
}

Si no es una factura/comprobante fiscal, respondé: {"error": "No es un comprobante fiscal"}`

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: geminiMime,
                }
            }
        ])

        const text = result.response.text()
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return null

        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.error) {
            console.log(`[InvoiceProcessor] Gemini: ${parsed.error}`)
            return null
        }
        return parsed as ParsedInvoiceData
    } catch (err) {
        console.error(`[InvoiceProcessor] Gemini parse error:`, err)
        return null
    }
}

// ── Parse invoice data from email body text ────────────
async function parseInvoiceFromText(bodyText: string): Promise<ParsedInvoiceData | null> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `Analizá este texto de email y extraé datos de factura/comprobante si los hay.

TEXTO DEL EMAIL:
${bodyText.substring(0, 3000)}

Respondé SOLO con JSON válido:
{
  "tipo_comprobante": "FA" | "FB" | "FC" | null,
  "numero_comprobante": "0001-00012345" o null,
  "fecha_comprobante": "YYYY-MM-DD" o null,
  "fecha_vencimiento": "YYYY-MM-DD" o null,
  "cuit_emisor": "20-12345678-9" o null,
  "razon_social_emisor": "Nombre" o null,
  "total": número o null,
  "subtotal_neto": null,
  "iva": null,
  "percepciones": null,
  "concepto": "producto" | "servicio" | "mixto" | null
}

Si no hay datos de factura, respondé: {"error": "No se encontraron datos de factura"}`

    try {
        const result = await model.generateContent(prompt)
        const text = result.response.text()
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return null

        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.error) return null
        return parsed as ParsedInvoiceData
    } catch {
        return null
    }
}

// ── Helper: Create CC movement ─────────────────────────
async function createCCMovement(
    db: ReturnType<typeof getSupabaseAdmin>,
    proveedorId: string,
    invoiceData: ParsedInvoiceData,
    tipoComp: string,
    fechaHoy: string
) {
    const isCredit = ['NCA', 'NCB', 'NCC'].includes(tipoComp)
    const monto = invoiceData.total || 0
    const montoFinal = isCredit ? -Math.abs(monto) : Math.abs(monto)

    const descripcion = [
        tipoComp,
        invoiceData.numero_comprobante,
        invoiceData.razon_social_emisor,
    ].filter(Boolean).join(' — ')

    // DEDUP: Check if this exact comprobante already exists in CC
    if (invoiceData.numero_comprobante) {
        const { data: existing } = await db.from('cuenta_corriente_proveedores')
            .select('id')
            .eq('proveedor_id', proveedorId)
            .ilike('descripcion', `%${invoiceData.numero_comprobante}%`)
            .limit(1)

        if (existing && existing.length > 0) {
            console.log(`[InvoiceProcessor] DEDUP: Comprobante ${invoiceData.numero_comprobante} ya existe en CC (${existing[0].id}), skipping`)
            return existing[0]
        }
    }

    const { data, error } = await db.from('cuenta_corriente_proveedores').insert({
        proveedor_id: proveedorId,
        fecha: invoiceData.fecha_comprobante || fechaHoy,
        tipo_movimiento: isCredit ? 'nota_credito' : 'factura',
        monto: montoFinal,
        descripcion: descripcion || 'Factura importada desde Gmail',
        referencia_tipo: 'gmail',
        numero_comprobante: invoiceData.numero_comprobante || null,
        tipo_comprobante: tipoComp,
    }).select().single()

    if (error) throw error

    // Create vencimiento automatically for facturas (not credit notes)
    if (!isCredit && data && montoFinal > 0) {
        try {
            // Get proveedor payment terms
            const { data: prov } = await db.from('proveedores')
                .select('plazo_dias, plazo_desde, nombre, sigla')
                .eq('id', proveedorId)
                .single()

            const plazoDias = prov?.plazo_dias || 30
            const fechaBase = invoiceData.fecha_comprobante || fechaHoy
            const fechaVenc = new Date(fechaBase + 'T00:00:00')
            fechaVenc.setDate(fechaVenc.getDate() + plazoDias)

            // Use fecha_vencimiento from invoice if available, otherwise calculate
            const fechaVencFinal = invoiceData.fecha_vencimiento || fechaVenc.toISOString().split('T')[0]

            const conceptoVenc = `${tipoComp} ${invoiceData.numero_comprobante || ''} — ${invoiceData.razon_social_emisor || prov?.nombre || ''}`.trim()

            await db.from('vencimientos').insert({
                proveedor_id: proveedorId,
                tipo: 'factura',
                concepto: conceptoVenc,
                monto: montoFinal,
                fecha_vencimiento: fechaVencFinal,
                estado: 'pendiente',
                referencia_id: data.id,
                referencia_tipo: 'cuenta_corriente',
                dias_alerta: 3,
            })
        } catch (vencError) {
            console.error('[InvoiceProcessor] Error creating vencimiento:', vencError)
            // Don't throw - vencimiento creation is secondary
        }
    }

    return data
}

// ── Helper: Map invoice type ───────────────────────────
function mapTipoComprobante(tipo: string | null): string {
    if (!tipo) return 'FA'
    const upper = tipo.toUpperCase().replace(/[^A-Z0-9]/g, '')
    // Map common names
    if (upper.includes('PRESUPUESTO') || upper.includes('ADQUISICION') || upper === 'ADQ') return 'ADQ'
    if (upper.includes('NOTA') && upper.includes('CRED')) {
        if (upper.includes('A') || upper.endsWith('A')) return 'NCA'
        if (upper.includes('B') || upper.endsWith('B')) return 'NCB'
        return 'NCA'
    }
    if (upper.includes('NOTA') && upper.includes('DEB')) {
        if (upper.includes('A') || upper.endsWith('A')) return 'NDA'
        return 'NDA'
    }
    const valid = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC', 'ADQ', 'REV']
    return valid.includes(upper) ? upper : 'FA'
}

// ── Article-level OCR for invoices linked to OC ───────────
// Uses Gemini to extract items from the PDF and updates recepciones_items
async function runArticleLevelOCR(
    db: ReturnType<typeof getSupabaseAdmin>,
    recepcionId: string,
    proveedorId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    tipoDocumento: string,
    comprobanteId?: string
) {
    console.log(`[InvoiceProcessor] 🔍 Running article-level OCR on ${filename} for recepcion ${recepcionId}`)

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || ''
    if (!apiKey || !comprobanteId) {
        console.warn('[InvoiceProcessor] No Gemini API key or comprobanteId for article OCR')
        return
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const localGenAI = new GoogleGenerativeAI(apiKey)
    const model = localGenAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const { data: prov } = await db.from('proveedores').select('nombre').eq('id', proveedorId).single()

    const base64 = buffer.toString('base64')
    const geminiMime = mimeType.startsWith('image/') ? mimeType : 'application/pdf'

    const prompt = `Sos un asistente experto en procesamiento de documentos comerciales.
        
CONTEXTO:
- Proveedor: ${prov?.nombre || "Desconocido"}
- Tipo de documento: ${tipoDocumento}

TAREA:
Extraé los ítems de este documento en formato JSON.
Priorizá la exactitud de los códigos y descripciones.

FORMATO JSON ESPERADO:
{
    "items": [
        {
            "codigo": "SKU o código del artículo",
            "descripcion": "Nombre del producto",
            "cantidad": 10,
            "precio_unitario": 150.50,
            "unidad_medida": "UNIDAD o BULTO"
        }
    ]
}

REGLAS:
- Si no ves un código, poné null
- cantidad debe ser numérico
- precio_unitario es el precio por unidad (no por bulto)
- Respondé SOLO con JSON válido, sin comentarios`

    try {
        const result = await model.generateContent([
            { inlineData: { mimeType: geminiMime, data: base64 } },
            { text: prompt }
        ])

        const text = result.response.text()
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return

        const ocrData = JSON.parse(jsonMatch[0])
        if (!ocrData.items || ocrData.items.length === 0) return

        console.log(`[InvoiceProcessor] 📋 Article OCR found ${ocrData.items.length} items`)

        // Get OC articles to match against
        const { data: ocDetalle } = await db.from('ordenes_compra_detalle')
            .select('articulo_id, articulo:articulos(id, sku, descripcion)')
            .eq('orden_compra_id', (await db.from('recepciones').select('orden_compra_id').eq('id', recepcionId).single()).data?.orden_compra_id)

        if (!ocDetalle) return

        // Match OCR items and insert into comprobantes_compra_detalle
        const inserts = []
        let matched = 0

        for (const ocrItem of ocrData.items) {
            const code = String(ocrItem.codigo || '').trim()
            const desc = String(ocrItem.descripcion || '').toLowerCase()
            const qty = Number(ocrItem.cantidad) || 0
            const price = Number(ocrItem.precio_unitario) || 0

            // Match by SKU first
            let match = ocDetalle.find((d: any) => d.articulo?.sku === code)

            // Then by description
            if (!match && desc) {
                match = ocDetalle.find((d: any) => {
                    const artDesc = (d.articulo?.descripcion || '').toLowerCase()
                    return artDesc.includes(desc) || desc.includes(artDesc)
                })
            }

            if (match) {
                inserts.push({
                    comprobante_id: comprobanteId,
                    articulo_id: match.articulo_id,
                    cantidad_facturada: qty,
                    precio_unitario: price,
                    iva_porcentaje: tipoDocumento === 'ADQ' ? 0 : 21,
                    tipo_cantidad: ocrItem.unidad_medida?.toLowerCase() === 'bulto' ? 'bulto' : 'unidad',
                    descripcion_proveedor: ocrItem.descripcion || null,
                    codigo_proveedor: ocrItem.codigo || null,
                })
                matched++
            }
        }

        if (inserts.length > 0) {
            const { error } = await db.from('comprobantes_compra_detalle').insert(inserts)
            if (error) {
                console.error('[InvoiceProcessor] Error inserting comprobante detalle:', error)
            } else {
                console.log(`[InvoiceProcessor] ✅ Saved ${inserts.length} items to comprobantes_compra_detalle`)
            }
        }

        // Also update recepciones_items for backward compatibility
        const { data: recItems } = await db.from('recepciones_items')
            .select('*, articulo:articulos(id, sku)')
            .eq('recepcion_id', recepcionId)

        if (recItems) {
            for (const ins of inserts) {
                const ri = recItems.find((r: any) => r.articulo_id === ins.articulo_id)
                if (ri) {
                    const newDocQty = Number(ri.cantidad_documentada || 0) + ins.cantidad_facturada
                    await db.from('recepciones_items').update({
                        cantidad_documentada: newDocQty,
                        precio_documentado: ins.precio_unitario || ri.precio_documentado || 0,
                    }).eq('id', ri.id)
                    ri.cantidad_documentada = newDocQty
                }
            }
        }

        console.log(`[InvoiceProcessor] ✅ Article OCR: matched ${matched}/${ocrData.items.length}`)

    } catch (err) {
        console.error('[InvoiceProcessor] Article OCR error:', err)
    }
}
