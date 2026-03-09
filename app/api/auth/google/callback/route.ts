// Google OAuth — Callback
import { NextResponse, type NextRequest } from 'next/server'
import { exchangeCodeForTokens, setupGmailWatch } from '@/lib/ai/gmail'

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const userId = searchParams.get('state') // user_id passed via OAuth state

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

    if (!userId) {
        console.error('Google OAuth callback: no user_id in state')
        return NextResponse.redirect(
            new URL('/?gmail_error=no_user', request.url)
        )
    }

    try {
        const { email } = await exchangeCodeForTokens(code, userId)
        console.log(`Google OAuth completo para: ${email} (usuario: ${userId})`)

        // Set up Gmail Push Notifications (Pub/Sub) automatically
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
