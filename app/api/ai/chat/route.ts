import { nowArgentina, todayArgentina } from "@/lib/utils"
// AI Chat — Conversational endpoint
import { NextResponse, type NextRequest } from 'next/server'
import { chat } from '@/lib/ai/claude'
import { getSupabaseAdmin } from '@/lib/ai/supabase-admin'
import type { ChatMessage } from '@/lib/ai/types'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await request.json()
        const {
            message,
            conversationId,
        } = body as {
            message: string
            conversationId?: string
        }

        if (!message?.trim()) {
            return NextResponse.json(
                { error: 'El mensaje no puede estar vacío' },
                { status: 400 }
            )
        }

        const db = getSupabaseAdmin()
        let convId = conversationId

        // Create or get conversation
        if (!convId) {
            const { data: conv, error: convError } = await db
                .from('ai_conversations')
                .insert({
                    title: message.substring(0, 100),
                    source: 'chat',
                    status: 'active',
                })
                .select('id')
                .single()

            if (convError || !conv) {
                return NextResponse.json(
                    { error: 'Error creando conversación' },
                    { status: 500 }
                )
            }
            convId = conv.id
        }

        // Save user message
        await db.from('ai_messages').insert({
            conversation_id: convId,
            role: 'user',
            content: message,
        })

        // Get conversation history (last 20 messages)
        const { data: history } = await db
            .from('ai_messages')
            .select('role, content')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true })
            .limit(20)

        const messages: ChatMessage[] = (history || []).map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }))

        // Build ERP context from Supabase
        let dbContext = ''
        try {
            dbContext = await buildERPContext(db, message)
        } catch (err) {
            console.error('Error building ERP context:', err)
        }

        // Get Claude response
        const response = await chat(messages, dbContext)

        // Save assistant message
        await db.from('ai_messages').insert({
            conversation_id: convId,
            role: 'assistant',
            content: response,
        })

        // Update conversation timestamp for 7-day expiry tracking
        await db.from('ai_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', convId)

        return NextResponse.json({
            response,
            conversationId: convId,
        })
    } catch (error) {
        console.error('Error in AI chat:', error)
        const message = error instanceof Error ? error.message : 'Error desconocido'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

/**
 * Construye contexto del ERP basado en el mensaje del usuario.
 * Siempre incluye un estado básico del sistema, y agrega datos
 * específicos según lo que pregunte el usuario.
 */
async function buildERPContext(db: ReturnType<typeof getSupabaseAdmin>, userMessage: string): Promise<string> {
    const contextParts: string[] = []
    const lowerMsg = userMessage.toLowerCase()

    // ── SIEMPRE: Estado básico del sistema ────────────────
    try {
        const { count: emailCount } = await db
            .from('ai_emails')
            .select('*', { count: 'exact', head: true })

        const { count: eventCount } = await db
            .from('ai_agenda_events')
            .select('*', { count: 'exact', head: true })
            .in('status', ['pendiente', 'en_progreso'])

        const { data: accounts } = await db
            .from('google_tokens')
            .select('email')

        const connectedEmails = accounts?.map((a) => a.email) || []

        contextParts.push('📊 ESTADO DEL SISTEMA:')
        contextParts.push(`- Cuentas Gmail conectadas: ${connectedEmails.length > 0 ? connectedEmails.join(', ') : 'Ninguna (el usuario debe conectar Gmail desde la pestaña Config del chat)'}`)
        contextParts.push(`- Emails sincronizados: ${emailCount || 0}`)
        contextParts.push(`- Eventos en agenda: ${eventCount || 0} pendientes`)
    } catch {
        // Silently continue
    }

    // ── Emails ─────────────────────────────────────────
    if (lowerMsg.includes('email') || lowerMsg.includes('mail') || lowerMsg.includes('correo') || lowerMsg.includes('llegó') || lowerMsg.includes('recibí') || lowerMsg.includes('mensaje')) {
        const { data: recentEmails } = await db
            .from('ai_emails')
            .select('from_name, from_email, subject, classification, entity_type, entity_name, ai_summary, received_at')
            .order('received_at', { ascending: false })
            .limit(10)

        if (recentEmails?.length) {
            contextParts.push('')
            contextParts.push('📧 EMAILS RECIENTES:')
            for (const e of recentEmails) {
                contextParts.push(
                    `- De: ${e.from_name || e.from_email} | Asunto: ${e.subject} | Tipo: ${e.classification} | ${e.entity_type === 'cliente' ? 'Cliente' : e.entity_type === 'proveedor' ? 'Proveedor' : 'Desconocido'}: ${e.entity_name || 'N/A'} | Resumen: ${e.ai_summary}`
                )
            }
        } else {
            contextParts.push('')
            contextParts.push('📧 EMAILS: No hay emails sincronizados todavía. El usuario debe sincronizar Gmail haciendo clic en el ícono 📧 en el chat o conectando su cuenta desde la pestaña Config.')
        }
    }

    // ── Agenda ─────────────────────────────────────────
    if (lowerMsg.includes('agenda') || lowerMsg.includes('tarea') || lowerMsg.includes('pendiente') || lowerMsg.includes('hoy') || lowerMsg.includes('evento')) {
        const today = todayArgentina()
        const { data: events } = await db
            .from('ai_agenda_events')
            .select('title, description, event_type, priority, status, due_date')
            .in('status', ['pendiente', 'en_progreso'])
            .order('due_date', { ascending: true })
            .limit(15)

        if (events?.length) {
            contextParts.push('')
            contextParts.push(`📅 AGENDA (hoy: ${today}):`)
            for (const ev of events) {
                contextParts.push(
                    `- [${ev.priority?.toUpperCase()}] ${ev.title} | Tipo: ${ev.event_type} | Estado: ${ev.status} | Vence: ${ev.due_date || 'sin fecha'}`
                )
            }
        } else {
            contextParts.push('')
            contextParts.push('📅 AGENDA: No hay eventos pendientes.')
        }
    }

    // ── Clientes ───────────────────────────────────────
    if (lowerMsg.includes('cliente')) {
        const { data: clients } = await db
            .from('clientes')
            .select('id, nombre, email, telefono, localidad')
            .limit(10)

        if (clients?.length) {
            contextParts.push('')
            contextParts.push(`👥 CLIENTES (primeros ${clients.length}):`)
            for (const c of clients) {
                contextParts.push(`- ${c.nombre} | ${c.email || 'sin email'} | ${c.localidad || ''}`)
            }
        }
    }

    // ── Proveedores ───────────────────────────────────
    if (lowerMsg.includes('proveedor')) {
        const { data: providers } = await db
            .from('proveedores')
            .select('id, nombre, email, telefono')
            .limit(10)

        if (providers?.length) {
            contextParts.push('')
            contextParts.push(`🏭 PROVEEDORES (primeros ${providers.length}):`)
            for (const p of providers) {
                contextParts.push(`- ${p.nombre} | ${p.email || 'sin email'}`)
            }
        }
    }

    // ── Pedidos ────────────────────────────────────────
    if (lowerMsg.includes('pedido') || lowerMsg.includes('orden')) {
        const { data: orders } = await db
            .from('pedidos')
            .select('id, cliente_id, estado, total, created_at')
            .order('created_at', { ascending: false })
            .limit(10)

        if (orders?.length) {
            contextParts.push('')
            contextParts.push(`📦 PEDIDOS RECIENTES:`)
            for (const o of orders) {
                contextParts.push(`- Pedido #${o.id} | Cliente: ${o.cliente_id} | Estado: ${o.estado} | Total: $${o.total}`)
            }
        }
    }

    // ── Artículos / Stock ─────────────────────────────
    if (lowerMsg.includes('stock') || lowerMsg.includes('artículo') || lowerMsg.includes('producto')) {
        const { data: articles } = await db
            .from('articulos')
            .select('id, descripcion, stock, precio_venta')
            .limit(10)

        if (articles?.length) {
            contextParts.push('')
            contextParts.push(`📋 ARTÍCULOS (muestra):`)
            for (const a of articles) {
                contextParts.push(`- ${a.descripcion} | Stock: ${a.stock} | Precio: $${a.precio_venta}`)
            }
        }
    }

    return contextParts.join('\n')
}

// GET - Get conversation history
export async function GET(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const searchParams = request.nextUrl.searchParams
    const conversationId = searchParams.get('conversationId')

    const db = getSupabaseAdmin()

    if (conversationId) {
        const { data: messages } = await db
            .from('ai_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })

        return NextResponse.json({ messages: messages || [] })
    }

    // Return recent conversations
    const { data: conversations } = await db
        .from('ai_conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20)

    return NextResponse.json({ conversations: conversations || [] })
}
