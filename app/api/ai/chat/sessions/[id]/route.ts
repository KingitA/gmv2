// AI Chat Sessions — Close (archive) a specific session
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'
import { requireAuth } from '@/lib/auth'

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id } = await params
        const db = getSupabaseAdmin()

        const { error } = await db
            .from('ai_conversations')
            .update({ status: 'archived', updated_at: new Date().toISOString() })
            .eq('id', id)

        if (error) {
            console.error('Error archiving session:', error)
            return NextResponse.json({ error: 'Error al cerrar sesión' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error in session DELETE:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
