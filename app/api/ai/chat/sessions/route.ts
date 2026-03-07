// AI Chat Sessions — List active sessions (last 7 days)
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'
import { requireAuth } from '@/lib/auth'

export async function GET() {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const db = getSupabaseAdmin()

        // Get active conversations from the last 7 days
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

        const { data: conversations, error } = await db
            .from('ai_conversations')
            .select('id, title, source, status, created_at, updated_at')
            .eq('status', 'active')
            .eq('source', 'chat')
            .gte('updated_at', sevenDaysAgo.toISOString())
            .order('updated_at', { ascending: false })

        if (error) {
            console.error('Error fetching sessions:', error)
            return NextResponse.json({ error: 'Error al obtener sesiones' }, { status: 500 })
        }

        // Auto-archive conversations older than 7 days
        await db
            .from('ai_conversations')
            .update({ status: 'archived' })
            .eq('status', 'active')
            .eq('source', 'chat')
            .lt('updated_at', sevenDaysAgo.toISOString())

        return NextResponse.json({ sessions: conversations || [] })
    } catch (error) {
        console.error('Error in sessions GET:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
