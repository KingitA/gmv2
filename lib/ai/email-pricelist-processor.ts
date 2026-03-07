// =====================================================
// AI Brain — Email Price List Processor
// Processes price change notifications from emails
// Deep XLSX analysis: article-by-article matching via Claude
// =====================================================

import { downloadAttachment, type ParsedEmail } from './gmail'
import { getSupabaseAdmin } from './supabase-admin'
import { analyzeXlsxPriceList } from './claude-xlsx-analyzer'
import { searchProductsByVector } from '@/lib/actions/embeddings'
import type { AttachmentContent } from './attachment-content-extractor'
import type { XlsxPriceListItem } from './types'

export interface PriceChangeProcessingResult {
    processed: boolean
    importCreated: boolean
    importId?: string
    proveedorFound: boolean
    proveedorId?: string
    proveedorName?: string
    fechaVigencia?: string
    attachmentSaved: boolean
    itemsDetected: number
    itemsLinked: number
    esOferta: boolean
    error?: string
}

interface LinkedPriceItem {
    // From XLSX
    originalDescription: string
    originalCode?: string
    originalBrand?: string
    originalPrice: number | null
    previousPrice?: number | null
    unit?: string
    isOffer?: boolean
    offerValidUntil?: string | null
    // From DB matching
    linkedArticuloId?: string
    linkedArticuloDesc?: string
    linkedArticuloSku?: string
    matchConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
}

/**
 * Procesa un email clasificado como "cambio_precio":
 * 1. Busca el proveedor por sender
 * 2. Si hay adjunto XLSX → Claude analiza artículo por artículo
 * 3. Vincula cada artículo con la DB vía vector search
 * 4. Crea registro en importaciones_articulos con datos vinculados
 * 5. Si es oferta, marca artículos con fecha de vigencia
 */
export async function processEmailAsPriceChange(
    emailData: ParsedEmail,
    emailAccountAddress: string,
    savedEmailId: string,
    preExtractedData?: import('./types').ExtractedPriceListData,
    preDownloadedAttachments?: AttachmentContent[]
): Promise<PriceChangeProcessingResult> {
    const db = getSupabaseAdmin()
    const fechaHoy = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).split(',')[0]

    console.log(`[PriceListProcessor] Processing price change email: "${emailData.subject}" from ${emailData.from}`)

    // ── 1. Find supplier ──────────────────────────────
    let proveedorId: string | null = null
    let proveedorName: string | null = null

    if (emailData.from) {
        const { data: prov } = await db.from('proveedores').select('id, nombre')
            .eq('email', emailData.from).maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
        }
    }

    if (!proveedorId && emailData.fromName) {
        const { data: prov } = await db.from('proveedores').select('id, nombre')
            .ilike('nombre', `%${emailData.fromName}%`).limit(1).maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
        }
    }

    // ── 2. Get fecha vigencia ──────────────────────────
    let fechaVigencia: string | null = null
    if (preExtractedData?.fecha_vigencia) {
        fechaVigencia = preExtractedData.fecha_vigencia
        console.log(`[PriceListProcessor] ✅ Using Claude pre-extracted fecha_vigencia: ${fechaVigencia}`)
    }

    console.log(`[PriceListProcessor] Supplier: ${proveedorName || 'Unknown'}, Effective date: ${fechaVigencia || 'Not found'}`)

    // ── 3. Deep XLSX Analysis with Claude ───────────────
    let itemsDetected = 0
    let itemsLinked = 0
    let esOferta = false
    const linkedItems: LinkedPriceItem[] = []
    let attachmentSaved = false
    let attachmentFilenames: string[] = []

    // Find XLSX attachments (either pre-downloaded or from email)
    const xlsxAttachments = preDownloadedAttachments?.filter(att =>
        att.mimeType.includes('spreadsheet') || att.mimeType.includes('excel') ||
        att.filename.match(/\.xlsx?$/i) || att.filename.match(/\.csv$/i)
    ) || []

    if (xlsxAttachments.length > 0) {
        // Process pre-downloaded XLSX attachments via Claude
        for (const att of xlsxAttachments) {
            try {
                console.log(`[PriceListProcessor] 🧠 Analyzing XLSX with Claude: ${att.filename}`)
                const analysis = await analyzeXlsxPriceList(att.rawBuffer, att.filename)

                if (!fechaVigencia && analysis.fecha_vigencia) {
                    fechaVigencia = analysis.fecha_vigencia
                }
                if (!proveedorName && analysis.proveedor_nombre) {
                    proveedorName = analysis.proveedor_nombre
                    // Try to find proveedor in DB by this name
                    if (!proveedorId) {
                        const { data: prov } = await db.from('proveedores').select('id, nombre')
                            .ilike('nombre', `%${analysis.proveedor_nombre}%`).limit(1).maybeSingle()
                        if (prov) {
                            proveedorId = prov.id
                            proveedorName = prov.nombre
                        }
                    }
                }
                esOferta = analysis.es_oferta || false

                // Link each item via vector search
                itemsDetected += analysis.items.length
                console.log(`[PriceListProcessor] Claude found ${analysis.items.length} items in ${att.filename}`)

                const BATCH_SIZE = 10
                const DELAY_MS = 1000

                for (let i = 0; i < analysis.items.length; i += BATCH_SIZE) {
                    const batch = analysis.items.slice(i, i + BATCH_SIZE)

                    const batchResults = await Promise.all(batch.map(async (item: XlsxPriceListItem) => {
                        const linked: LinkedPriceItem = {
                            originalDescription: item.description,
                            originalCode: item.code,
                            originalBrand: item.brand,
                            originalPrice: item.price,
                            previousPrice: item.previous_price,
                            unit: item.unit,
                            isOffer: item.is_offer,
                            offerValidUntil: item.offer_valid_until,
                            matchConfidence: 'NONE',
                        }

                        try {
                            // Try exact SKU match first
                            if (item.code) {
                                const { data: skuMatch } = await db.from('articulos')
                                    .select('id, descripcion, sku')
                                    .ilike('sku', item.code.trim())
                                    .maybeSingle()

                                if (skuMatch) {
                                    linked.linkedArticuloId = skuMatch.id
                                    linked.linkedArticuloDesc = skuMatch.descripcion
                                    linked.linkedArticuloSku = skuMatch.sku
                                    linked.matchConfidence = 'HIGH'
                                    return linked
                                }
                            }

                            // Vector search
                            const searchQuery = `${item.code || ''} ${item.brand || ''} ${item.description}`.trim()
                            const candidates = await searchProductsByVector(searchQuery, 0.4, 3)

                            if (candidates && candidates.length > 0) {
                                const best = candidates[0]
                                linked.linkedArticuloId = best.id
                                linked.linkedArticuloDesc = best.descripcion
                                linked.linkedArticuloSku = best.sku

                                if (best.similarity > 0.82) linked.matchConfidence = 'HIGH'
                                else if (best.similarity > 0.75) linked.matchConfidence = 'MEDIUM'
                                else linked.matchConfidence = 'LOW'
                            }
                        } catch (err) {
                            console.error(`[PriceListProcessor] Error matching "${item.description}":`, err)
                        }

                        return linked
                    }))

                    linkedItems.push(...batchResults)
                    itemsLinked += batchResults.filter(i => i.matchConfidence !== 'NONE').length

                    // Rate limiting
                    if (i + BATCH_SIZE < analysis.items.length) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS))
                    }
                }

                attachmentFilenames.push(att.filename)
                attachmentSaved = true
            } catch (err) {
                console.error(`[PriceListProcessor] Error analyzing ${att.filename}:`, err)
            }
        }
    } else if (emailData.attachments.length > 0) {
        // Download and process attachments not yet pre-downloaded
        for (const att of emailData.attachments) {
            const isValid = att.filename.match(/\.(xlsx?|csv|pdf|xls)$/i)
                || att.mimeType.includes('spreadsheet')
                || att.mimeType.includes('excel')
                || att.mimeType.includes('csv')

            if (!isValid) continue

            try {
                const { data: buffer } = await downloadAttachment(
                    emailAccountAddress,
                    emailData.gmailId,
                    att.attachmentId
                )

                const isXlsx = att.filename.match(/\.xlsx?$/i) || att.mimeType.includes('spreadsheet') || att.mimeType.includes('excel')

                if (isXlsx) {
                    // Deep analysis with Claude
                    console.log(`[PriceListProcessor] 🧠 Analyzing downloaded XLSX with Claude: ${att.filename}`)
                    const analysis = await analyzeXlsxPriceList(buffer, att.filename)

                    if (!fechaVigencia && analysis.fecha_vigencia) {
                        fechaVigencia = analysis.fecha_vigencia
                    }
                    if (!proveedorName && analysis.proveedor_nombre) {
                        proveedorName = analysis.proveedor_nombre
                    }
                    esOferta = analysis.es_oferta || false
                    itemsDetected += analysis.items.length

                    // Simplified linking for non-pre-downloaded (same as above but extracted for brevity)
                    for (const item of analysis.items) {
                        const linked: LinkedPriceItem = {
                            originalDescription: item.description,
                            originalCode: item.code,
                            originalPrice: item.price,
                            isOffer: item.is_offer,
                            offerValidUntil: item.offer_valid_until,
                            matchConfidence: 'NONE',
                        }
                        try {
                            const searchQuery = `${item.code || ''} ${item.brand || ''} ${item.description}`.trim()
                            const candidates = await searchProductsByVector(searchQuery, 0.4, 3)
                            if (candidates?.[0]) {
                                linked.linkedArticuloId = candidates[0].id
                                linked.linkedArticuloDesc = candidates[0].descripcion
                                linked.matchConfidence = candidates[0].similarity > 0.82 ? 'HIGH' : candidates[0].similarity > 0.75 ? 'MEDIUM' : 'LOW'
                            }
                        } catch { /* continue */ }
                        linkedItems.push(linked)
                    }
                    itemsLinked = linkedItems.filter(i => i.matchConfidence !== 'NONE').length
                }

                // Save attachment metadata
                await db.from('ai_email_attachments').insert({
                    email_id: savedEmailId,
                    filename: att.filename,
                    mime_type: att.mimeType,
                    size_bytes: buffer.length,
                    storage_path: `gmail/${emailData.gmailId}/${att.filename}`,
                })

                // Upload to storage
                const storagePath = `price-lists/${proveedorId || 'unknown'}/${fechaHoy}_${att.filename}`
                await db.storage.from('attachments').upload(storagePath, buffer, {
                    contentType: att.mimeType,
                    upsert: true,
                }).catch(() => {
                    console.log(`[PriceListProcessor] Storage upload skipped`)
                })

                attachmentSaved = true
                attachmentFilenames.push(att.filename)
            } catch (err) {
                console.error(`[PriceListProcessor] Error saving ${att.filename}:`, err)
            }
        }
    }

    console.log(`[PriceListProcessor] Analysis complete: ${itemsDetected} items detected, ${itemsLinked} linked to DB, oferta: ${esOferta}`)

    // ── 4. Create import record with linked items ─────────
    try {
        const { data: importRec, error: importError } = await db.from('importaciones_articulos').insert({
            archivo_nombre: attachmentFilenames.join(', ') || emailData.subject || 'Email sin adjunto',
            tipo: esOferta ? 'oferta_gmail' : 'lista_precios_gmail',
            columnas_afectadas: {
                source: 'gmail',
                sender: emailData.from,
                sender_name: emailData.fromName,
                subject: emailData.subject,
                gmail_email_id: savedEmailId,
                attachments: attachmentFilenames,
                items_detected: itemsDetected,
                items_linked: itemsLinked,
                es_oferta: esOferta,
                // Store linked items for the review UI
                linked_items: linkedItems.map(li => ({
                    desc: li.originalDescription,
                    code: li.originalCode,
                    brand: li.originalBrand,
                    price: li.originalPrice,
                    prev_price: li.previousPrice,
                    unit: li.unit,
                    is_offer: li.isOffer,
                    offer_until: li.offerValidUntil,
                    articulo_id: li.linkedArticuloId || null,
                    articulo_desc: li.linkedArticuloDesc || null,
                    articulo_sku: li.linkedArticuloSku || null,
                    confidence: li.matchConfidence,
                })),
            },
            registros_nuevos: itemsDetected - itemsLinked,
            registros_actualizados: itemsLinked,
            proveedor_id: proveedorId,
            fecha_vigencia: fechaVigencia,
            estado: 'pendiente',
            source: 'gmail',
            gmail_email_id: savedEmailId,
        }).select().single()

        if (importError) {
            // Fallback: try basic insert without extended columns
            console.warn(`[PriceListProcessor] Extended insert failed, trying basic:`, importError.message)

            const { data: basicRec, error: basicError } = await db.from('importaciones_articulos').insert({
                archivo_nombre: attachmentFilenames.join(', ') || emailData.subject || 'Email sin adjunto',
                tipo: esOferta ? 'oferta_gmail' : 'lista_precios_gmail',
                columnas_afectadas: {
                    source: 'gmail',
                    sender: emailData.from,
                    subject: emailData.subject,
                    gmail_email_id: savedEmailId,
                    proveedor_id: proveedorId,
                    proveedor_nombre: proveedorName,
                    fecha_vigencia: fechaVigencia,
                    attachments: attachmentFilenames,
                    items_detected: itemsDetected,
                    items_linked: itemsLinked,
                    es_oferta: esOferta,
                    linked_items: linkedItems.slice(0, 100).map(li => ({
                        desc: li.originalDescription,
                        price: li.originalPrice,
                        articulo_id: li.linkedArticuloId || null,
                        confidence: li.matchConfidence,
                    })),
                },
                registros_nuevos: itemsDetected - itemsLinked,
                registros_actualizados: itemsLinked,
            }).select().single()

            if (basicError) throw basicError

            console.log(`[PriceListProcessor] ✅ Created import record (basic): ${basicRec.id} — ${itemsDetected} items, ${itemsLinked} linked`)
            return {
                processed: true,
                importCreated: true,
                importId: basicRec.id,
                proveedorFound: !!proveedorId,
                proveedorId: proveedorId || undefined,
                proveedorName: proveedorName || undefined,
                fechaVigencia: fechaVigencia || undefined,
                attachmentSaved,
                itemsDetected,
                itemsLinked,
                esOferta,
            }
        }

        console.log(`[PriceListProcessor] ✅ Created import record: ${importRec.id} — ${itemsDetected} items, ${itemsLinked} linked`)
        return {
            processed: true,
            importCreated: true,
            importId: importRec.id,
            proveedorFound: !!proveedorId,
            proveedorId: proveedorId || undefined,
            proveedorName: proveedorName || undefined,
            fechaVigencia: fechaVigencia || undefined,
            attachmentSaved,
            itemsDetected,
            itemsLinked,
            esOferta,
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error creating import'
        console.error(`[PriceListProcessor] Error:`, msg)
        return {
            processed: true,
            importCreated: false,
            proveedorFound: !!proveedorId,
            proveedorId: proveedorId || undefined,
            proveedorName: proveedorName || undefined,
            fechaVigencia: fechaVigencia || undefined,
            attachmentSaved,
            itemsDetected,
            itemsLinked,
            esOferta,
            error: msg,
        }
    }
}
