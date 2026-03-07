import { nowArgentina, todayArgentina } from "@/lib/utils"
// AI Agenda — CRUD for agenda events
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'
import { requireAuth } from '@/lib/auth'

// GET — List events (with optional filters)
export async function GET(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const searchParams = request.nextUrl.searchParams
        const status = searchParams.get('status')
        const eventType = searchParams.get('type')
        const date = searchParams.get('date')
        const priority = searchParams.get('priority')

        const db = getSupabaseAdmin()
        let query = db
            .from('ai_agenda_events')
            .select('*')
            .order('due_date', { ascending: true, nullsFirst: false })
            .order('priority', { ascending: false })

        if (status) {
            query = query.eq('status', status)
        } else {
            // By default show active events
            query = query.in('status', ['pendiente', 'en_progreso'])
        }

        if (eventType) query = query.eq('event_type', eventType)
        if (date) query = query.eq('due_date', date)
        if (priority) query = query.eq('priority', priority)

        const { data, error } = await query.limit(50)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ events: data || [] })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// POST — Create a new event
export async function POST(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await request.json()
        const {
            title,
            description,
            event_type,
            priority = 'media',
            due_date,
            due_time,
            source = 'chat',
        } = body

        if (!title || !event_type) {
            return NextResponse.json(
                { error: 'title y event_type son obligatorios' },
                { status: 400 }
            )
        }

        const db = getSupabaseAdmin()
        const { data, error } = await db
            .from('ai_agenda_events')
            .insert({
                title,
                description: description || null,
                event_type,
                priority,
                status: 'pendiente',
                due_date: due_date || null,
                due_time: due_time || null,
                source,
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ event: data })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// PATCH — Update an event (status, priority, etc.)
export async function PATCH(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await request.json()
        const { id, ...updates } = body

        if (!id) {
            return NextResponse.json(
                { error: 'id es obligatorio' },
                { status: 400 }
            )
        }

        const db = getSupabaseAdmin()
        const { data, error } = await db
            .from('ai_agenda_events')
            .update({
                ...updates,
                updated_at: nowArgentina(),
            })
            .eq('id', id)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ event: data })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// DELETE — Delete an event
export async function DELETE(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const searchParams = request.nextUrl.searchParams
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json(
                { error: 'id es obligatorio' },
                { status: 400 }
            )
        }

        const db = getSupabaseAdmin()
        const { error } = await db
            .from('ai_agenda_events')
            .delete()
            .eq('id', id)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
