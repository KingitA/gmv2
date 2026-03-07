'use client'

import { useState, useEffect, useCallback } from 'react'
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
    ChevronDown,
    Check,
} from 'lucide-react'
import type { AiAgendaEvent } from '@/lib/ai/types'

// ─── Helpers ───────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Calendar; label: string; color: string }> = {
    vencimiento_proveedor: { icon: Clock, label: 'Vencimiento', color: 'text-red-600 bg-red-50' },
    pedido_preparar: { icon: Package, label: 'Pedido', color: 'text-blue-600 bg-blue-50' },
    mercaderia_recibir: { icon: Package, label: 'Recepción', color: 'text-green-600 bg-green-50' },
    cambio_precio: { icon: BarChart3, label: 'Precio', color: 'text-amber-600 bg-amber-50' },
    pago_imputar: { icon: CreditCard, label: 'Pago', color: 'text-purple-600 bg-purple-50' },
    reclamo_resolver: { icon: AlertTriangle, label: 'Reclamo', color: 'text-orange-600 bg-orange-50' },
    tarea_general: { icon: CheckCircle2, label: 'Tarea', color: 'text-neutral-600 bg-neutral-50' },
    recordatorio: { icon: MessageSquare, label: 'Recordatorio', color: 'text-indigo-600 bg-indigo-50' },
}

const PRIORITY_COLORS: Record<string, string> = {
    urgente: 'bg-red-500',
    alta: 'bg-orange-500',
    media: 'bg-yellow-500',
    baja: 'bg-green-500',
}

// ─── Component ─────────────────────────────────────────

export function AgendaPanel() {
    const [events, setEvents] = useState<AiAgendaEvent[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [filter, setFilter] = useState<string>('all')

    const fetchEvents = useCallback(async () => {
        setIsLoading(true)
        try {
            const params = new URLSearchParams()
            if (filter !== 'all') params.set('type', filter)

            const res = await fetch(`/api/ai/agenda?${params.toString()}`)
            if (res.ok) {
                const data = await res.json()
                setEvents(data.events || [])
            }
        } catch {
            // Silently fail
        } finally {
            setIsLoading(false)
        }
    }, [filter])

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
            setEvents((prev) => prev.filter((e) => e.id !== id))
        } catch {
            // Silently fail
        }
    }

    const today = new Date().toISOString().split('T')[0]

    const todayEvents = events.filter((e) => e.due_date === today)
    const upcomingEvents = events.filter((e) => !e.due_date || e.due_date > today)
    const overdueEvents = events.filter((e) => e.due_date && e.due_date < today)

    return (
        <div className="flex-1 overflow-y-auto">
            {/* Filter */}
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-3 py-2 flex items-center gap-2">
                <div className="relative">
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="appearance-none bg-neutral-100 text-neutral-700 text-[11px] font-medium px-3 py-1.5 pr-7 rounded-lg border-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="all">Todos</option>
                        <option value="pedido_preparar">Pedidos</option>
                        <option value="vencimiento_proveedor">Vencimientos</option>
                        <option value="mercaderia_recibir">Recepciones</option>
                        <option value="pago_imputar">Pagos</option>
                        <option value="cambio_precio">Precios</option>
                        <option value="reclamo_resolver">Reclamos</option>
                    </select>
                    <ChevronDown className="h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
                <span className="text-[11px] text-neutral-400 ml-auto">
                    {events.length} evento{events.length !== 1 ? 's' : ''}
                </span>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                </div>
            ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                    <Calendar className="h-10 w-10 mb-2 text-neutral-200" />
                    <p className="text-sm font-medium text-neutral-500">Sin eventos</p>
                    <p className="text-xs mt-1">Los eventos de Gmail aparecerán acá</p>
                </div>
            ) : (
                <div className="p-3 space-y-4">
                    {/* Overdue */}
                    {overdueEvents.length > 0 && (
                        <EventSection title="⚠️ Vencidos" events={overdueEvents} onComplete={markComplete} />
                    )}

                    {/* Today */}
                    {todayEvents.length > 0 && (
                        <EventSection title="📅 Hoy" events={todayEvents} onComplete={markComplete} />
                    )}

                    {/* Upcoming */}
                    {upcomingEvents.length > 0 && (
                        <EventSection title="📆 Próximos" events={upcomingEvents} onComplete={markComplete} />
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
}: {
    title: string
    events: AiAgendaEvent[]
    onComplete: (id: string) => void
}) {
    return (
        <div>
            <h4 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                {title}
            </h4>
            <div className="space-y-1.5">
                {events.map((event) => (
                    <EventCard key={event.id} event={event} onComplete={() => onComplete(event.id)} />
                ))}
            </div>
        </div>
    )
}

function EventCard({
    event,
    onComplete,
}: {
    event: AiAgendaEvent
    onComplete: () => void
}) {
    const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.tarea_general
    const Icon = config.icon

    return (
        <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-50 hover:bg-neutral-100 transition-colors group">
            {/* Priority dot */}
            <div className="mt-1.5 flex-shrink-0">
                <div className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[event.priority] || PRIORITY_COLORS.media}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${config.color}`}>
                        <Icon className="h-2.5 w-2.5" />
                        {config.label}
                    </span>
                    {event.due_date && (
                        <span className="text-[10px] text-neutral-400">
                            {event.due_date}
                        </span>
                    )}
                </div>
                <p className="text-xs font-medium text-neutral-800 mt-1 truncate">
                    {event.title}
                </p>
                {event.description && (
                    <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2">
                        {event.description}
                    </p>
                )}
            </div>

            {/* Complete button */}
            <button
                onClick={onComplete}
                className="mt-1 p-1 text-neutral-300 hover:text-green-500 opacity-0 group-hover:opacity-100 transition-all"
                title="Marcar completada"
            >
                <Check className="h-4 w-4" />
            </button>
        </div>
    )
}
