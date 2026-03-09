// Gmail Sync — Manual sync endpoint (also used as fallback)
// Now uses incremental history-based sync when possible
import { NextResponse, type NextRequest } from 'next/server'
import { fetchRecentEmails, getConnectedAccounts, getStoredHistoryId, fetchNewEmailsSinceHistory, renewWatchIfNeeded } from '@/lib/ai/gmail'
import { processBatchEmails, type BatchProcessingResult } from '@/lib/ai/email-processor-pipeline'
import type { GmailSyncResult } from '@/lib/ai/types'
import { requireAuth } from '@/lib/auth'

// Extended result type for sync
interface ExtendedSyncResult extends GmailSyncResult {
    ordersProcessed: number
    ordersAutoCreated: number
    ordersSentToReview: number
    invoicesProcessed: number
    paymentsProcessed: number
    priceChangesProcessed: number
    syncMode: 'incremental' | 'full'
}

export async function POST(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await request.json().catch(() => ({}))
        const email = body.email as string | undefined

        // Determine which email to sync
        let targetEmail = email
        if (!targetEmail) {
            const accounts = await getConnectedAccounts(auth.user.id)
            if (accounts.length === 0) {
                return NextResponse.json(
                    { error: 'No hay cuentas de Gmail conectadas. Conectá tu cuenta primero.' },
                    { status: 400 }
                )
            }
            targetEmail = accounts[0]
        }

        // Renew watch if configured and about to expire
        await renewWatchIfNeeded(targetEmail)

        // Try incremental sync first, fallback to full fetch
        const storedHistoryId = await getStoredHistoryId(targetEmail)
        let emails
        let syncMode: 'incremental' | 'full'

        if (storedHistoryId) {
            console.log(`[Gmail Sync] Using incremental sync from historyId: ${storedHistoryId}`)
            const historyResult = await fetchNewEmailsSinceHistory(targetEmail, storedHistoryId)
            emails = historyResult.emails
            syncMode = 'incremental'
        } else {
            console.log('[Gmail Sync] No historyId stored — using full recent fetch')
            emails = await fetchRecentEmails(targetEmail, 15)
            syncMode = 'full'
        }

        // Process all emails through the shared pipeline
        const batchResult: BatchProcessingResult = await processBatchEmails(emails, targetEmail)

        // Build response matching the original ExtendedSyncResult format
        const result: ExtendedSyncResult = {
            totalFetched: batchResult.totalProcessed,
            newEmails: batchResult.newEmails,
            classified: batchResult.classified,
            eventsCreated: batchResult.eventsCreated,
            errors: batchResult.errors,
            ordersProcessed: batchResult.ordersProcessed,
            ordersAutoCreated: batchResult.ordersAutoCreated,
            ordersSentToReview: batchResult.ordersSentToReview,
            invoicesProcessed: batchResult.invoicesProcessed,
            paymentsProcessed: batchResult.paymentsProcessed,
            priceChangesProcessed: batchResult.priceChangesProcessed,
            syncMode,
        }

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error in Gmail sync:', error)
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// GET - Check sync status and connected accounts
export async function GET() {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const accounts = await getConnectedAccounts(auth.user.id)
        const { getSupabaseAdmin } = await import('@/lib/ai/supabase-admin')
        const db = getSupabaseAdmin()

        const { count: emailCount } = await db
            .from('ai_emails')
            .select('*', { count: 'exact', head: true })

        const { count: eventCount } = await db
            .from('ai_agenda_events')
            .select('*', { count: 'exact', head: true })

        const { count: pendingImports } = await db
            .from('imports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')

        // Check watch status for connected accounts
        const watchStatus: Record<string, { historyId: string | null; watchExpiry: string | null }> = {}
        for (const account of accounts) {
            const historyId = await getStoredHistoryId(account)
            const { data: tokenData } = await db
                .from('google_tokens')
                .select('watch_expiry')
                .eq('email', account)
                .single()

            watchStatus[account] = {
                historyId,
                watchExpiry: tokenData?.watch_expiry || null,
            }
        }

        return NextResponse.json({
            connectedAccounts: accounts,
            totalEmailsSynced: emailCount || 0,
            totalEvents: eventCount || 0,
            pendingImportReviews: pendingImports || 0,
            watchStatus,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
