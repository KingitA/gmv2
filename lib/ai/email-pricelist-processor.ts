// =====================================================
// AI Brain — Email Price List Processor
// Processes price change notifications from emails
// Deep XLSX analysis via Claude; el VÍNCULO con nuestros artículos lo decide
// crearListaProveedor (lib/compras/listas-servidor.ts), en contexto del proveedor.
// =====================================================

import { downloadAttachment, type ParsedEmail } from './gmail'
import { getSupabaseAdmin } from './supabase-admin'
import { analyzeXlsxPriceList } from './claude-xlsx-analyzer'
import type { AttachmentContent } from './attachment-content-extractor'
import type { XlsxPriceListAnalysis } from './types'
import { hoyISO, parseFecha, parseMonto } from '@/lib/formato'
import { crearListaProveedor } from '@/lib/compras/listas-servidor'
import { MatchingEngine } from '@/lib/matching/matcher'

export interface PriceChangeProcessingResult {
    processed: boolean
    importCreated: boolean
    importId?: string
    /** La lista quedó en Listas de proveedores (mismo circuito que las que carga la oficina) */
    listaProveedorId?: string
    proveedorFound: boolean
    proveedorId?: string
    proveedorName?: string
    fechaVigencia?: string
    attachmentSaved: boolean
    itemsDetected: number
    itemsLinked: number
    esOferta: boolean
    /** Avisos para mostrar (lectura incompleta, falta el proveedor). Nunca en silencio. */
    avisos?: string[]
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
    // Solo para el circuito de importaciones (ofertas): sugerencia para la pantalla de revisión
    linkedArticuloId?: string
    linkedArticuloDesc?: string
    linkedArticuloSku?: string
    matchConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
}

/** Escapa % y _ (comodines de ILIKE) en un texto que viene de afuera */
const escaparLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

/**
 * Procesa un email clasificado como "cambio_precio":
 * 1. Busca el proveedor por mail o nombre
 * 2. Si hay adjunto XLSX → Claude lo lee renglón por renglón
 * 3. Lista de precios → Listas de proveedores ("pendiente"): crearListaProveedor vincula cada renglón
 *    con los artículos DEL PROVEEDOR (igual que la carga a mano); uno de otro proveedor o parecido
 *    queda "por revisar". Sin proveedor identificado, NADA queda para aplicar: la lista pide el proveedor.
 * 4. Ofertas (o si no se pudo crear la lista): importaciones_articulos, con sugerencias para revisar
 */
export async function processEmailAsPriceChange(
    emailData: ParsedEmail,
    emailAccountAddress: string,
    savedEmailId: string,
    preExtractedData?: import('./types').ExtractedPriceListData,
    preDownloadedAttachments?: AttachmentContent[]
): Promise<PriceChangeProcessingResult> {
    const db = getSupabaseAdmin()
    const fechaHoy = hoyISO()

    console.log(`[PriceListProcessor] Processing price change email: "${emailData.subject}" from ${emailData.from}`)

    // ── 1. Find supplier ──────────────────────────────
    let proveedorId: string | null = null
    let proveedorName: string | null = null
    const buscarProveedorPorNombre = async (nombre: string) => {
        const limpio = nombre.trim()
        if (limpio.length < 3) return
        const { data: prov } = await db.from('proveedores').select('id, nombre')
            .ilike('nombre', `%${escaparLike(limpio)}%`).limit(1).maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
        }
    }

    if (emailData.from) {
        const { data: prov } = await db.from('proveedores').select('id, nombre')
            .eq('email', emailData.from).maybeSingle()
        if (prov) {
            proveedorId = prov.id
            proveedorName = prov.nombre
        }
    }
    if (!proveedorId && emailData.fromName) await buscarProveedorPorNombre(emailData.fromName)

    // ── 2. Get fecha vigencia ──────────────────────────
    let fechaVigencia: string | null = null
    if (preExtractedData?.fecha_vigencia) {
        fechaVigencia = parseFecha(preExtractedData.fecha_vigencia) // la IA puede devolver dd/mm/aaaa
        console.log(`[PriceListProcessor] ✅ Using Claude pre-extracted fecha_vigencia: ${fechaVigencia}`)
    }

    console.log(`[PriceListProcessor] Supplier: ${proveedorName || 'Unknown'}, Effective date: ${fechaVigencia || 'Not found'}`)

    // ── 3. Deep XLSX Analysis with Claude ───────────────
    let itemsDetected = 0
    let esOferta = false
    const linkedItems: LinkedPriceItem[] = []
    const avisos: string[] = []
    let attachmentSaved = false
    const attachmentFilenames: string[] = []
    /** Adjuntos guardados (bucket "attachments"), TODOS: para los enlaces desde la lista */
    const adjuntosGuardados: Array<{ nombre: string; ruta: string }> = []
    const guardarAdjunto = async (nombre: string, buffer: Buffer, mimeType: string) => {
        const ruta = `price-lists/${proveedorId || 'unknown'}/${fechaHoy}_${nombre}`
        const { error } = await db.storage.from('attachments').upload(ruta, buffer, { contentType: mimeType, upsert: true })
        if (error) { console.log(`[PriceListProcessor] Storage upload skipped: ${error.message}`); return }
        if (!adjuntosGuardados.some((a) => a.ruta === `attachments:${ruta}`)) adjuntosGuardados.push({ nombre, ruta: `attachments:${ruta}` })
    }

    /** Lo leído de un Excel: renglones crudos (sin vincular), fecha, proveedor y avisos */
    const tomarAnalisis = async (analysis: XlsxPriceListAnalysis, archivo: string) => {
        if (!fechaVigencia && analysis.fecha_vigencia) fechaVigencia = parseFecha(analysis.fecha_vigencia)
        if (!proveedorId && analysis.proveedor_nombre) await buscarProveedorPorNombre(analysis.proveedor_nombre)
        if (!proveedorName && analysis.proveedor_nombre) proveedorName = analysis.proveedor_nombre
        esOferta = analysis.es_oferta || false
        itemsDetected += analysis.items.length
        if (analysis.aviso_incompleto) avisos.push(`${archivo}: ${analysis.aviso_incompleto}`)
        console.log(`[PriceListProcessor] Claude found ${analysis.items.length} items in ${archivo}`)
        for (const item of analysis.items) {
            linkedItems.push({
                originalDescription: item.description,
                originalCode: item.code,
                originalBrand: item.brand,
                originalPrice: parseMonto(item.price as any), // la IA puede devolver "1.234,56"
                previousPrice: parseMonto(item.previous_price as any),
                unit: item.unit,
                isOffer: item.is_offer,
                offerValidUntil: parseFecha(item.offer_valid_until),
                matchConfidence: 'NONE',
            })
        }
    }

    // Find XLSX attachments (either pre-downloaded or from email)
    const xlsxAttachments = preDownloadedAttachments?.filter(att =>
        att.mimeType.includes('spreadsheet') || att.mimeType.includes('excel') ||
        att.filename.match(/\.xlsx?$/i) || att.filename.match(/\.csv$/i)
    ) || []

    if (xlsxAttachments.length > 0) {
        for (const att of xlsxAttachments) {
            try {
                console.log(`[PriceListProcessor] 🧠 Analyzing XLSX with Claude: ${att.filename}`)
                await tomarAnalisis(await analyzeXlsxPriceList(att.rawBuffer, att.filename), att.filename)
                attachmentFilenames.push(att.filename)
                attachmentSaved = true
                await guardarAdjunto(att.filename, att.rawBuffer, att.mimeType).catch(() => null)
            } catch (err) {
                console.error(`[PriceListProcessor] Error analyzing ${att.filename}:`, err)
                avisos.push(`${att.filename}: no se pudo leer (${err instanceof Error ? err.message : String(err)}).`)
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
                    console.log(`[PriceListProcessor] 🧠 Analyzing downloaded XLSX with Claude: ${att.filename}`)
                    try {
                        await tomarAnalisis(await analyzeXlsxPriceList(buffer, att.filename), att.filename)
                    } catch (err) {
                        console.error(`[PriceListProcessor] Error analyzing ${att.filename}:`, err)
                        avisos.push(`${att.filename}: no se pudo leer (${err instanceof Error ? err.message : String(err)}).`)
                    }
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
                await guardarAdjunto(att.filename, buffer, att.mimeType).catch(() => null)

                attachmentSaved = true
                attachmentFilenames.push(att.filename)
            } catch (err) {
                console.error(`[PriceListProcessor] Error saving ${att.filename}:`, err)
            }
        }
    }

    console.log(`[PriceListProcessor] Analysis complete: ${itemsDetected} items detected, oferta: ${esOferta}`)

    // ── 4. Lista de precios → el MISMO circuito que las que carga la oficina (E-22) ─────────
    // Queda una lista "pendiente" en Listas de proveedores, con la misma vista previa (costo actual →
    // nuevo, alertas, aviso de precios de venta): ahí se revisa y se aplica. No cambia ningún precio
    // sola. El procesador del mail NO decide el vínculo: crearListaProveedor busca cada renglón entre
    // los artículos del proveedor (como la carga a mano) y lo dudoso o de otro proveedor queda "por
    // revisar". Las OFERTAS siguen por el circuito de importaciones (no son costo de lista).
    if (!esOferta && linkedItems.some((li) => li.originalPrice != null && Number(li.originalPrice) > 0)) {
        try {
            const notas = [
                `Llegó por mail de ${emailData.from}. Asunto: ${emailData.subject || '(sin asunto)'}.`,
                fechaVigencia ? '' : 'El mail no decía desde cuándo rige: se tomó la fecha en que llegó.',
                proveedorId ? '' : `FALTA EL PROVEEDOR: no se pudo identificar${proveedorName ? ` ("${proveedorName}" no está en Proveedores)` : ''}. Elegilo en la lista antes de aplicarla; hasta entonces ningún renglón se aplica.`,
                ...avisos,
            ].filter(Boolean)
            const r = await crearListaProveedor(db, {
                proveedor_id: proveedorId || null,
                nombre: `${proveedorId ? proveedorName : `SIN PROVEEDOR — ${proveedorName || emailData.fromName || emailData.from || 'mail'}`} — por mail${attachmentFilenames.length ? ` (${attachmentFilenames[0]})` : ''}`.slice(0, 200),
                fecha_vigencia: fechaVigencia || fechaHoy,
                observaciones: notas.join(' ').slice(0, 1000),
                storage_path: adjuntosGuardados[0]?.ruta || null,
                archivos: adjuntosGuardados,
                origen: 'mail',
                email_id: savedEmailId || null,
                items: linkedItems.map((li) => ({
                    codigo: li.originalCode || null,
                    descripcion: li.originalDescription || null,
                    precio_compra: li.originalPrice != null && Number(li.originalPrice) > 0 ? Number(li.originalPrice) : null,
                    // el mail no trae los descuentos por separado: no se tocan
                    descuento1: null, descuento2: null, descuento3: null, descuento4: null,
                })),
            })
            console.log(`[PriceListProcessor] ✅ Lista de proveedor ${r.lista_id}: ${r.stats.pendientes} para aplicar, ${r.stats.revisar} por revisar, ${r.stats.sin_articulo} sin artículo`)
            return {
                processed: true,
                importCreated: true,
                importId: r.lista_id,
                listaProveedorId: r.lista_id,
                proveedorFound: !!proveedorId,
                proveedorId: proveedorId || undefined,
                proveedorName: proveedorName || undefined,
                fechaVigencia: fechaVigencia || undefined,
                attachmentSaved,
                itemsDetected,
                itemsLinked: r.stats.pendientes + r.stats.revisar,
                esOferta,
                avisos: [...(proveedorId ? [] : ['Falta el proveedor: elegilo en la lista antes de aplicarla.']), ...avisos],
            }
        } catch (e: any) {
            // No se pudo dejar en Listas de proveedores: sigue por el circuito anterior para no perder el mail
            console.error('[PriceListProcessor] no se pudo crear la lista de proveedor, va a importaciones:', e?.message || e)
        }
    }

    // ── 4b. Ofertas (o si lo anterior falló): registro en importaciones ─────────
    // Sugerencias para la pantalla de revisión, con el mismo motor y en contexto del proveedor: el
    // código del proveedor NO se compara contra nuestro SKU, y un artículo de otro proveedor o sin
    // proveedor identificado nunca sale "HIGH".
    const itemsLinked = await sugerirArticulos(linkedItems, proveedorId)
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
                avisos,
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
                    avisos,
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
                avisos,
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
            avisos,
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
            avisos,
            error: msg,
        }
    }
}

/**
 * Sugerencias de artículo para la pantalla de importaciones (ofertas). Mismo motor que las listas y
 * las facturas, en contexto de compra del proveedor: HIGH solo si lo encontró con seguridad entre
 * los suyos; un artículo de otro proveedor, parecido o sin proveedor identificado queda MEDIUM/LOW
 * (sugerencia). Devuelve cuántos renglones quedaron con alguna sugerencia.
 */
async function sugerirArticulos(items: LinkedPriceItem[], proveedorId: string | null): Promise<number> {
    const engine = new MatchingEngine()
    const LOTE = 5
    for (let i = 0; i < items.length; i += LOTE) {
        await Promise.all(items.slice(i, i + LOTE).map(async (li) => {
            if (!li.originalCode && !li.originalDescription) return
            try {
                const m = await engine.resolveItem(
                    { description: li.originalDescription || '', code: li.originalCode || undefined, price: li.originalPrice ?? undefined },
                    proveedorId || '', proveedorId ? {} : null)
                const best = m.bestCandidate
                if (!best?.sku_id) return
                li.linkedArticuloId = best.sku_id
                li.linkedArticuloDesc = best.sku_name
                li.linkedArticuloSku = best.sku_code
                li.matchConfidence = proveedorId && m.status === 'matched' && !best.otro_proveedor ? 'HIGH'
                    : best.confidence_level === 'suggestion' || best.confidence_level === 'auto_approve' ? 'MEDIUM' : 'LOW'
            } catch (err) {
                console.error(`[PriceListProcessor] Error matching "${li.originalDescription}":`, err)
            }
        }))
    }
    return items.filter((li) => li.matchConfidence !== 'NONE').length
}
