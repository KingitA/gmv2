// Google OAuth — Callback
import { NextResponse, type NextRequest } from 'next/server'
import { exchangeCodeForTokens, setupGmailWatch } from '@/lib/ai/gmail'

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
        console.error('Google OAuth error:', error)
        return NextResponse.redirect(
            new URL('/?gmail_error=' + encodeURIComponent(error), request.url)
        )
    }

    if (!code) {
        return NextResponse.redirect(
            new URL('/?gmail_error=no_code', request.url)
        )
    }

    try {
        const { email } = await exchangeCodeForTokens(code)
        console.log(`Google OAuth completo para: ${email}`)

        // Set up Gmail Push Notifications (Pub/Sub) automatically
        // This is fire-and-forget — if GMAIL_PUBSUB_TOPIC is not configured, it skips gracefully
        setupGmailWatch(email).catch(err => {
            console.error('[Gmail OAuth Callback] Error setting up watch:', err)
        })

        return NextResponse.redirect(
            new URL('/?gmail_connected=' + encodeURIComponent(email), request.url)
        )
    } catch (err) {
        console.error('Error exchanging Google code for tokens:', err)
        return NextResponse.redirect(
            new URL('/?gmail_error=token_exchange_failed', request.url)
        )
    }
}
