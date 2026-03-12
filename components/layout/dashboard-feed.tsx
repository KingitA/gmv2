'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTimeAR } from '@/lib/utils'
import Link from 'next/link'

type FeedItem = {
  id: string
  type: 'pedido' | 'email' | 'pago' | 'alerta' | 'precio' | 'spam' | 'factura'
  title: string
  description: string
  account?: string
  status: 'pendiente' | 'procesado' | 'urgente' | 'revisar' | 'spam'
  time: string
  href?: string
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pendiente: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pendiente' },
  procesado: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Procesado' },
  urgente: { bg: 'bg-red-100', text: 'text-red-800', label: 'Urgente' },
  revisar: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Revisar' },
  spam: { bg: 'bg-neutral-200', text: 'text-neutral-500', label: 'Spam' },
}

const TYPE_ICONS: Record<string, { icon: string; bg: string }> = {
  pedido: { icon: '📦', bg: 'bg-blue-50' },
  email: { icon: '📧', bg: 'bg-violet-50' },
  pago: { icon: '💳', bg: 'bg-emerald-50' },
  alerta: { icon: '⚠️', bg: 'bg-red-50' },
  precio: { icon: '💰', bg: 'bg-amber-50' },
  spam: { icon: '🗑️', bg: 'bg-neutral-100' },
  factura: { icon: '📄', bg: 'bg-orange-50' },
}

const CLASSIFICATION_MAP: Record<string, { type: FeedItem['type']; label: string }> = {
  pedido: { type: 'pedido', label: 'Pedido' },
  orden_compra: { type: 'pedido', label: 'Orden de Compra' },
  factura_proveedor: { type: 'factura', label: 'Factura' },
  pago: { type: 'pago', label: 'Pago' },
  cambio_precio: { type: 'precio', label: 'Cambio Precio' },
  reclamo: { type: 'alerta', label: 'Reclamo' },
  consulta: { type: 'email', label: 'Consulta' },
  spam: { type: 'spam', label: 'Spam' },
  otro: { type: 'email', label: 'Email' },
}

// Determinar a dónde lleva cada tipo de email según clasificación
function getEmailHref(classification: string | null, _metadata?: any): string | undefined {
  switch (classification) {
    case 'pedido':
    case 'orden_compra':
      return '/clientes-pedidos'
    case 'factura_proveedor':
      return '/comprobantes'
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

// Determinar href para eventos de agenda según su tipo y metadata
function getEventHref(eventType: string | null, metadata: any): string | undefined {
  if (!eventType) return undefined

  // Si tiene pedido_ids, ir al pedido
  if (metadata?.pedido_ids?.length > 0) {
    return '/clientes-pedidos'
  }
  // Si necesita revisión de import
  if (metadata?.needs_review || metadata?.import_id) {
    return '/clientes-pedidos'
  }

  if (eventType.includes('pedido')) return '/clientes-pedidos'
  if (eventType.includes('pago')) return '/revision-pagos'
  if (eventType.includes('reclamo')) return '/revision-devoluciones'
  if (eventType.includes('precio')) return '/articulos/precios'
  if (eventType.includes('vencimiento')) return '/comprobantes'
  if (eventType.includes('mercaderia')) return '/ordenes-compra'

  return undefined
}

const TABS = [
  { id: 'todo', label: 'Todo' },
  { id: 'pedido', label: 'Pedidos' },
  { id: 'email', label: 'Emails' },
  { id: 'pago', label: 'Pagos' },
  { id: 'alerta', label: 'Alertas' },
  { id: 'spam', label: 'Spam' },
]

export function DashboardFeed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('todo')

  useEffect(() => { loadFeed() }, [])

  const loadFeed = async () => {
    const supabase = createClient()
    const feedItems: FeedItem[] = []

    try {
      // 1. Recent pedidos
      const { data: pedidos } = await supabase
        .from('pedidos')
        .select('id, numero_pedido, fecha, estado, created_at, clientes(nombre_razon_social), observaciones')
        .order('created_at', { ascending: false })
        .limit(15)

      if (pedidos) {
        for (const p of pedidos) {
          const clienteNombre = (p as any).clientes?.nombre_razon_social || 'Sin cliente'
          const esAuto = p.observaciones?.includes('Gmail') || p.observaciones?.includes('automáticamente')
          feedItems.push({
            id: `ped-${p.id}`,
            type: 'pedido',
            title: `Pedido #${p.numero_pedido || '?'}${esAuto ? ' (automático)' : ''}`,
            description: clienteNombre,
            status: p.estado === 'pendiente' ? 'pendiente' : 'procesado',
            time: p.created_at,
            href: `/clientes-pedidos?pedido=${p.numero_pedido}`,
          })
        }
      }

      // 2. Recent emails — excluir spam de aquí para no duplicar
      const { data: emails } = await supabase
        .from('ai_emails')
        .select('id, subject, from_name, from_email, to_email, classification, ai_summary, created_at, is_processed')
        .order('created_at', { ascending: false })
        .limit(25)

      if (emails) {
        for (const e of emails) {
          const classConfig = CLASSIFICATION_MAP[e.classification || ''] || CLASSIFICATION_MAP.otro
          const accountShort = e.to_email ? e.to_email.split('@')[0] : null

          feedItems.push({
            id: `email-${e.id}`,
            type: classConfig.type,
            title: `${classConfig.label} — ${e.from_name || e.from_email || 'Desconocido'}`,
            description: e.ai_summary || e.subject || 'Sin asunto',
            account: accountShort || undefined,
            status: classConfig.type === 'spam' ? 'spam' :
                    e.is_processed ? 'procesado' : 'revisar',
            time: e.created_at,
            href: getEmailHref(e.classification),
          })
        }
      }

      // 3. Recent agenda events — estos son los más accionables
      const { data: events } = await supabase
        .from('ai_agenda_events')
        .select('id, title, description, event_type, priority, status, metadata, created_at')
        .in('status', ['pendiente', 'en_progreso'])
        .order('created_at', { ascending: false })
        .limit(15)

      if (events) {
        for (const ev of events) {
          const meta = (ev.metadata || {}) as any

          feedItems.push({
            id: `ev-${ev.id}`,
            type: ev.event_type?.includes('pago') ? 'pago' :
                  ev.event_type?.includes('reclamo') ? 'alerta' :
                  ev.event_type?.includes('precio') ? 'precio' :
                  ev.event_type?.includes('pedido') ? 'pedido' : 'email',
            title: ev.title,
            description: ev.description || '',
            status: ev.priority === 'urgente' ? 'urgente' :
                    ev.priority === 'alta' ? 'revisar' : 'pendiente',
            time: ev.created_at,
            href: getEventHref(ev.event_type, meta),
          })
        }
      }
    } catch (err) {
      console.error('[DashboardFeed] Error loading feed:', err)
    }

    feedItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    setItems(feedItems)
    setLoading(false)
  }

  const filtered = activeTab === 'spam'
    ? items.filter(i => i.type === 'spam')
    : activeTab === 'todo'
      ? items.filter(i => i.type !== 'spam')
      : items.filter(i => i.type === activeTab && i.type !== 'spam')

  const spamCount = items.filter(i => i.type === 'spam').length

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
        <h3 className="font-bold text-sm">Actividad Reciente</h3>
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors relative
                ${activeTab === tab.id
                  ? tab.id === 'spam' ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              {tab.label}
              {tab.id === 'spam' && spamCount > 0 && (
                <span className="ml-1 text-[9px] bg-neutral-400 text-white px-1.5 py-0.5 rounded-full font-bold">
                  {spamCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">Cargando actividad...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">
            {activeTab === 'spam' ? 'No hay spam' : 'No hay actividad reciente'}
          </div>
        ) : (
          filtered.slice(0, 30).map(item => {
            const typeConfig = TYPE_ICONS[item.type] || TYPE_ICONS.email
            const statusConfig = STATUS_STYLES[item.status] || STATUS_STYLES.pendiente

            const inner = (
              <div
                className={`flex gap-3 px-5 py-3 border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors items-start
                  ${item.type === 'spam' ? 'opacity-60' : ''}
                  ${item.href ? 'cursor-pointer' : ''}`}
              >
                <div className={`w-8 h-8 rounded-lg ${typeConfig.bg} flex items-center justify-center text-sm flex-shrink-0 mt-0.5`}>
                  {typeConfig.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold leading-snug">{item.title}</div>
                  <div className="text-[12px] text-neutral-500 truncate">{item.description}</div>
                  {item.account && (
                    <div className="text-[10px] text-neutral-400 mt-0.5">📬 {item.account}</div>
                  )}
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${statusConfig.bg} ${statusConfig.text}`}>
                    {statusConfig.label}
                  </span>
                  <span className="text-[10px] text-neutral-400 mt-1 whitespace-nowrap">
                    {timeAgo(item.time)}
                  </span>
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
