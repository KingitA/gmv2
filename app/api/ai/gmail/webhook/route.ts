// =====================================================
// Gmail Push Notifications Webhook
// Receives notifications from Google Cloud Pub/Sub
// when new emails arrive in the connected Gmail account
// =====================================================

import { NextResponse, type NextRequest } from 'next/server'
import { getStoredHistoryId, fetchNewEmailsSinceHistory, getConnectedAccounts, renewWatchIfNeeded } from '@/lib/ai/gmail'
import { processBatchEmails } from '@/lib/ai/email-processor-pipeline'

/**
 * POST — Pub/Sub push notification handler
 * 
 * Google Pub/Sub sends a POST request with this format:
 * {
 *   "message": {
 *     "data": "<base64 encoded JSON>",   // {"emailAddress": "...", "historyId": 12345}
 *     "messageId": "...",
 *     "publishTime": "..."
 *   },
 *   "subscription": "projects/.../subscriptions/..."
 * }
 */
export async function POST(request: NextRequest) {
    try {
        // Validate webhook secret if configured
        const webhookSecret = process.env.GMAIL_WEBHOOK_SECRET
        if (webhookSecret) {
            const authHeader = request.headers.get('authorization')
            const urlSecret = request.nextUrl.searchParams.get('secret')

            if (authHeader !== `Bearer ${webhookSecret}` && urlSecret !== webhookSecret) {
                console.warn('[Gmail Webhook] Unauthorized request — invalid secret')
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        const body = await request.json()

        // Parse Pub/Sub message
        const pubsubMessage = body.message
        if (!pubsubMessage?.data) {
            console.warn('[Gmail Webhook] No Pub/Sub message data')
            // Return 200 to acknowledge (don't retry)
            return NextResponse.json({ status: 'no_data' })
        }

        // Decode base64 data
        const decodedData = Buffer.from(pubsubMessage.data, 'base64').toString('utf-8')
        const notification = JSON.parse(decodedData) as {
            emailAddress: string
            historyId: number
        }

        console.log(`[Gmail Webhook] 📬 Notification received for ${notification.emailAddress} — historyId: ${notification.historyId}`)

        // Verify this is a connected account
        const connectedAccounts = await getConnectedAccounts()
        if (!connectedAccounts.includes(notification.emailAddress)) {
            console.warn(`[Gmail Webhook] Email ${notification.emailAddress} is not a connected account — ignoring`)
            return NextResponse.json({ status: 'ignored', reason: 'not_connected' })
        }

        // Renew watch if needed (proactive renewal)
        await renewWatchIfNeeded(notification.emailAddress)

        // Get stored historyId for incremental fetch
        const storedHistoryId = await getStoredHistoryId(notification.emailAddress)

        if (!storedHistoryId) {
            console.warn('[Gmail Webhook] No stored historyId — cannot do incremental sync. Run manual sync first.')
            return NextResponse.json({ status: 'skipped', reason: 'no_history_id' })
        }

        // Fetch only new emails since last processed historyId
        const { emails } = await fetchNewEmailsSinceHistory(
            notification.emailAddress,
            storedHistoryId
        )

        if (emails.length === 0) {
            console.log('[Gmail Webhook] No new emails to process')
            return NextResponse.json({ status: 'ok', newEmails: 0 })
        }

        // Process all new emails through the shared pipeline
        const result = await processBatchEmails(emails, notification.emailAddress)

        console.log(`[Gmail Webhook] ✅ Processed ${result.newEmails} new email(s) — ${result.ordersAutoCreated} orders created, ${result.invoicesProcessed} invoices, ${result.paymentsProcessed} payments`)

        return NextResponse.json({
            status: 'ok',
            ...result,
        })
    } catch (error) {
        console.error('[Gmail Webhook] Error processing notification:', error)
        const message = error instanceof Error ? error.message : 'Unknown error'
        // Return 500 so Pub/Sub retries
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

/**
 * GET — Health check / status endpoint
 */
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        service: 'gmail-webhook',
        description: 'Receives Gmail push notifications via Google Cloud Pub/Sub',
    })
}
