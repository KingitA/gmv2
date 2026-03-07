// AI Emails — Fetch synced emails for inbox view
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const searchParams = request.nextUrl.searchParams
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

        const db = getSupabaseAdmin()
        const { data, error } = await db
            .from('ai_emails')
            .select('id, gmail_id, subject, from_name, from_email, received_at, ai_summary, classification, is_read, is_processed')
            .order('received_at', { ascending: false })
            .limit(limit)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ emails: data || [] })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
