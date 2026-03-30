// =====================================================
// AI Brain — Gmail Integration Service
// =====================================================

import { google, type gmail_v1 } from 'googleapis'
import { getSupabaseAdmin } from './supabase-admin'
import { nowArgentina } from '@/lib/utils'

const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/drive.readonly',
]

// ─── OAuth2 Client ─────────────────────────────────────

function getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = process.env.GOOGLE_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error(
            'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI deben estar configuradas'
        )
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

/**
 * Genera la URL de autorización de Google OAuth
 * @param userId - ID del usuario del sistema que está conectando Gmail
 */
export function getAuthUrl(userId: string): string {
    const oauth2Client = getOAuth2Client()
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        state: userId,
    })
}

/**
 * Intercambia el código de autorización por tokens y los guarda en Supabase
 * @param userId - ID del usuario del sistema que está conectando Gmail
 */
export async function exchangeCodeForTokens(code: string, userId: string): Promise<{ email: string }> {
    const oauth2Client = getOAuth2Client()

    console.log('[Gmail OAuth] Exchanging code for tokens...')
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)
    console.log('[Gmail OAuth] Tokens obtained successfully')

    // Get the user's email — try userinfo first, then Gmail profile as fallback
    let email: string | null = null

    try {
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
        const userInfo = await oauth2.userinfo.get()
        email = userInfo.data.email || null
        console.log('[Gmail OAuth] Got email from userinfo:', email)
    } catch (err) {
        console.log('[Gmail OAuth] userinfo failed, trying Gmail profile...', err)
    }

    // Fallback: get email from Gmail profile
    if (!email) {
        try {
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
            const profile = await gmail.users.getProfile({ userId: 'me' })
            email = profile.data.emailAddress || null
            console.log('[Gmail OAuth] Got email from Gmail profile:', email)
        } catch (err) {
            console.error('[Gmail OAuth] Gmail profile also failed:', err)
        }
    }

    if (!email) {
        throw new Error('No se pudo obtener el email de la cuenta de Google')
    }

    // Save tokens to Supabase — now with user_id
    const db = getSupabaseAdmin()
    const { error: dbError } = await db.from('google_tokens').upsert(
        {
            user_id: userId,
            email,
            access_token: tokens.access_token!,
            refresh_token: tokens.refresh_token!,
            token_type: tokens.token_type || 'Bearer',
            expiry_date: tokens.expiry_date,
            scopes: SCOPES,
            updated_at: nowArgentina(),
        },
        { onConflict: 'user_id,email' }
    )

    if (dbError) {
        console.error('[Gmail OAuth] Error saving tokens to Supabase:', dbError)
        throw new Error('Error guardando tokens en la base de datos')
    }

    console.log(`[Gmail OAuth] ✅ Conexión completa para: ${email} (usuario: ${userId})`)
    return { email }
}

/**
 * Obtiene un cliente de Gmail autenticado para un email dado.
 * Usa .limit(1) en vez de .single() para manejar duplicados
 * (tokens huérfanos sin user_id que coexisten con tokens vinculados).
 */
async function getGmailClient(email: string): Promise<gmail_v1.Gmail> {
    const db = getSupabaseAdmin()
    const { data: rows, error } = await db
        .from('google_tokens')
        .select('*')
        .eq('email', email)
        .order('user_id', { ascending: false, nullsFirst: false })
        .limit(1)

    const tokenData = rows?.[0]

    if (error || !tokenData) {
        throw new Error(`No hay tokens de Google para ${email}. Conectá tu cuenta primero.`)
    }

    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type,
        expiry_date: tokenData.expiry_date,
    })

    // Handle token refresh
    oauth2Client.on('tokens', async (newTokens) => {
        const updateData: Record<string, unknown> = {
            updated_at: nowArgentina(),
        }
        if (newTokens.access_token) updateData.access_token = newTokens.access_token
        if (newTokens.refresh_token) updateData.refresh_token = newTokens.refresh_token
        if (newTokens.expiry_date) updateData.expiry_date = newTokens.expiry_date

        await db
            .from('google_tokens')
            .update(updateData)
            .eq('id', tokenData.id)
    })

    return google.gmail({ version: 'v1', auth: oauth2Client })
}

// ─── Email Operations ──────────────────────────────────

export interface ParsedEmail {
    gmailId: string
    threadId: string | null
    from: string | null
    fromName: string | null
    to: string | null
    subject: string | null
    bodyText: string | null
    bodyHtml: string | null
    receivedAt: string | null
    labels: string[]
    attachments: Array<{
        attachmentId: string
        filename: string
        mimeType: string
        size: number
    }>
    driveAttachments: Array<{
        fileId: string
        filename: string
        mimeType: string
    }>
}

/**
 * Obtiene los emails no leídos/no procesados recientes
 */
export async function fetchRecentEmails(
    email: string,
    maxResults = 20
): Promise<ParsedEmail[]> {
    const gmail = await getGmailClient(email)

    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'newer_than:3d -category:promotions -category:social',
        maxResults,
    })

    if (!res.data.messages || res.data.messages.length === 0) {
        return []
    }

    const emails: ParsedEmail[] = []

    for (const msg of res.data.messages) {
        if (!msg.id) continue

        try {
            const fullMsg = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'full',
            })

            const parsed = parseGmailMessage(fullMsg.data)
            if (parsed) emails.push(parsed)
        } catch (err) {
            console.error(`Error fetching email ${msg.id}:`, err)
        }
    }

    return emails
}

/**
 * Parsea un mensaje de Gmail en nuestro formato
 */
function parseGmailMessage(message: gmail_v1.Schema$Message): ParsedEmail | null {
    if (!message.id) return null

    const headers = message.payload?.headers || []
    const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || null

    const fromRaw = getHeader('From')
    let fromEmail: string | null = null
    let fromName: string | null = null

    if (fromRaw) {
        const match = fromRaw.match(/^(.+?)\s*<(.+?)>$/)
        if (match) {
            fromName = match[1].replace(/"/g, '').trim()
            fromEmail = match[2].trim()
        } else {
            fromEmail = fromRaw.trim()
        }
    }

    // Extract body
    let bodyText: string | null = null
    let bodyHtml: string | null = null

    function extractBody(payload: gmail_v1.Schema$MessagePart) {
        if (payload.mimeType === 'text/plain' && payload.body?.data) {
            bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8')
        }
        if (payload.mimeType === 'text/html' && payload.body?.data) {
            bodyHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8')
        }
        if (payload.parts) {
            for (const part of payload.parts) {
                extractBody(part)
            }
        }
    }

    if (message.payload) {
        extractBody(message.payload)
    }

    // If no plain text but we have HTML, strip tags for a text version
    if (!bodyText && bodyHtml) {
        bodyText = (bodyHtml as string)
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    }

    // Extract attachments info
    const attachments: ParsedEmail['attachments'] = []
    const driveAttachments: ParsedEmail['driveAttachments'] = []

    function findAttachments(payload: gmail_v1.Schema$MessagePart) {
        if (payload.filename && payload.body?.attachmentId) {
            attachments.push({
                attachmentId: payload.body.attachmentId,
                filename: payload.filename,
                mimeType: payload.mimeType || 'application/octet-stream',
                size: payload.body.size || 0,
            })
        }

        const driveMimeTypes = [
            'application/vnd.google-apps.spreadsheet',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.drive-sdk'
        ]

        if (payload.mimeType && driveMimeTypes.includes(payload.mimeType)) {
            let fileId = null

            // X-Attachment-Id or X-Google-Drive-Id often contain the file ID for these smart chips
            const partHeaders = payload.headers || []
            const driveIdHeader = partHeaders.find(h => h.name === 'X-Attachment-Id' || h.name?.toLowerCase() === 'x-google-drive-id')

            if (driveIdHeader) {
                // Sometime X-Attachment-Id is prefixed or complex, but usually it's the raw fileId for drive-sdk
                fileId = driveIdHeader.value
            }

            if (fileId) {
                console.log(`[DriveAttachment] Google Drive smart attachment detected: ${payload.filename || fileId}`)
                driveAttachments.push({
                    fileId,
                    filename: payload.filename || `Drive_File_${fileId}`,
                    mimeType: payload.mimeType
                })
            }
        }

        if (payload.parts) {
            for (const part of payload.parts) {
                findAttachments(part)
            }
        }
    }

    if (message.payload) {
        findAttachments(message.payload)
    }

    // Also extract Google Drive links from email body HTML
    // These appear when someone shares a file as a link, not as a smart attachment
    if (bodyHtml) {
        const driveRegex = /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g
        const docsRegex = /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g
        const seenIds = new Set(driveAttachments.map(d => d.fileId))

        for (const regex of [driveRegex, docsRegex]) {
            let match
            while ((match = regex.exec(bodyHtml as string)) !== null) {
                const fileId = match[1]
                if (!seenIds.has(fileId)) {
                    seenIds.add(fileId)
                    console.log(`[Gmail] Found Drive link in body: ${fileId}`)
                    driveAttachments.push({
                        fileId,
                        filename: `Drive_Link_${fileId}`,
                        mimeType: 'application/vnd.google-apps.drive-sdk'
                    })
                }
            }
        }
    }

    // Parse date
    const dateHeader = getHeader('Date')
    let receivedAt: string | null = null
    if (dateHeader) {
        try {
            receivedAt = new Date(dateHeader).toISOString()
        } catch {
            receivedAt = null
        }
    }

    return {
        gmailId: message.id,
        threadId: message.threadId || null,
        from: fromEmail,
        fromName,
        to: getHeader('To'),
        subject: getHeader('Subject'),
        bodyText,
        bodyHtml,
        receivedAt,
        labels: message.labelIds || [],
        attachments,
        driveAttachments,
    }
}

/**
 * Descarga un adjunto de un email
 */
export async function downloadAttachment(
    email: string,
    messageId: string,
    attachmentId: string
): Promise<{ data: Buffer; mimeType: string }> {
    const gmail = await getGmailClient(email)

    const res = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
    })

    const data = Buffer.from(res.data.data || '', 'base64')
    return { data, mimeType: 'application/octet-stream' }
}

/**
 * Intenta descargar un archivo público o accesible desde Google Drive como un Excel, reciclando el seteo de credenciales de Gmail.
 * Ideal para Drive Links y Google Sheets.
 */
export async function downloadDriveFileAndExport(
    email: string,
    fileId: string
): Promise<{ data: Buffer; mimeType: string }> {
    const db = getSupabaseAdmin()
    const { data: tokenData, error } = await db
        .from('google_tokens')
        .select('*')
        .eq('email', email)
        .single()

    if (error || !tokenData) {
        throw new Error(`No hay tokens de Google para ${email}.`)
    }

    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type,
        expiry_date: tokenData.expiry_date,
    })

    const drive = google.drive({ version: 'v3', auth: oauth2Client })

    // Attempt to download the file directly, assuming it might be a Google Sheet
    // we use `export` for Sheets and Docs, and `get(alt=media)` for binary files.

    try {
        const fileRes = await drive.files.get({ fileId, fields: 'mimeType,name' })
        const mimeType = fileRes.data.mimeType || ''

        let response
        const targetXlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

        if (mimeType.includes('apps.spreadsheet')) {
            response = await drive.files.export({
                fileId,
                mimeType: targetXlsxMime,
            }, { responseType: 'arraybuffer' })
            const data = Buffer.from(response.data as ArrayBuffer)
            return { data, mimeType: targetXlsxMime }
        } else {
            response = await drive.files.get({
                fileId,
                alt: 'media',
            }, { responseType: 'arraybuffer' })
            const data = Buffer.from(response.data as ArrayBuffer)
            return { data, mimeType }
        }
    } catch (err) {
        console.error('[Gmail Drive] Error downloading Drive link:', err)
        throw new Error(`No se pudo descargar de Drive o no hay permisos suficientes para ${fileId}`)
    }
}

/**
 * Descarga un archivo de Google Drive compartido públicamente ("cualquiera con el link").
 * NO requiere OAuth ni tokens del sistema - funciona con links que viajantes/clientes comparten.
 * Soporta Google Sheets (exporta como XLSX) y archivos binarios (.xlsx, .pdf, etc).
 *
 * Estrategia de 3 intentos:
 * 1. Export URL de Google Sheets (funciona para Sheets con "cualquiera con el link puede ver")
 * 2. Download directo para archivos .xlsx/.pdf subidos a Drive y compartidos
 * 3. API de Drive con API key de Google (para archivos públicos indexados)
 */
export async function downloadPublicDriveFile(
    fileId: string
): Promise<{ data: Buffer; mimeType: string }> {
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    console.log(`[PublicDrive] Intentando descarga pública de ${fileId}...`)

    // Intento 1: Export de Google Sheets via URL pública
    // Funciona cuando el Sheet está compartido "cualquiera con el link puede ver"
    try {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`
        const response = await fetch(exportUrl, {
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GMVII/1.0)' },
        })

        if (response.ok) {
            const contentType = response.headers.get('content-type') || ''
            // Si Google devuelve HTML es porque no tiene acceso (pide login)
            if (!contentType.includes('text/html')) {
                const arrayBuffer = await response.arrayBuffer()
                const data = Buffer.from(arrayBuffer)
                if (data.length > 1000) { // Mínimo razonable para un XLSX
                    console.log(`[PublicDrive] ✅ Intento 1 exitoso: ${data.length} bytes (Google Sheets export)`)
                    return { data, mimeType: XLSX_MIME }
                }
            }
        }
    } catch (err) {
        console.log(`[PublicDrive] Intento 1 (Sheets export) falló: ${err instanceof Error ? err.message : err}`)
    }

    // Intento 2: Download directo para archivos subidos a Drive y compartidos
    // Funciona para .xlsx, .pdf, etc. compartidos "cualquiera con el link"
    try {
        const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`
        const response = await fetch(directUrl, {
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GMVII/1.0)' },
        })

        if (response.ok) {
            const contentType = response.headers.get('content-type') || ''
            if (!contentType.includes('text/html')) {
                const arrayBuffer = await response.arrayBuffer()
                const data = Buffer.from(arrayBuffer)
                if (data.length > 500) {
                    console.log(`[PublicDrive] ✅ Intento 2 exitoso: ${data.length} bytes (descarga directa, tipo: ${contentType})`)
                    return { data, mimeType: contentType.split(';')[0].trim() || XLSX_MIME }
                }
            }
        }
    } catch (err) {
        console.log(`[PublicDrive] Intento 2 (descarga directa) falló: ${err instanceof Error ? err.message : err}`)
    }

    // Intento 3: API de Drive con API key de Google (reutilizamos la GEMINI_API_KEY que es de Google)
    const apiKey = process.env.GEMINI_API_KEY
    if (apiKey) {
        try {
            // Obtener metadata del archivo
            const metaRes = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name&key=${apiKey}`
            )
            if (metaRes.ok) {
                const meta = await metaRes.json()
                const mimeType = meta.mimeType || ''

                let downloadUrl: string
                if (mimeType.includes('apps.spreadsheet') || mimeType.includes('apps.document')) {
                    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}&key=${apiKey}`
                } else {
                    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`
                }

                const fileRes = await fetch(downloadUrl)
                if (fileRes.ok) {
                    const arrayBuffer = await fileRes.arrayBuffer()
                    const data = Buffer.from(arrayBuffer)
                    if (data.length > 500) {
                        const finalMime = mimeType.includes('apps.') ? XLSX_MIME : mimeType
                        console.log(`[PublicDrive] ✅ Intento 3 exitoso: ${data.length} bytes (API key)`)
                        return { data, mimeType: finalMime }
                    }
                }
            }
        } catch (err) {
            console.log(`[PublicDrive] Intento 3 (API key) falló: ${err instanceof Error ? err.message : err}`)
        }
    }

    throw new Error(`No se pudo descargar el archivo públicamente. El archivo ${fileId} puede no estar compartido con "cualquiera con el link".`)
}

/**
 * Verifica si hay cuentas de Gmail conectadas para un usuario
 * @param userId - ID del usuario del sistema (si no se pasa, devuelve todas — backward compat para webhooks)
 */
export async function getConnectedAccounts(userId?: string): Promise<string[]> {
    const db = getSupabaseAdmin()

    if (userId) {
        // Clean up orphaned tokens (created before user_id migration)
        // These cause .single() failures when duplicate rows exist
        await db
            .from('google_tokens')
            .delete()
            .is('user_id', null)

        // Fetch this user's accounts
        const { data, error } = await db
            .from('google_tokens')
            .select('email')
            .eq('user_id', userId)

        if (error || !data) return []
        return data.map((t) => t.email)
    }

    // No userId — return all (for webhooks)
    const { data, error } = await db.from('google_tokens').select('email')
    if (error || !data) return []
    return data.map((t) => t.email)
}

// ─── Push Notifications (Pub/Sub) ──────────────────────

/**
 * Sets up Gmail Push Notifications via Google Cloud Pub/Sub.
 * Gmail will send a notification to the configured topic whenever
 * the user's mailbox changes (new email, label change, etc.).
 * Watch expires after 7 days and must be renewed.
 */
export async function setupGmailWatch(email: string): Promise<{ historyId: string; expiration: string } | null> {
    const topicName = process.env.GMAIL_PUBSUB_TOPIC
    if (!topicName) {
        console.warn('[Gmail Watch] GMAIL_PUBSUB_TOPIC not configured — skipping watch setup')
        return null
    }

    try {
        const gmail = await getGmailClient(email)
        const db = getSupabaseAdmin()

        const res = await gmail.users.watch({
            userId: 'me',
            requestBody: {
                topicName,
                labelIds: ['INBOX'],
                labelFilterBehavior: 'INCLUDE',
            },
        })

        const historyId = res.data.historyId!
        const expiration = res.data.expiration!

        // Save historyId and watch expiry to DB
        await db
            .from('google_tokens')
            .update({
                history_id: parseInt(historyId),
                watch_expiry: new Date(parseInt(expiration)).toISOString(),
                updated_at: nowArgentina(),
            })
            .eq('email', email)

        console.log(`[Gmail Watch] ✅ Watch setup for ${email} — historyId: ${historyId}, expiry: ${new Date(parseInt(expiration)).toISOString()}`)
        return { historyId, expiration }
    } catch (err) {
        console.error('[Gmail Watch] Error setting up watch:', err)
        return null
    }
}

/**
 * Renews the Gmail watch if it's about to expire (< 1 day remaining).
 * Should be called periodically or before processing.
 */
export async function renewWatchIfNeeded(email: string): Promise<boolean> {
    const db = getSupabaseAdmin()
    const { data: tokenData } = await db
        .from('google_tokens')
        .select('watch_expiry')
        .eq('email', email)
        .single()

    if (!tokenData?.watch_expiry) {
        // No watch set up yet — set it up now
        const result = await setupGmailWatch(email)
        return result !== null
    }

    const expiryDate = new Date(tokenData.watch_expiry)
    const now = new Date()
    const hoursRemaining = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60)

    if (hoursRemaining < 48) {
        console.log(`[Gmail Watch] Watch expiring in ${hoursRemaining.toFixed(1)}h — renewing...`)
        const result = await setupGmailWatch(email)
        return result !== null
    }

    return true // Watch is still valid
}

/**
 * Stops the Gmail watch for a given email
 */
export async function stopGmailWatch(email: string): Promise<void> {
    try {
        const gmail = await getGmailClient(email)
        await gmail.users.stop({ userId: 'me' })

        const db = getSupabaseAdmin()
        await db
            .from('google_tokens')
            .update({ watch_expiry: null, updated_at: nowArgentina() })
            .eq('email', email)

        console.log(`[Gmail Watch] Stopped watch for ${email}`)
    } catch (err) {
        console.error('[Gmail Watch] Error stopping watch:', err)
    }
}

// ─── History-based Incremental Sync ────────────────────

/**
 * Gets the stored historyId for incremental sync
 */
export async function getStoredHistoryId(email: string): Promise<string | null> {
    const db = getSupabaseAdmin()
    const { data } = await db
        .from('google_tokens')
        .select('history_id')
        .eq('email', email)
        .single()

    return data?.history_id ? String(data.history_id) : null
}

/**
 * Updates the stored historyId after processing
 */
export async function updateHistoryId(email: string, historyId: string): Promise<void> {
    const db = getSupabaseAdmin()
    await db
        .from('google_tokens')
        .update({
            history_id: parseInt(historyId),
            updated_at: nowArgentina(),
        })
        .eq('email', email)
}

/**
 * Fetches only NEW emails since the last known historyId.
 * Uses Gmail's history.list API for efficient incremental sync.
 * Falls back to fetchRecentEmails if historyId is invalid/expired.
 */
export async function fetchNewEmailsSinceHistory(
    email: string,
    startHistoryId: string
): Promise<{ emails: ParsedEmail[]; newHistoryId: string | null }> {
    const gmail = await getGmailClient(email)

    try {
        console.log(`[Gmail Sync] Using incremental history sync from historyId: ${startHistoryId}`)

        // Get history changes since last sync
        const historyRes = await gmail.users.history.list({
            userId: 'me',
            startHistoryId,
            historyTypes: ['messageAdded'],
            labelId: 'INBOX',
        })

        const newHistoryId = historyRes.data.historyId || null

        if (!historyRes.data.history || historyRes.data.history.length === 0) {
            console.log('[Gmail Sync] No new history — inbox unchanged')
            // Still update historyId to latest
            if (newHistoryId) await updateHistoryId(email, newHistoryId)
            return { emails: [], newHistoryId }
        }

        // Collect unique new message IDs
        const messageIds = new Set<string>()
        for (const record of historyRes.data.history) {
            if (record.messagesAdded) {
                for (const added of record.messagesAdded) {
                    if (added.message?.id) {
                        messageIds.add(added.message.id)
                    }
                }
            }
        }

        console.log(`[Gmail Sync] Found ${messageIds.size} new message(s) via history`)

        // Fetch and parse each new message
        const emails: ParsedEmail[] = []
        for (const msgId of messageIds) {
            try {
                const fullMsg = await gmail.users.messages.get({
                    userId: 'me',
                    id: msgId,
                    format: 'full',
                })
                const parsed = parseGmailMessage(fullMsg.data)
                if (parsed) emails.push(parsed)
            } catch (err) {
                console.error(`[Gmail Sync] Error fetching message ${msgId}:`, err)
            }
        }

        // Update stored historyId
        if (newHistoryId) await updateHistoryId(email, newHistoryId)

        return { emails, newHistoryId }
    } catch (err: unknown) {
        // historyId expired or invalid — Gmail returns 404
        const isHistoryError = err instanceof Error && (
            err.message.includes('404') ||
            err.message.includes('historyId') ||
            err.message.includes('Start history id')
        )

        if (isHistoryError) {
            console.warn('[Gmail Sync] HistoryId expired — falling back to full recent fetch')

            // Do a full fetch and get the current historyId from profile
            const emails = await fetchRecentEmails(email, 30)

            // Get current historyId from profile for future incremental syncs
            const profileRes = await gmail.users.getProfile({ userId: 'me' })
            const currentHistoryId = profileRes.data.historyId || null
            if (currentHistoryId) await updateHistoryId(email, currentHistoryId)

            return { emails, newHistoryId: currentHistoryId }
        }

        throw err
    }
}
