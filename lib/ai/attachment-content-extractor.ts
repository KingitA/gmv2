// =====================================================
// AI Brain — Attachment Content Extractor
// Downloads and extracts text content from email attachments
// Supports: PDF, Images (OCR), Excel/CSV
// =====================================================

import { downloadAttachment, type ParsedEmail } from './gmail'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getSupabaseAdmin } from './supabase-admin'

// SEGURIDAD: Solo usar variables server-side. NUNCA usar NEXT_PUBLIC_ para API keys.
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(apiKey)

// ─── Types ─────────────────────────────────────────────

export interface AttachmentContent {
    filename: string
    mimeType: string
    extractedText: string     // Text extracted from the file
    rawBuffer: Buffer         // Original buffer for storage/further processing
    storagePath?: string      // Path in Supabase Storage after upload
    attachmentId: string      // Gmail attachment ID for re-download if needed
    sizeBytes: number
}

export interface ExtractionResult {
    attachments: AttachmentContent[]
    combinedText: string     // All attachment texts joined for classification
    errors: string[]
}

// ─── MIME type classification ──────────────────────────

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff']
const PDF_TYPES = ['application/pdf']
const EXCEL_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
]
const SKIP_TYPES = [
    'image/gif', // Typically signatures/logos — small gifs
]

function isDocumentAttachment(att: { filename: string; mimeType: string; size: number }): boolean {
    // Skip tiny images (likely signatures, icons)
    if (att.mimeType.startsWith('image/') && att.size < 5000) return false

    const validTypes = [...IMAGE_TYPES, ...PDF_TYPES, ...EXCEL_TYPES, 'application/octet-stream']
    const isValidType = validTypes.some(t => att.mimeType.includes(t))
    const isValidExt = /\.(pdf|xlsx?|csv|jpe?g|png|webp|tiff?)$/i.test(att.filename)

    return isValidType || isValidExt
}

function getFileCategory(mimeType: string, filename: string): 'image' | 'pdf' | 'excel' | 'unknown' {
    if (IMAGE_TYPES.some(t => mimeType.includes(t))) return 'image'
    if (PDF_TYPES.some(t => mimeType.includes(t)) || /\.pdf$/i.test(filename)) return 'pdf'
    if (EXCEL_TYPES.some(t => mimeType.includes(t)) || /\.(xlsx?|csv)$/i.test(filename)) return 'excel'
    return 'unknown'
}

// ─── Main Extraction Function ──────────────────────────

/**
 * Downloads all valid attachments from an email and extracts their text content.
 * The extracted text is used to enrich Claude's classification.
 */
export async function extractAttachmentContents(
    emailData: ParsedEmail,
    emailAccountAddress: string,
    savedEmailId?: string
): Promise<ExtractionResult> {
    const result: ExtractionResult = {
        attachments: [],
        combinedText: '',
        errors: [],
    }

    const validAttachments = emailData.attachments.filter(att => isDocumentAttachment(att))

    if (validAttachments.length === 0) {
        return result
    }

    console.log(`[AttachmentExtractor] Processing ${validAttachments.length} valid attachment(s) from "${emailData.subject}"`)

    for (const att of validAttachments) {
        try {
            console.log(`[AttachmentExtractor] Downloading: ${att.filename} (${att.mimeType}, ${Math.round(att.size / 1024)}KB)`)

            const { data: buffer } = await downloadAttachment(
                emailAccountAddress,
                emailData.gmailId,
                att.attachmentId
            )

            const category = getFileCategory(att.mimeType, att.filename)
            let extractedText = ''

            switch (category) {
                case 'image':
                    extractedText = await extractTextFromImage(buffer, att.mimeType)
                    break
                case 'pdf':
                    extractedText = await extractTextFromPDF(buffer)
                    break
                case 'excel':
                    extractedText = await extractTextFromExcel(buffer, att.filename)
                    break
                default:
                    // Try image OCR as fallback for unknown types
                    try {
                        extractedText = await extractTextFromImage(buffer, att.mimeType)
                    } catch {
                        extractedText = `[Archivo ${att.filename} — no se pudo extraer contenido]`
                    }
            }

            // Upload to Supabase Storage
            let storagePath: string | undefined
            if (savedEmailId) {
                storagePath = await uploadToStorage(buffer, emailData.gmailId, att.filename, att.mimeType, savedEmailId)
            }

            const content: AttachmentContent = {
                filename: att.filename,
                mimeType: att.mimeType,
                extractedText,
                rawBuffer: buffer,
                storagePath,
                attachmentId: att.attachmentId,
                sizeBytes: buffer.length,
            }

            result.attachments.push(content)
            console.log(`[AttachmentExtractor] ✅ Extracted ${extractedText.length} chars from ${att.filename}`)

        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            console.error(`[AttachmentExtractor] Error processing ${att.filename}:`, msg)
            result.errors.push(`${att.filename}: ${msg}`)
        }
    }

    // Build combined text for classification
    if (result.attachments.length > 0) {
        result.combinedText = result.attachments
            .map(a => `\n--- ADJUNTO: ${a.filename} (${a.mimeType}) ---\n${a.extractedText}`)
            .join('\n')
    }

    return result
}

// ─── Image OCR with Gemini ─────────────────────────────

async function extractTextFromImage(buffer: Buffer, mimeType: string): Promise<string> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const base64Data = buffer.toString('base64')

    const prompt = `Extraé TODO el texto visible en esta imagen. 
    Incluí números, nombres, direcciones, montos, fechas, productos, cantidades — TODO lo que sea texto legible.
    Si es una factura, comprobante, pedido, lista de precios o cualquier documento comercial, preservá la estructura del contenido.
    Si hay una tabla, representala como texto con separadores.
    Respondé SOLO con el texto extraído, sin explicaciones ni comentarios.`

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
                }
            }
        ])
        return result.response.text().trim()
    } catch (err) {
        console.error('[AttachmentExtractor] Gemini OCR error:', err)
        return '[Error extrayendo texto de imagen]'
    }
}

// ─── PDF Text Extraction with Gemini ───────────────────

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const base64Data = buffer.toString('base64')

    const prompt = `Extraé TODO el texto de este documento PDF.
    Incluí TODO: encabezados, tablas, montos, fechas, CUIT, números de comprobante, productos, cantidades — TODO.
    Si hay tablas, representalas como texto con separadores (|).
    Respondé SOLO con el texto extraído, sin explicaciones.`

    try {
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: 'application/pdf',
                }
            }
        ])
        return result.response.text().trim()
    } catch (err) {
        console.error('[AttachmentExtractor] Gemini PDF error:', err)
        return '[Error extrayendo texto de PDF]'
    }
}

// ─── Excel/CSV Text Extraction ─────────────────────────

async function extractTextFromExcel(buffer: Buffer, filename: string): Promise<string> {
    try {
        const xlsx = await import('xlsx')
        const workbook = xlsx.read(buffer, { type: 'buffer' })
        const textParts: string[] = []

        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName]
            const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as string[][]

            if (rows.length === 0) continue

            textParts.push(`[Hoja: ${sheetName}]`)

            // Include all rows, but limit to first 200 to avoid oversized context
            const rowsToInclude = rows.slice(0, 200)
            for (const row of rowsToInclude) {
                const line = row
                    .map(cell => String(cell).trim())
                    .filter(Boolean)
                    .join(' | ')
                if (line) textParts.push(line)
            }

            if (rows.length > 200) {
                textParts.push(`... (${rows.length - 200} filas adicionales omitidas)`)
            }
        }

        return textParts.join('\n')
    } catch (err) {
        console.error('[AttachmentExtractor] Excel parse error:', err)
        return `[Error parseando archivo Excel: ${filename}]`
    }
}

// ─── Storage Upload ────────────────────────────────────

export async function uploadToStorage(
    buffer: Buffer,
    gmailId: string,
    filename: string,
    mimeType: string,
    savedEmailId: string
): Promise<string | undefined> {
    try {
        const db = getSupabaseAdmin()
        const storagePath = `emails/${gmailId}/${filename}`

        const { error: uploadError } = await db.storage.from('attachments').upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: true,
        })

        if (uploadError) {
            console.error(`[AttachmentExtractor] ❌ Storage upload failed for ${filename} (email ${savedEmailId}, gmail ${gmailId}): ${uploadError.message}`)
            return undefined
        }

        return storagePath
    } catch (err) {
        console.error(`[AttachmentExtractor] ❌ Storage upload error for ${filename} (email ${savedEmailId}, gmail ${gmailId}):`, err instanceof Error ? err.message : err)
        return undefined
    }
}
