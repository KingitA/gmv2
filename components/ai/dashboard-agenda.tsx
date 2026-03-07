'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
    Calendar,
    Clock,
    CheckCircle2,
    AlertTriangle,
    Package,
    CreditCard,
    BarChart3,
    MessageSquare,
    Loader2,
    Check,
    Truck,
    ClipboardList,
    RefreshCw,
    Mail,
} from 'lucide-react'
import type { AiAgendaEvent } from '@/lib/ai/types'

// ─── Email Types ───────────────────────────────────────

interface InboxEmail {
    id: string
    gmail_id: string
    subject: string | null
    from_name: string | null
    from_email: string | null
    received_at: string | null
    ai_summary: string | null
    classification: string | null
    is_read: boolean
    is_processed: boolean
}

// ─── Config ────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Calendar; label: string; color: string; bg: string }> = {
    vencimiento_proveedor: { icon: Clock, label: 'Vencimiento', color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
    pedido_preparar: { icon: Package, label: 'Pedido', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
    mercaderia_recibir: { icon: Package, label: 'Recepción', color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
    cambio_precio: { icon: BarChart3, label: 'Precio', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-100' },
    pago_imputar: { icon: CreditCard, label: 'Pago', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-100' },
    reclamo_resolver: { icon: AlertTriangle, label: 'Reclamo', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
    tarea_general: { icon: CheckCircle2, label: 'Tarea', color: 'text-neutral-600', bg: 'bg-neutral-50 border-neutral-100' },
    recordatorio: { icon: MessageSquare, label: 'Recordatorio', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100' },
    pedido_link_drive: { icon: Package, label: 'Pedido Drive', color: 'text-teal-600', bg: 'bg-teal-50 border-teal-100' },
}

const PRIORITY_COLORS: Record<string, string> = {
    urgente: 'bg-red-500',
    alta: 'bg-orange-500',
    media: 'bg-yellow-400',
    baja: 'bg-green-400',
}

interface FilterTab {
    id: string
    label: string
    icon: typeof Calendar
    count?: number
}

// ─── Main Component ────────────────────────────────────

interface DashboardAgendaProps {
    initialViajes: any[]
    totalPedidosPendientes: number
    saldosCount: number
}

export function DashboardAgenda({ initialViajes, totalPedidosPendientes, saldosCount }: DashboardAgendaProps) {
    const [events, setEvents] = useState<AiAgendaEvent[]>([])
    const [emails, setEmails] = useState<InboxEmail[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSyncing, setIsSyncing] = useState(false)
    const [activeFilter, setActiveFilter] = useState('all')
    const [fetchError, setFetchError] = useState<string | null>(null)

    const fetchEvents = useCallback(async () => {
        setIsLoading(true)
        setFetchError(null)
        try {
            if (activeFilter === 'emails') {
                const res = await fetch('/api/ai/emails')
                if (res.ok) {
                    const data = await res.json()
                    setEmails(data.emails || [])
                } else {
                    console.error('[DashboardAgenda] Error fetching emails:', res.status, res.statusText)
                    setFetchError('Error cargando emails')
                }
            } else {
                const params = new URLSearchParams()
                if (activeFilter !== 'all') params.set('type', activeFilter)
                const res = await fetch(`/api/ai/agenda?${params.toString()}`)
                if (res.ok) {
                    const data = await res.json()
                    setEvents(data.events || [])
                } else {
                    console.error('[DashboardAgenda] Error fetching events:', res.status, res.statusText)
                    setFetchError('Error cargando eventos')
                }
            }
        } catch (err) {
            console.error('[DashboardAgenda] Network error fetching data:', err)
            setFetchError('Error de conexión al cargar datos')
        } finally {
            setIsLoading(false)
        }
    }, [activeFilter])

    useEffect(() => {
        fetchEvents()
    }, [fetchEvents])

    const markComplete = async (id: string) => {
        try {
            await fetch('/api/ai/agenda', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: 'completada' }),
            })
            setEvents(prev => prev.filter(e => e.id !== id))
        } catch (err) {
            console.error('[DashboardAgenda] Error marking event complete:', err)
        }
    }

    const syncGmail = async () => {
        setIsSyncing(true)
        try {
            const res = await fetch('/api/ai/gmail/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            })
            const data = await res.json()
            console.log('[DashboardAgenda] Sync result:', data)
            fetchEvents()
        } catch (err) {
            console.error('[DashboardAgenda] Error syncing Gmail:', err)
        } finally {
            setIsSyncing(false)
        }
    }

    const today = new Date().toISOString().split('T')[0]
    const overdueEvents = events.filter(e => e.due_date && e.due_date < today)
    const todayEvents = events.filter(e => e.due_date === today)
    const upcomingEvents = events.filter(e => !e.due_date || e.due_date > today)

    const FILTERS: FilterTab[] = [
        { id: 'all', label: 'Todo', icon: Calendar, count: events.length },
        { id: 'emails', label: 'Emails', icon: Mail, count: emails.length },
        { id: 'pedido_preparar', label: 'Pedidos', icon: ClipboardList, count: events.filter(e => e.event_type === 'pedido_preparar').length },
        { id: 'vencimiento_proveedor', label: 'Vencimientos', icon: Clock, count: events.filter(e => e.event_type === 'vencimiento_proveedor').length },
        { id: 'pago_imputar', label: 'Pagos', icon: CreditCard, count: events.filter(e => e.event_type === 'pago_imputar').length },
        { id: 'mercaderia_recibir', label: 'Recepciones', icon: Package },
        { id: 'reclamo_resolver', label: 'Reclamos', icon: AlertTriangle },
    ]

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-neutral-900">AGENDA</h2>
                <div className="flex items-center gap-2">
                    {/* ERP Summary Badges */}
                    <Link href="/viajes" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium hover:bg-blue-100 transition-colors">
                        <Truck className="h-3.5 w-3.5" />
                        {initialViajes.length} viajes
                    </Link>
                    <Link href="/clientes-pedidos" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-xs font-medium hover:bg-green-100 transition-colors">
                        <ClipboardList className="h-3.5 w-3.5" />
                        {totalPedidosPendientes} pedidos
                    </Link>
                    <Link href="/proveedores" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium hover:bg-amber-100 transition-colors">
                        <CreditCard className="h-3.5 w-3.5" />
                        {saldosCount} saldos
                    </Link>
                    <button
                        onClick={syncGmail}
                        disabled={isSyncing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
                        title="Sincronizar Gmail"
                    >
                        {isSyncing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Mail className="h-3.5 w-3.5" />
                        )}
                        {isSyncing ? 'Sincronizando...' : 'Sync Gmail'}
                    </button>
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1 mb-4 bg-neutral-100 p-1 rounded-xl overflow-x-auto">
                {FILTERS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveFilter(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${activeFilter === tab.id
                            ? 'bg-white text-neutral-900 shadow-sm'
                            : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'
                            }`}
                    >
                        <tab.icon className="h-3.5 w-3.5" />
                        {tab.label}
                        {tab.count !== undefined && tab.count > 0 && (
                            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeFilter === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-200 text-neutral-600'
                                }`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                </div>
            ) : fetchError ? (
                <div className="flex flex-col items-center justify-center py-16 text-red-400">
                    <AlertTriangle className="h-12 w-12 mb-3 text-red-300" />
                    <p className="text-sm font-medium text-red-500">{fetchError}</p>
                    <button onClick={fetchEvents} className="text-xs text-indigo-500 mt-2 hover:underline">Reintentar</button>
                </div>
            ) : activeFilter === 'emails' ? (
                /* ─── Email Inbox View ─── */
                emails.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                        <Mail className="h-12 w-12 mb-3 text-neutral-200" />
                        <p className="text-sm font-medium text-neutral-500">No hay emails sincronizados</p>
                        <p className="text-xs mt-1">Sincronizá Gmail para ver los emails recibidos</p>
                    </div>
                ) : (
                    <div className="divide-y divide-neutral-100">
                        {emails.map(email => (
                            <EmailRow key={email.id} email={email} />
                        ))}
                    </div>
                )
            ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                    <Calendar className="h-12 w-12 mb-3 text-neutral-200" />
                    <p className="text-sm font-medium text-neutral-500">Sin eventos pendientes</p>
                    <p className="text-xs mt-1">Sincronizá Gmail para que aparezcan eventos automáticamente</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {overdueEvents.length > 0 && (
                        <EventSection title="⚠️ Vencidos" events={overdueEvents} onComplete={markComplete} variant="overdue" />
                    )}
                    {todayEvents.length > 0 && (
                        <EventSection title="📅 Hoy" events={todayEvents} onComplete={markComplete} variant="today" />
                    )}
                    {upcomingEvents.length > 0 && (
                        <EventSection title="📆 Próximos" events={upcomingEvents} onComplete={markComplete} variant="upcoming" />
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Sub-components ────────────────────────────────────

function EventSection({
    title,
    events,
    onComplete,
    variant,
}: {
    title: string
    events: AiAgendaEvent[]
    onComplete: (id: string) => void
    variant: 'overdue' | 'today' | 'upcoming'
}) {
    return (
        <div>
            <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                {title}
            </h4>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {events.map(event => (
                    <DashboardEventCard
                        key={event.id}
                        event={event}
                        onComplete={() => onComplete(event.id)}
                        isOverdue={variant === 'overdue'}
                    />
                ))}
            </div>
        </div>
    )
}

function DashboardEventCard({
    event,
    onComplete,
    isOverdue,
}: {
    event: AiAgendaEvent
    onComplete: () => void
    isOverdue: boolean
}) {
    const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.tarea_general
    const Icon = config.icon

    return (
        <div className={`flex items-start gap-3 p-3 rounded-xl border transition-all group hover:shadow-md ${isOverdue ? 'bg-red-50/50 border-red-200' : config.bg
            }`}>
            {/* Priority dot */}
            <div className="mt-1 flex-shrink-0">
                <div className={`h-2.5 w-2.5 rounded-full ${PRIORITY_COLORS[event.priority] || PRIORITY_COLORS.media}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${config.color} bg-white/60`}>
                        <Icon className="h-3 w-3" />
                        {config.label}
                    </span>
                    {event.due_date && (
                        <span className={`text-[10px] ${isOverdue ? 'text-red-500 font-semibold' : 'text-neutral-400'}`}>
                            {new Date(event.due_date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                        </span>
                    )}
                </div>
                <p className="text-sm font-medium text-neutral-800 leading-tight">
                    {event.title}
                </p>
                {event.description && (
                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                        {event.description}
                    </p>
                )}
            </div>

            {/* Complete button */}
            <button
                onClick={onComplete}
                className="mt-0.5 p-1.5 text-neutral-300 hover:text-green-500 hover:bg-green-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                title="Marcar completada"
            >
                <Check className="h-4 w-4" />
            </button>
        </div>
    )
}

// ─── Email Inbox Sub-component ─────────────────────────

const CLASSIFICATION_BADGES: Record<string, { label: string; color: string }> = {
    pedido: { label: 'Pedido', color: 'bg-blue-100 text-blue-700' },
    factura_proveedor: { label: 'Factura', color: 'bg-red-100 text-red-700' },
    orden_compra: { label: 'Orden de compra', color: 'bg-green-100 text-green-700' },
    pago: { label: 'Pago', color: 'bg-purple-100 text-purple-700' },
    cambio_precio: { label: 'Cambio de precio', color: 'bg-amber-100 text-amber-700' },
    reclamo: { label: 'Reclamo', color: 'bg-orange-100 text-orange-700' },
    consulta: { label: 'Consulta', color: 'bg-cyan-100 text-cyan-700' },
    spam: { label: 'Spam', color: 'bg-neutral-100 text-neutral-500' },
    otro: { label: 'Otro', color: 'bg-neutral-100 text-neutral-600' },
}

function EmailRow({ email }: { email: InboxEmail }) {
    const badge = email.classification ? CLASSIFICATION_BADGES[email.classification] : null
    const dateStr = email.received_at
        ? new Date(email.received_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
        : '—'
    const timeStr = email.received_at
        ? new Date(email.received_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        : ''
    const senderName = email.from_name || email.from_email?.split('@')[0] || 'Desconocido'
    const summary = email.ai_summary || '—'

    return (
        <div className={`flex items-center gap-3 px-3 py-3 hover:bg-neutral-50 transition-colors rounded-lg group cursor-default ${!email.is_read ? 'bg-indigo-50/40' : ''
            }`}>
            {/* Unread indicator */}
            <div className="flex-shrink-0 w-2">
                {!email.is_read && (
                    <div className="h-2 w-2 rounded-full bg-indigo-500" />
                )}
            </div>

            {/* Sender avatar */}
            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center">
                <span className="text-white text-xs font-bold">
                    {senderName.charAt(0).toUpperCase()}
                </span>
            </div>

            {/* Sender name */}
            <div className="w-36 flex-shrink-0">
                <p className={`text-sm truncate ${!email.is_read ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-700'}`}>
                    {senderName}
                </p>
            </div>

            {/* Subject + Summary */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className={`text-sm truncate ${!email.is_read ? 'font-semibold text-neutral-900' : 'text-neutral-800'}`}>
                    {email.subject || '(sin asunto)'}
                </span>
                <span className="text-xs text-neutral-400 truncate hidden sm:inline">
                    — {summary}
                </span>
            </div>

            {/* Classification badge */}
            {badge && (
                <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.color}`}>
                    {badge.label}
                </span>
            )}

            {/* Date */}
            <div className="flex-shrink-0 text-right w-16">
                <p className="text-[11px] text-neutral-400 font-medium">{dateStr}</p>
                <p className="text-[10px] text-neutral-300">{timeStr}</p>
            </div>
        </div>
    )
}
