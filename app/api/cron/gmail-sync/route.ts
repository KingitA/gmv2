// Cron Job: Auto-sync Gmail for all connected accounts
// Runs every 2 minutes via Vercel Cron
import { NextResponse } from 'next/server'
import { getConnectedAccounts, fetchRecentEmails, getStoredHistoryId, fetchNewEmailsSinceHistory, renewWatchIfNeeded } from '@/lib/ai/gmail'
import { processBatchEmails } from '@/lib/ai/email-processor-pipeline'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'

export const maxDuration = 60 // Allow up to 60s for the cron to complete

export async function GET(request: Request) {
    try {
        // Verify cron secret
        const authHeader = request.headers.get('authorization')
        if (
            process.env.CRON_SECRET &&
            authHeader !== `Bearer ${process.env.CRON_SECRET}`
        ) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('[CRON Gmail] Starting auto-sync...')

        // Get ALL connected Gmail accounts (no userId filter — sync all users)
        const accounts = await getConnectedAccounts()

        if (accounts.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No hay cuentas de Gmail conectadas',
                accounts: 0,
            })
        }

        const results: { email: string; synced: number; mode: string; error?: string }[] = []

        for (const email of accounts) {
            try {
                // Renew watch if needed
                await renewWatchIfNeeded(email)

                // Try incremental sync, fallback to full
                const storedHistoryId = await getStoredHistoryId(email)
                let emails
                let syncMode: string

                if (storedHistoryId) {
                    const historyResult = await fetchNewEmailsSinceHistory(email, storedHistoryId)
                    emails = historyResult.emails
                    syncMode = 'incremental'
                } else {
                    emails = await fetchRecentEmails(email, 10)
                    syncMode = 'full'
                }

                // Process emails through the pipeline
                const batchResult = await processBatchEmails(emails, email)

                results.push({
                    email,
                    synced: batchResult.newEmails,
                    mode: syncMode,
                })

                console.log(`[CRON Gmail] ${email}: ${batchResult.newEmails} nuevos emails (${syncMode})`)
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Error desconocido'
                console.error(`[CRON Gmail] Error syncing ${email}:`, errorMsg)
                results.push({ email, synced: 0, mode: 'error', error: errorMsg })
            }
        }

        console.log(`[CRON Gmail] Sync complete. ${results.length} accounts processed.`)

        return NextResponse.json({
            success: true,
            accounts: results.length,
            results,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error('[CRON Gmail] Fatal error:', error)
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
