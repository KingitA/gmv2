'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FileText, Download, X, Loader2, Mail, Paperclip, ExternalLink } from 'lucide-react'

interface Attachment {
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    url: string | null
}

interface EmailPreview {
    id: string
    subject: string
    from: string
    fromEmail: string
    to: string
    bodyHtml: string | null
    bodyText: string | null
    receivedAt: string
    classification: string
    summary: string
}

interface Props {
    emailId: string | null
    open: boolean
    onClose: () => void
}

const FILE_ICONS: Record<string, string> = {
    'application/pdf': '📄',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
    'application/vnd.ms-excel': '📊',
    'text/csv': '📊',
    'image/jpeg': '🖼️',
    'image/png': '🖼️',
    'image/webp': '🖼️',
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—'
    try {
        return new Date(dateStr).toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            timeZone: 'America/Argentina/Buenos_Aires',
        })
    } catch { return dateStr }
}

export function EmailPreviewModal({ emailId, open, onClose }: Props) {
    const [loading, setLoading] = useState(false)
    const [email, setEmail] = useState<EmailPreview | null>(null)
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [activeTab, setActiveTab] = useState<'email' | 'attachments'>('email')

    useEffect(() => {
        if (open && emailId) {
            loadPreview(emailId)
        } else {
            setEmail(null)
            setAttachments([])
        }
    }, [open, emailId])

    const loadPreview = async (id: string) => {
        setLoading(true)
        try {
            const res = await fetch(`/api/ai/emails/${id}/preview`)
            if (res.ok) {
                const data = await res.json()
                setEmail(data.email)
                setAttachments(data.attachments || [])
                setActiveTab(data.email.bodyHtml || data.email.bodyText ? 'email' : 'attachments')
            }
        } catch (e) {
            console.error('Error loading preview:', e)
        }
        setLoading(false)
    }

    const openAttachment = (att: Attachment) => {
        if (att.url) {
            window.open(att.url, '_blank')
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : email ? (
                    <>
                        {/* Header */}
                        <div className="px-5 py-4 border-b space-y-2">
                            <DialogHeader>
                                <DialogTitle className="text-base font-bold leading-snug pr-8">
                                    {email.subject || 'Sin asunto'}
                                </DialogTitle>
                            </DialogHeader>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <div>
                                    <span className="font-semibold text-foreground">{email.from}</span>
                                    {email.fromEmail && (
                                        <span className="ml-1">{'<'}{email.fromEmail}{'>'}</span>
                                    )}
                                </div>
                                <span>{formatDate(email.receivedAt)}</span>
                            </div>
                            {email.to && (
                                <div className="text-[11px] text-muted-foreground">
                                    Para: {email.to}
                                </div>
                            )}
                        </div>

                        {/* Tabs if there are attachments */}
                        {attachments.length > 0 && (
                            <div className="flex border-b">
                                <button
                                    onClick={() => setActiveTab('email')}
                                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === 'email' ? 'border-blue-500 text-blue-700' : 'border-transparent text-muted-foreground'}`}
                                >
                                    <Mail className="h-3.5 w-3.5" />
                                    Mensaje
                                </button>
                                <button
                                    onClick={() => setActiveTab('attachments')}
                                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === 'attachments' ? 'border-blue-500 text-blue-700' : 'border-transparent text-muted-foreground'}`}
                                >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    Adjuntos ({attachments.length})
                                </button>
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 overflow-auto">
                            {activeTab === 'email' ? (
                                <div className="p-5">
                                    {email.bodyHtml ? (
                                        <iframe
                                            srcDoc={`
                                                <!DOCTYPE html>
                                                <html>
                                                <head>
                                                    <meta charset="utf-8">
                                                    <style>
                                                        body { font-family: -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #333; margin: 0; padding: 0; }
                                                        img { max-width: 100%; height: auto; }
                                                        table { max-width: 100%; }
                                                        a { color: #2563eb; }
                                                    </style>
                                                </head>
                                                <body>${email.bodyHtml}</body>
                                                </html>
                                            `}
                                            className="w-full border-0 min-h-[300px]"
                                            style={{ height: '450px' }}
                                            sandbox="allow-same-origin"
                                            title="Email preview"
                                        />
                                    ) : email.bodyText ? (
                                        <pre className="text-sm whitespace-pre-wrap font-sans text-foreground leading-relaxed">
                                            {email.bodyText}
                                        </pre>
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-8">
                                            Sin contenido de email disponible
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <div className="p-4 space-y-2">
                                    {attachments.map(att => {
                                        const icon = FILE_ICONS[att.mimeType] || '📎'
                                        const hasUrl = !!att.url
                                        return (
                                            <div
                                                key={att.id}
                                                className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${hasUrl ? 'hover:bg-muted/50 cursor-pointer' : 'opacity-60'}`}
                                                onClick={() => hasUrl && openAttachment(att)}
                                            >
                                                <span className="text-xl">{icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium truncate">{att.filename}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {formatBytes(att.sizeBytes)}
                                                        {!hasUrl && ' — No disponible para descarga'}
                                                    </div>
                                                </div>
                                                {hasUrl && (
                                                    <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="py-16 text-center text-sm text-muted-foreground">
                        No se pudo cargar la vista previa
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
