// Gmail Diagnostic — Tests each step of the sync pipeline and reports status
import { NextResponse } from 'next/server'
import { getConnectedAccounts } from '@/lib/ai/gmail'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'
import { requireAuth } from '@/lib/auth'

export async function GET() {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const steps: { step: string; status: string; detail?: unknown }[] = []
    const db = getSupabaseAdmin()

    try {
        // Step 1: Check connected accounts
        const accounts = await getConnectedAccounts(auth.user.id)
        steps.push({
            step: '1. Cuentas conectadas',
            status: accounts.length > 0 ? '✅' : '❌ Sin cuentas',
            detail: { accounts, userId: auth.user.id },
        })

        if (accounts.length === 0) {
            return NextResponse.json({ steps })
        }

        const email = accounts[0]

        // Step 2: Check token exists and has refresh_token
        const { data: token, error: tokenError } = await db
            .from('google_tokens')
            .select('email, user_id, access_token, refresh_token, expiry_date, updated_at')
            .eq('email', email)
            .single()

        if (tokenError || !token) {
            steps.push({
                step: '2. Token en base de datos',
                status: '❌ No encontrado',
                detail: tokenError?.message,
            })
            return NextResponse.json({ steps })
        }

        steps.push({
            step: '2. Token en base de datos',
            status: '✅',
            detail: {
                email: token.email,
                user_id: token.user_id,
                has_access_token: !!token.access_token,
                has_refresh_token: !!token.refresh_token,
                access_token_preview: token.access_token?.substring(0, 20) + '...',
                expiry_date: token.expiry_date,
                is_expired: token.expiry_date ? Date.now() > token.expiry_date : 'unknown',
                updated_at: token.updated_at,
            },
        })

        // Step 3: Try to create Gmail client and list messages
        try {
            const { google } = await import('googleapis')

            // Build OAuth client
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            )

            steps.push({
                step: '3. Variables de entorno Google',
                status: '✅',
                detail: {
                    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? '✅ set (' + process.env.GOOGLE_CLIENT_ID.substring(0, 15) + '...)' : '❌ MISSING',
                    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? '✅ set' : '❌ MISSING',
                    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || '❌ MISSING',
                },
            })

            oauth2Client.setCredentials({
                access_token: token.access_token,
                refresh_token: token.refresh_token,
                token_type: 'Bearer',
                expiry_date: token.expiry_date,
            })

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

            // Step 4: Try to list messages
            const listResult = await gmail.users.messages.list({
                userId: 'me',
                q: 'newer_than:3d',
                maxResults: 5,
            })

            steps.push({
                step: '4. Gmail API - listar mensajes',
                status: '✅',
                detail: {
                    totalMessages: listResult.data.resultSizeEstimate,
                    messageIds: listResult.data.messages?.map(m => m.id) || [],
                },
            })

            // Step 5: Try to fetch one email
            if (listResult.data.messages && listResult.data.messages.length > 0) {
                const firstMsgId = listResult.data.messages[0].id!
                const msgResult = await gmail.users.messages.get({
                    userId: 'me',
                    id: firstMsgId,
                    format: 'metadata',
                    metadataHeaders: ['From', 'Subject', 'Date'],
                })

                const headers = msgResult.data.payload?.headers || []
                steps.push({
                    step: '5. Gmail API - leer email de prueba',
                    status: '✅',
                    detail: {
                        id: firstMsgId,
                        from: headers.find(h => h.name === 'From')?.value,
                        subject: headers.find(h => h.name === 'Subject')?.value,
                        date: headers.find(h => h.name === 'Date')?.value,
                    },
                })
            } else {
                steps.push({
                    step: '5. Gmail API - leer email',
                    status: '⚠️ No hay mensajes en los últimos 3 días',
                })
            }
        } catch (gmailError: any) {
            steps.push({
                step: '3-5. Gmail API',
                status: '❌ Error',
                detail: {
                    message: gmailError?.message,
                    code: gmailError?.code,
                    errors: gmailError?.errors,
                    response_data: gmailError?.response?.data,
                },
            })
        }

        // Step 6: Check ai_emails table
        const { count: emailCount } = await db
            .from('ai_emails')
            .select('*', { count: 'exact', head: true })

        const { data: recentEmails } = await db
            .from('ai_emails')
            .select('gmail_id, from_email, subject, received_at, processing_status')
            .order('received_at', { ascending: false })
            .limit(3)

        steps.push({
            step: '6. Emails en base de datos (ai_emails)',
            status: emailCount && emailCount > 0 ? '✅' : '⚠️ Tabla vacía',
            detail: {
                totalEmails: emailCount || 0,
                recentEmails: recentEmails || [],
            },
        })

        return NextResponse.json({ steps })
    } catch (error: any) {
        steps.push({
            step: 'ERROR GENERAL',
            status: '❌',
            detail: error?.message || error,
        })
        return NextResponse.json({ steps }, { status: 500 })
    }
}
