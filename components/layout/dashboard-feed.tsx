'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTimeAR } from '@/lib/utils'
import Link from 'next/link'
import { Paperclip } from 'lucide-react'

// ─── Types ─────────────────────────────────────────────
type FeedItem = {
  id: string
  dbId: string  // real DB id for updates
  type: 'pedido' | 'email' | 'pago' | 'alerta' | 'precio' | 'spam' | 'factura'
  title: string
  description: string
  account?: string       // to_email
  accountFull?: string   // full email
  status: 'pendiente' | 'procesado' | 'urgente' | 'revisar' | 'spam'
  time: string
  href?: string
  hasAttachments?: boolean
  attachmentCount?: number
  classification?: string
  source: 'email' | 'pedido' | 'event'
}

// ─── Classification config ─────────────────────────────
const CLASS_CONFIG: Record<string, { type: FeedItem['type']; label: string; icon: string; bg: string }> = {
  pedido:             { type: 'pedido',  label: 'Pedido',        icon: '📦', bg: 'bg-blue-50' },
  orden_compra:       { type: 'pedido',  label: 'Orden Compra',  icon: '📋', bg: 'bg-blue-50' },
  factura_proveedor:  { type: 'factura', label: 'Factura',       icon: '📄', bg: 'bg-orange-50' },
  pago:               { type: 'pago',    label: 'Pago',          icon: '💳', bg: 'bg-emerald-50' },
  cambio_precio:      { type: 'precio',  label: 'Lista Precios', icon: '💰', bg: 'bg-amber-50' },
  reclamo:            { type: 'alerta',  label: 'Reclamo',       icon: '⚠️', bg: 'bg-red-50' },
  consulta:           { type: 'email',   label: 'Consulta',      icon: '💬', bg: 'bg-violet-50' },
  spam:               { type: 'spam',    label: 'Spam',          icon: '🗑️', bg: 'bg-neutral-100' },
  otro:               { type: 'email',   label: 'Email',         icon: '📧', bg: 'bg-violet-50' },
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pendiente: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pendiente' },
  procesado: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Procesado' },
  urgente:   { bg: 'bg-red-100', text: 'text-red-800', label: 'Urgente' },
  revisar:   { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Revisar' },
  spam:      { bg: 'bg-neutral-200', text: 'text-neutral-500', label: 'Spam' },
}

function getHref(classification: string | null, processing_status?: string): string | undefined {
  switch (classification) {
    case 'pedido':
    case 'orden_compra':
      // Si requiere revisión va a import-review, si ya se creó va a pedidos
      return processing_status === 'REVIEW_NEEDED' ? '/clientes-pedidos/import-review' : '/clientes-pedidos'
    case 'factura_proveedor':
      return '/comprobantes-compra'
    case 'pago':
      return '/revision-pagos'
    case 'cambio_precio':
      return '/articulos/precios'
    case 'reclamo':
      return '/revision-devoluciones'
    default:
      return undefined
  }
}

export function DashboardFeed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<string[]>([])
  const [activeAccount, setActiveAccount] = useState<string>('todos')
  const [activeFilter, setActiveFilter] = useState<string>('todos')
  const [dragItemId, setDragItemId] = useState<string | null>(null)

  useEffect(() => { loadFeed() }, [])

  const loadFeed = async () => {
    const supabase = createClient()
    const feedItems: FeedItem[] = []
    const accountSet = new Set<string>()

    try {
      // 1. Emails with attachment count
      const { data: emails } = await supabase
        .from('ai_emails')
        .select('id, subject, from_name, from_email, to_email, classification, ai_summary, created_at, is_processed, processing_status, ai_email_attachments(id)')
        .order('created_at', { ascending: false })
        .limit(50)

      if (emails) {
        for (const e of emails) {
          const cls = CLASS_CONFIG[e.classification || ''] || CLASS_CONFIG.otro
          const toEmail = e.to_email || ''
          const accountShort = toEmail.split('@')[0]
          if (toEmail) accountSet.add(toEmail)
          const attCount = Array.isArray((e as any).ai_email_attachments) ? (e as any).ai_email_attachments.length : 0

          feedItems.push({
            id: `email-${e.id}`,
            dbId: e.id,
            type: cls.type,
            title: `${cls.label} — ${e.from_name || e.from_email || 'Desconocido'}`,
            description: e.ai_summary || e.subject || 'Sin asunto',
            account: accountShort,
            accountFull: toEmail,
            status: cls.type === 'spam' ? 'spam' : e.is_processed ? 'procesado' : 'revisar',
            time: e.created_at,
            href: getHref(e.classification, e.processing_status),
            hasAttachments: attCount > 0,
            attachmentCount: attCount,
            classification: e.classification,
            source: 'email',
          })
        }
      }

      // 2. Agenda events
      const { data: events } = await supabase
        .from('ai_agenda_events')
        .select('id, title, description, event_type, priority, status, metadata, created_at')
        .in('status', ['pendiente', 'en_progreso'])
        .order('created_at', { ascending: false })
        .limit(15)

      if (events) {
        for (const ev of events) {
          const meta = (ev.metadata || {}) as any
          let evType: FeedItem['type'] = 'email'
          if (ev.event_type?.includes('pago')) evType = 'pago'
          else if (ev.event_type?.includes('reclamo')) evType = 'alerta'
          else if (ev.event_type?.includes('precio')) evType = 'precio'
          else if (ev.event_type?.includes('pedido')) evType = 'pedido'
          else if (ev.event_type?.includes('factura')) evType = 'factura'

          let evHref: string | undefined
          if (meta?.pedido_ids?.length > 0 || meta?.needs_review) evHref = '/clientes-pedidos'
          else if (ev.event_type?.includes('pago')) evHref = '/revision-pagos'
          else if (ev.event_type?.includes('reclamo')) evHref = '/revision-devoluciones'
          else if (ev.event_type?.includes('precio')) evHref = '/articulos/precios'
          else if (ev.event_type?.includes('factura') || ev.event_type?.includes('vencimiento')) evHref = '/comprobantes-compra'

          feedItems.push({
            id: `ev-${ev.id}`,
            dbId: ev.id,
            type: evType,
            title: ev.title,
            description: ev.description || '',
            status: ev.priority === 'urgente' ? 'urgente' : ev.priority === 'alta' ? 'revisar' : 'pendiente',
            time: ev.created_at,
            href: evHref,
            source: 'event',
          })
        }
      }
    } catch (err) {
      console.error('[DashboardFeed] Error:', err)
    }

    feedItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    setItems(feedItems)
    setAccounts(Array.from(accountSet))
    setLoading(false)
  }

  // Drag to spam
  const markAsSpam = async (itemId: string) => {
    const item = items.find(i => i.id === itemId)
    if (!item || item.source !== 'email') return
    const supabase = createClient()
    await supabase.from('ai_emails').update({ classification: 'spam' }).eq('id', item.dbId)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, type: 'spam', status: 'spam' as const, classification: 'spam' } : i))
  }

  // Filter logic
  const filtered = items.filter(i => {
    // Account filter
    if (activeAccount !== 'todos' && i.accountFull !== activeAccount) return false
    // Type filter
    if (activeFilter === 'spam') return i.type === 'spam'
    if (activeFilter === 'todos') return i.type !== 'spam'
    return i.type === activeFilter && i.type !== 'spam'
  })

  const spamCount = items.filter(i => i.type === 'spam' && (activeAccount === 'todos' || i.accountFull === activeAccount)).length

  // Account display names
  const getAccountLabel = (email: string) => {
    const name = email.split('@')[0]
    if (name.includes('cliente')) return '👥 Clientes'
    if (name.includes('proveedor')) return '🏭 Proveedores'
    return `📧 ${name}`
  }

  const FILTERS = [
    { id: 'todos', label: 'Todo' },
    { id: 'pedido', label: 'Pedidos' },
    { id: 'factura', label: 'Facturas' },
    { id: 'precio', label: 'Precios' },
    { id: 'pago', label: 'Pagos' },
    { id: 'alerta', label: 'Alertas' },
    { id: 'email', label: 'Otros' },
    { id: 'spam', label: 'Spam' },
  ]

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      {/* ═══ Account tabs (Chrome-style) ═══ */}
      {accounts.length > 0 && (
        <div className="flex border-b border-neutral-100 bg-neutral-50/50">
          <button
            onClick={() => setActiveAccount('todos')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${activeAccount === 'todos' ? 'border-blue-500 text-blue-700 bg-white' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}
          >
            📬 Todos
          </button>
          {accounts.map(acc => (
            <button
              key={acc}
              onClick={() => setActiveAccount(acc)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${activeAccount === acc ? 'border-blue-500 text-blue-700 bg-white' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}
            >
              {getAccountLabel(acc)}
            </button>
          ))}
        </div>
      )}

      {/* ═══ Type filter tabs ═══ */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-100">
        <div className="flex gap-0.5 overflow-x-auto">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap
                ${activeFilter === f.id ? (f.id === 'spam' ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-900') : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              {f.label}
              {f.id === 'spam' && spamCount > 0 && (
                <span className="ml-1 text-[9px] bg-neutral-400 text-white px-1 py-0.5 rounded-full font-bold">{spamCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ Spam drop zone (visible when dragging) ═══ */}
      {dragItemId && activeFilter !== 'spam' && (
        <div
          className="mx-4 my-2 border-2 border-dashed border-neutral-300 rounded-lg p-3 text-center text-xs text-neutral-400 bg-neutral-50 transition-colors"
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-red-400', 'bg-red-50', 'text-red-500') }}
          onDragLeave={e => { e.currentTarget.classList.remove('border-red-400', 'bg-red-50', 'text-red-500') }}
          onDrop={e => { e.preventDefault(); if (dragItemId) markAsSpam(dragItemId); setDragItemId(null) }}
        >
          🗑️ Soltar aquí para marcar como spam
        </div>
      )}

      {/* ═══ Feed list ═══ */}
      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">
            {activeFilter === 'spam' ? 'No hay spam' : 'No hay actividad'}
          </div>
        ) : (
          filtered.slice(0, 40).map(item => {
            const cls = CLASS_CONFIG[item.classification || ''] || CLASS_CONFIG.otro
            const statusConfig = STATUS_STYLES[item.status] || STATUS_STYLES.pendiente

            const inner = (
              <div
                className={`flex gap-3 px-4 py-2.5 border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors items-start
                  ${item.type === 'spam' ? 'opacity-50' : ''}
                  ${item.href ? 'cursor-pointer' : ''}
                  ${dragItemId === item.id ? 'opacity-30' : ''}`}
                draggable={item.source === 'email' && item.type !== 'spam'}
                onDragStart={() => setDragItemId(item.id)}
                onDragEnd={() => setDragItemId(null)}
              >
                {/* Icon */}
                <div className={`w-7 h-7 rounded-lg ${cls.bg} flex items-center justify-center text-sm flex-shrink-0 mt-0.5`}>
                  {cls.icon}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold leading-snug truncate">{item.title}</span>
                    {item.hasAttachments && (
                      <Paperclip className="h-3 w-3 text-neutral-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">{item.description}</div>
                  {item.account && (
                    <div className="text-[10px] text-neutral-400 mt-0.5">📬 {item.account}</div>
                  )}
                </div>
                {/* Status + time */}
                <div className="flex flex-col items-end flex-shrink-0 gap-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${statusConfig.bg} ${statusConfig.text}`}>
                    {statusConfig.label}
                  </span>
                  <span className="text-[10px] text-neutral-400 whitespace-nowrap">{timeAgo(item.time)}</span>
                </div>
              </div>
            )

            return item.href
              ? <Link key={item.id} href={item.href} className="block">{inner}</Link>
              : <div key={item.id}>{inner}</div>
          })
        )}
      </div>
    </div>
  )
}

function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `Hace ${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) return `Hace ${diffDays} días`
  return formatDateTimeAR(dateStr)
}
