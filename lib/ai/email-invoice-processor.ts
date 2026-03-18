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

    // Priority 3: Fall back to Gemini OCR for images/PDFs
    if (!invoiceData && emailData.attachments.length > 0) {
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

                invoiceData = await parseInvoiceWithGemini(buffer, att.filename, att.mimeType)

                if (invoiceData && (invoiceData.total || invoiceData.numero_comprobante)) {
                    console.log(`[InvoiceProcessor] ✅ Parsed invoice from ${att.filename}: ${invoiceData.tipo_comprobante} ${invoiceData.numero_comprobante} — $${invoiceData.total}`)
                    break
                }
            } catch (err) {
                console.error(`[InvoiceProcessor] Error processing ${att.filename}:`, err instanceof Error ? err.message : err)
            }
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

    // ── 3. Check for pending purchase orders ──────────
    const { data: pendingOC } = await db
        .from('ordenes_compra')
        .select('id, numero_orden, estado')
        .eq('proveedor_id', proveedorId)
        .in('estado', ['pendiente', 'recibida_parcial'])
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

            // Also create CC movement for the debt
            const ccResult = await createCCMovement(db, proveedorId, invoiceData, tipoComp, fechaHoy)

            console.log(`[InvoiceProcessor] ✅ Created comprobante ${comprobante.id} linked to OC ${pendingOC.numero_orden}`)

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
}

// ── Parse invoice with Gemini ──────────────────────────
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
    const upper = tipo.toUpperCase().replace(/[^A-Z]/g, '')
    const valid = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC']
    return valid.includes(upper) ? upper : 'FA'
}
