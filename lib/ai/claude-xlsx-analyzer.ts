// =====================================================
// AI Brain — Claude XLSX Deep Analyzer
// Parses XLSX files and sends structured data to Claude
// for intelligent extraction of orders, price lists, invoices
// =====================================================

import Anthropic from '@anthropic-ai/sdk'
import {
    SYSTEM_PROMPT_XLSX_ORDER,
    SYSTEM_PROMPT_XLSX_PRICELIST,
    SYSTEM_PROMPT_XLSX_INVOICE,
} from './prompts'
import type {
    XlsxOrderAnalysis,
    XlsxPriceListAnalysis,
    XlsxInvoiceAnalysis,
} from './types'

// ─── Claude Client ─────────────────────────────────────

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
    if (!anthropicClient) {
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY no está configurada')
        }
        anthropicClient = new Anthropic({ apiKey })
    }
    return anthropicClient
}

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOTAL_CHARS = 50000  // Max chars to send to Claude

// ─── Retry Helper ──────────────────────────────────────

async function withRateLimitRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 2,
    label = 'Claude'
): Promise<T> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err: unknown) {
            const error = err as { status?: number; error?: { type?: string }; headers?: { 'retry-after'?: string } }
            const isRateLimit = error?.status === 429 || error?.error?.type === 'rate_limit_error'
            if (!isRateLimit || attempt === maxRetries) {
                throw err
            }
            // Get retry-after from headers, default to 30s
            const retryAfterRaw = error?.headers?.['retry-after']
            const retryAfterSecs = retryAfterRaw ? Math.min(parseInt(retryAfterRaw, 10), 90) : 30
            const waitMs = retryAfterSecs * 1000
            console.warn(`[${label}] Rate limit hit — waiting ${retryAfterSecs}s before retry ${attempt + 1}/${maxRetries}...`)
            await new Promise(r => setTimeout(r, waitMs))
            lastError = err instanceof Error ? err : new Error(String(err))
        }
    }
    throw lastError
}

// ─── XLSX Parsing Helpers ──────────────────────────────

interface ParsedSheetData {
    sheetName: string
    headers: string[]
    headerRowIndex: number
    topRows: string[][]      // First 15 rows for header/metadata detection
    dataRows: string[][]     // ALL data rows (no cap)
    totalRows: number
    pedidoColumnIndices: number[]  // Indices of columns named PEDIDO or similar
}

/**
 * Parses an XLSX buffer into structured sheet data that Claude can analyze.
 * Returns raw parsed data separated by sheet, with headers and data rows.
 */
async function parseXlsxToStructuredData(buffer: Buffer, filename: string): Promise<ParsedSheetData[]> {
    const xlsx = await import('xlsx')
    const workbook = xlsx.read(buffer, { type: 'buffer' })
    const sheets: ParsedSheetData[] = []

    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName]
        const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][]

        if (rows.length === 0) continue

        // Convert all cells to strings
        const stringRows = rows.map(row =>
            row.map(cell => String(cell ?? '').trim())
        )

        // Top rows for context (headers, company name, customer info)
        const topRows = stringRows.slice(0, 15)

        // Try to find where data starts (look for header row)
        const headerRowIndex = stringRows.findIndex(r =>
            r.some(c => /desc|item|producto|articulo|cant|pedido|precio|code|codigo|sku|marca|brand/i.test(c))
        )

        let headers: string[]
        let dataRows: string[][]
        let effectiveHeaderRowIndex = 0

        if (headerRowIndex >= 0) {
            headers = stringRows[headerRowIndex]
            effectiveHeaderRowIndex = headerRowIndex
            dataRows = stringRows.slice(headerRowIndex + 1).filter(row =>
                row.some(cell => cell !== '')
            )
        } else {
            // No clear header row — use first non-empty row as header
            const firstNonEmpty = stringRows.findIndex(r => r.some(c => c !== ''))
            headers = firstNonEmpty >= 0 ? stringRows[firstNonEmpty] : []
            effectiveHeaderRowIndex = firstNonEmpty >= 0 ? firstNonEmpty : 0
            dataRows = stringRows.slice(firstNonEmpty + 1).filter(row =>
                row.some(cell => cell !== '')
            )
        }

        // Detect PEDIDO columns (there can be multiple panels side by side)
        const pedidoColumnIndices: number[] = []
        for (let i = 0; i < headers.length; i++) {
            if (/^pedido$/i.test(headers[i]) || /^cant\.?\s*pedid/i.test(headers[i]) || /^solicitado$/i.test(headers[i])) {
                pedidoColumnIndices.push(i)
            }
        }

        // NO row cap — store ALL data rows
        sheets.push({
            sheetName,
            headers,
            headerRowIndex: effectiveHeaderRowIndex,
            topRows,
            dataRows,
            totalRows: dataRows.length,
            pedidoColumnIndices,
        })

        console.log(`[ClaudeXlsx] Sheet "${sheetName}": ${dataRows.length} data rows, PEDIDO columns: [${pedidoColumnIndices.join(', ')}]`)
    }

    return sheets
}

/**
 * Formats parsed sheet data into a compact text representation for Claude.
 * Uses column index markers [C0], [C1] etc. for precise identification.
 * mode='order' pre-filters to only rows with PEDIDO values > 0.
 * mode='full' sends all rows (for price lists, invoices, etc.).
 */
function formatSheetsForClaude(sheets: ParsedSheetData[], filename: string, mode: 'order' | 'full' = 'full'): string {
    const parts: string[] = [`ARCHIVO: ${filename}\n`]

    for (const sheet of sheets) {
        parts.push(`══ HOJA: ${sheet.sheetName} (${sheet.totalRows} filas totales) ══`)

        // Show top rows for customer/metadata context
        if (sheet.topRows.length > 0) {
            parts.push('--- ENCABEZADO ---')
            for (const row of sheet.topRows.slice(0, 5)) {
                const formatted = row
                    .map((cell, idx) => cell ? `[${idx}]${cell}` : null)
                    .filter(Boolean)
                    .join('|')
                if (formatted) parts.push(formatted)
            }
        }

        // Headers
        if (sheet.headers.length > 0) {
            parts.push('COLS: ' + sheet.headers.map((h, idx) => `[${idx}]${h || '?'}`).join('|'))
        }

        let rowsToSend: string[][]

        if (mode === 'order' && sheet.pedidoColumnIndices.length > 0) {
            // ORDER MODE: Handle dual/multiple tables in the same row
            rowsToSend = []
            let generatedRows = 0

            for (const row of sheet.dataRows) {
                // Generate a separate row for each PEDIDO column that has a quantity > 0
                for (let i = 0; i < sheet.pedidoColumnIndices.length; i++) {
                    const colIdx = sheet.pedidoColumnIndices[i]
                    const val = row[colIdx]
                    if (!val || val === '' || val === '0') continue
                    const num = parseFloat(val.replace(',', '.'))

                    if (!isNaN(num) && num > 0) {
                        const newRow = new Array(row.length).fill('')

                        // left boundary: 0 for first block, or column after previous PEDIDO
                        const startCol = i === 0 ? 0 : sheet.pedidoColumnIndices[i - 1] + 1

                        // right boundary: row end for last block, or current PEDIDO column
                        const endCol = i === sheet.pedidoColumnIndices.length - 1 ? row.length - 1 : colIdx

                        for (let c = startCol; c <= endCol && c < row.length; c++) {
                            newRow[c] = row[c]
                        }

                        rowsToSend.push(newRow)
                        generatedRows++
                    }
                }
            }
            console.log(`[ClaudeXlsx] Sheet "${sheet.sheetName}": separated candidate columns [${sheet.pedidoColumnIndices.join(', ')}]. Result: ${generatedRows} independent rows with qty > 0`)
        } else {
            // FULL MODE or no PEDIDO columns detected: send all rows
            rowsToSend = sheet.dataRows
        }

        parts.push(`--- DATOS (${rowsToSend.length} filas con pedido) ---`)
        for (const row of rowsToSend) {
            const formatted = row
                .map((cell, idx) => cell ? `[${idx}]${cell}` : null)
                .filter(Boolean)
                .join('|')
            if (formatted) parts.push(formatted)
        }

        parts.push('')
    }

    const result = parts.join('\n')
    // Hard truncation safeguard
    if (result.length > MAX_TOTAL_CHARS) {
        return result.substring(0, MAX_TOTAL_CHARS) + '\n\n[TRUNCADO — archivo demasiado grande]'
    }
    return result
}

// ─── Public Analysis Functions ─────────────────────────

/**
 * Analyzes an XLSX file as a customer ORDER using Claude.
 * Extracts customer name and all items with quantities.
 */
export async function analyzeXlsxOrder(buffer: Buffer, filename: string): Promise<XlsxOrderAnalysis> {
    console.log(`[ClaudeXlsx] 🧠 Analyzing XLSX order: ${filename}`)
    const sheets = await parseXlsxToStructuredData(buffer, filename)

    if (sheets.length === 0) {
        throw new Error('El archivo Excel no tiene hojas con datos')
    }

    const formattedData = formatSheetsForClaude(sheets, filename, 'order')
    const client = getClient()

    const totalRows = sheets.reduce((sum, s) => sum + s.totalRows, 0)
    const maxTokens = 8192

    console.log(`[ClaudeXlsx] Sending ${formattedData.length} chars to Claude (${totalRows} total rows, max_tokens: ${maxTokens})`)

    const response = await withRateLimitRetry(() => client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT_XLSX_ORDER,
        messages: [{
            role: 'user',
            content: formattedData,
        }],
    }), 2, 'ClaudeXlsx-Order')

    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude no devolvió respuesta de texto para el XLSX de pedido')
    }

    const parsed = parseJsonResponse<XlsxOrderAnalysis>(textBlock.text)
    console.log(`[ClaudeXlsx] ✅ Order analysis: ${parsed.items?.length || 0} items, customer: ${parsed.customer || 'no detectado'}`)
    return parsed
}

/**
 * Analyzes an XLSX file as a PRICE LIST from a supplier using Claude.
 * Extracts supplier name, effective date, and all items with prices.
 */
export async function analyzeXlsxPriceList(buffer: Buffer, filename: string): Promise<XlsxPriceListAnalysis> {
    console.log(`[ClaudeXlsx] 🧠 Analyzing XLSX price list: ${filename}`)
    const sheets = await parseXlsxToStructuredData(buffer, filename)

    if (sheets.length === 0) {
        throw new Error('El archivo Excel no tiene hojas con datos')
    }

    const formattedData = formatSheetsForClaude(sheets, filename)
    const client = getClient()

    const totalRows = sheets.reduce((sum, s) => sum + s.totalRows, 0)
    const maxTokens = 4096

    console.log(`[ClaudeXlsx] Sending ${formattedData.length} chars to Claude (${totalRows} total rows, max_tokens: ${maxTokens})`)

    const response = await withRateLimitRetry(() => client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT_XLSX_PRICELIST,
        messages: [{
            role: 'user',
            content: formattedData,
        }],
    }), 2, 'ClaudeXlsx-PriceList')

    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude no devolvió respuesta de texto para el XLSX de lista de precios')
    }

    const parsed = parseJsonResponse<XlsxPriceListAnalysis>(textBlock.text)
    console.log(`[ClaudeXlsx] ✅ Price list analysis: ${parsed.items?.length || 0} items, proveedor: ${parsed.proveedor_nombre || 'no detectado'}, vigencia: ${parsed.fecha_vigencia || 'no detectada'}`)
    return parsed
}

/**
 * Analyzes an XLSX file as a SUPPLIER INVOICE using Claude.
 * Extracts invoice data and line items.
 */
export async function analyzeXlsxInvoice(buffer: Buffer, filename: string): Promise<XlsxInvoiceAnalysis> {
    console.log(`[ClaudeXlsx] 🧠 Analyzing XLSX invoice: ${filename}`)
    const sheets = await parseXlsxToStructuredData(buffer, filename)

    if (sheets.length === 0) {
        throw new Error('El archivo Excel no tiene hojas con datos')
    }

    const formattedData = formatSheetsForClaude(sheets, filename)
    const client = getClient()

    const response = await withRateLimitRetry(() => client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT_XLSX_INVOICE,
        messages: [{
            role: 'user',
            content: formattedData,
        }],
    }), 2, 'ClaudeXlsx-Invoice')

    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude no devolvió respuesta de texto para el XLSX de factura')
    }

    const parsed = parseJsonResponse<XlsxInvoiceAnalysis>(textBlock.text)
    console.log(`[ClaudeXlsx] ✅ Invoice analysis: ${parsed.tipo_comprobante || '?'} ${parsed.numero_comprobante || '?'} — $${parsed.total || '?'}`)
    return parsed
}

// ─── JSON Response Parser ──────────────────────────────

function parseJsonResponse<T>(text: string): T {
    let jsonStr = text.trim()

    // Handle markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
        jsonStr = jsonMatch[1].trim()
    }

    // Try to find JSON object directly
    const objMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (objMatch) {
        jsonStr = objMatch[0]
    }

    try {
        return JSON.parse(jsonStr) as T
    } catch {
        console.error('[ClaudeXlsx] Failed to parse JSON response:', text.substring(0, 500))
        throw new Error('No se pudo parsear la respuesta de Claude para el archivo Excel')
    }
}
