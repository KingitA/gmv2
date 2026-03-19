'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Paperclip, Trash2 } from 'lucide-react'

// ── Hardcoded accounts ─────────────────────────────
const ACCOUNT_CLIENTES = 'megasur.clientes@gmail.com'
const ACCOUNT_PROVEEDORES = 'megasur.proveedores@gmail.com'

type Bandeja = 'proveedores' | 'clientes' | 'personal'

// Extract email from strings like '"Name" <email@gmail.com>' or '<email@gmail.com>'
function extractEmail(raw: string | null | undefined): string {
  if (!raw) return ''
  const match = raw.match(/<([^>]+)>/)
  if (match) return match[1].toLowerCase().trim()
  if (raw.includes('@') && !raw.includes(' ')) return raw.toLowerCase().trim()
  return raw.toLowerCase().trim()
}

function detectBandeja(toEmail: string | null | undefined): Bandeja {
  if (!toEmail) return 'personal'
  const lower = toEmail.toLowerCase()
  if (lower.includes('megasur.clientes')) return 'clientes'
  if (lower.includes('megasur.proveedores')) return 'proveedores'
  return 'personal'
}

type EmailItem = {
  id: string
  subject: string
  fromName: string
  classification: string
  summary: string
  time: string
  hasAttachments: boolean
  bandeja: Bandeja
  href?: string
}

const CLIENTES_FILTERS = [
  { id: 'todos', label: 'Todos' },
  { id: 'pedido', label: 'Pedidos' },
  { id: 'pago', label: 'Pagos' },
  { id: 'reclamo', label: 'Reclamos / Consultas' },
  { id: 'trash', label: '🗑️ Papelera' },
]

const PROVEEDORES_FILTERS = [
  { id: 'todos', label: 'Todos' },
  { id: 'cambio_precio', label: 'Cambios de Precios' },
  { id: 'factura', label: 'Facturas' },
  { id: 'reclamo', label: 'Reclamos / Consultas' },
  { id: 'trash', label: '🗑️ Papelera' },
]

function classMatchesFilter(classification: string, filter: string): boolean {
  if (filter === 'todos') return true
  if (filter === 'pedido') return classification === 'pedido' || classification === 'orden_compra'
  if (filter === 'pago') return classification === 'pago'
  if (filter === 'reclamo') return classification === 'reclamo' || classification === 'consulta'
  if (filter === 'cambio_precio') return classification === 'cambio_precio'
  if (filter === 'factura') return classification === 'factura_proveedor'
  return false
}

function getHref(classification: string | null, bandeja: Bandeja): string | undefined {
  if (bandeja === 'personal') return undefined
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

const CLS_ICON: Record<string, string> = {
  pedido: '📦',
  orden_compra: '📋',
  factura_proveedor: '📄',
  pago: '💳',
  cambio_precio: '💰',
  reclamo: '⚠️',
  consulta: '💬',
  otro: '📧',
}

export function DashboardFeed() {
  const [emails, setEmails] = useState<EmailItem[]>([])
  const [trashedEmails, setTrashedEmails] = useState<EmailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBandeja, setActiveBandeja] = useState<Bandeja>('proveedores')
  const [activeFilter, setActiveFilter] = useState('todos')

  useEffect(() => { loadEmails() }, [])

  const moveToTrash = async (emailId: string) => {
    const supabase = createClient()
    await supabase.from('ai_emails').update({ classification: 'trash' }).eq('id', emailId)
    const item = emails.find(e => e.id === emailId)
    if (item) {
      setTrashedEmails(prev => [item, ...prev])
      setEmails(prev => prev.filter(e => e.id !== emailId))
    }
  }

  const restoreFromTrash = async (emailId: string) => {
    const supabase = createClient()
    // Restore to 'otro' classification
    await supabase.from('ai_emails').update({ classification: 'otro' }).eq('id', emailId)
    const item = trashedEmails.find(e => e.id === emailId)
    if (item) {
      setEmails(prev => [item, ...prev].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()))
      setTrashedEmails(prev => prev.filter(e => e.id !== emailId))
    }
  }

  useEffect(() => { loadEmails() }, [])

  const loadEmails = async () => {
    const supabase = createClient()
    const items: EmailItem[] = []

    // Only load emails — NO agenda events, NO duplicates
    const { data } = await supabase
      .from('ai_emails')
      .select('id, subject, from_name, from_email, to_email, classification, ai_summary, created_at, ai_email_attachments(id)')
      .not('classification', 'in', '("spam","trash")')
      .order('created_at', { ascending: false })
      .limit(100)

    if (data) {
      for (const e of data) {
        const bandeja = detectBandeja(e.to_email)
        const attCount = Array.isArray((e as any).ai_email_attachments) ? (e as any).ai_email_attachments.length : 0

        items.push({
          id: e.id,
          subject: e.subject || 'Sin asunto',
          fromName: e.from_name || e.from_email || 'Desconocido',
          classification: e.classification || 'otro',
          summary: e.ai_summary || '',
          time: e.created_at,
          hasAttachments: attCount > 0,
          bandeja,
          href: getHref(e.classification, bandeja),
        })
      }
    }

    setEmails(items)

    // Load trashed emails
    const { data: trashed } = await supabase
      .from('ai_emails')
      .select('id, subject, from_name, from_email, to_email, classification, ai_summary, created_at, ai_email_attachments(id)')
      .eq('classification', 'trash')
      .order('created_at', { ascending: false })
      .limit(50)

    if (trashed) {
      const trashItems: EmailItem[] = trashed.map((e: any) => ({
        id: e.id,
        subject: e.subject || 'Sin asunto',
        fromName: e.from_name || e.from_email || 'Desconocido',
        classification: 'trash',
        summary: e.ai_summary || '',
        time: e.created_at,
        hasAttachments: Array.isArray(e.ai_email_attachments) ? e.ai_email_attachments.length > 0 : false,
        bandeja: detectBandeja(e.to_email),
      }))
      setTrashedEmails(trashItems)
    }

    setLoading(false)
  }

  const filters = activeBandeja === 'clientes' ? CLIENTES_FILTERS
    : activeBandeja === 'proveedores' ? PROVEEDORES_FILTERS
    : []

  const filtered = activeFilter === 'trash'
    ? trashedEmails.filter(e => e.bandeja === activeBandeja)
    : emails.filter(e => {
        if (e.bandeja !== activeBandeja) return false
        if (activeBandeja === 'personal') return true
        return classMatchesFilter(e.classification, activeFilter)
      })

  const trashCount = trashedEmails.filter(e => e.bandeja === activeBandeja).length

  const counts = {
    proveedores: emails.filter(e => e.bandeja === 'proveedores').length,
    clientes: emails.filter(e => e.bandeja === 'clientes').length,
    personal: emails.filter(e => e.bandeja === 'personal').length,
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      {/* Bandeja tabs */}
      <div className="flex border-b border-neutral-100 bg-neutral-50/50">
        {([
          { id: 'proveedores' as Bandeja, label: 'Proveedores', icon: '🏭' },
          { id: 'clientes' as Bandeja, label: 'Clientes', icon: '👥' },
          { id: 'personal' as Bandeja, label: 'Personal', icon: '👤' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveBandeja(tab.id); setActiveFilter('todos') }}
            className={`flex-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5
              ${activeBandeja === tab.id
                ? 'border-blue-500 text-blue-700 bg-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {counts[tab.id] > 0 && (
              <span className="text-[9px] bg-neutral-200 text-neutral-600 px-1.5 py-0.5 rounded-full font-bold">{counts[tab.id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters (proveedores/clientes only) */}
      {filters.length > 0 && (
        <div className="flex items-center px-4 py-2 border-b border-neutral-100 overflow-x-auto gap-0.5">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap
                ${activeFilter === f.id
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Email list */}
      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-neutral-400">
            No hay emails en esta bandeja
          </div>
        ) : (
          filtered.map(email => {
            const icon = CLS_ICON[email.classification] || CLS_ICON.otro
            const isPersonal = email.bandeja === 'personal'
            const isTrashView = activeFilter === 'trash'

            const inner = (
              <div className={`flex gap-3 px-4 py-2.5 border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors items-start ${email.href && !isTrashView ? 'cursor-pointer' : ''}`}>
                <div className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                  {isPersonal ? '📧' : isTrashView ? '🗑️' : icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold leading-snug truncate">{email.fromName}</span>
                    {email.hasAttachments && <Paperclip className="h-3 w-3 text-neutral-400 flex-shrink-0" />}
                  </div>
                  <div className="text-[11.5px] text-neutral-700 truncate font-medium">{email.subject}</div>
                  {email.summary && (
                    <div className="text-[11px] text-neutral-400 truncate">{email.summary}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-neutral-400 whitespace-nowrap">{timeAgo(email.time)}</span>
                  {isTrashView ? (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); restoreFromTrash(email.id) }}
                      className="ml-1 p-1 rounded hover:bg-blue-50 text-blue-400 hover:text-blue-600 transition-colors"
                      title="Restaurar"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" /></svg>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveToTrash(email.id) }}
                      className="ml-1 p-1 rounded hover:bg-red-50 text-neutral-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Enviar a papelera"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )

            return email.href && !isTrashView
              ? <Link key={email.id} href={email.href} className="block group">{inner}</Link>
              : <div key={email.id} className="group">{inner}</div>
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
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
}
