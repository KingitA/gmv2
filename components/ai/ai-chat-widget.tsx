'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
    MessageCircle,
    X,
    Send,
    Loader2,
    Calendar,
    Mail,
    RefreshCw,
    Settings,
    Brain,
    Minimize2,
    Maximize2,
    Trash2,
    Plus,
} from 'lucide-react'
import { AgendaPanel } from './agenda-panel'

// ─── Types ─────────────────────────────────────────────

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
}

interface ChatTab {
    id: string
    title: string
    openedAt: string // ISO date string
}

interface GmailStatus {
    connectedAccounts: string[]
    totalEmailsSynced: number
    totalEvents: number
    pendingImportReviews?: number
}

type InternalTab = 'chat' | 'agenda' | 'settings'

const STORAGE_KEY = 'gm-brain-tabs'
const MAX_AGE_DAYS = 7

// ─── Helpers ───────────────────────────────────────────

function loadTabsFromStorage(): { tabs: ChatTab[]; activeTabId: string | null } {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return { tabs: [], activeTabId: null }
        const parsed = JSON.parse(raw)
        // Filter out tabs older than 7 days
        const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
        const validTabs = (parsed.tabs || []).filter(
            (t: ChatTab) => new Date(t.openedAt).getTime() > cutoff
        )
        return {
            tabs: validTabs,
            activeTabId: validTabs.find((t: ChatTab) => t.id === parsed.activeTabId)
                ? parsed.activeTabId
                : validTabs.length > 0
                    ? validTabs[0].id
                    : null,
        }
    } catch {
        return { tabs: [], activeTabId: null }
    }
}

function saveTabsToStorage(tabs: ChatTab[], activeTabId: string | null) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }))
    } catch {
        // quota exceeded, silently fail
    }
}

// ─── Component ─────────────────────────────────────────

export function AiChatWidget() {
    // Multi-session state
    const [chatTabs, setChatTabs] = useState<ChatTab[]>([])
    const [activeTabId, setActiveTabId] = useState<string | null>(null)
    const [messagesCache, setMessagesCache] = useState<Record<string, Message[]>>({})
    const [loadingMessages, setLoadingMessages] = useState<Record<string, boolean>>({})

    // UI state
    const [isOpen, setIsOpen] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [activeInternalTab, setActiveInternalTab] = useState<InternalTab>('chat')
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isSyncing, setIsSyncing] = useState(false)
    const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null)
    const [showPulse, setShowPulse] = useState(true)
    const [isCreatingNew, setIsCreatingNew] = useState(false)

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const initializedRef = useRef(false)

    // ── Initialize from localStorage on mount ──────────
    useEffect(() => {
        if (initializedRef.current) return
        initializedRef.current = true

        const { tabs, activeTabId: storedActiveId } = loadTabsFromStorage()
        setChatTabs(tabs)
        setActiveTabId(storedActiveId)

        // Archive expired tabs on server
        const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
            try {
                const parsed = JSON.parse(raw)
                const expiredTabs = (parsed.tabs || []).filter(
                    (t: ChatTab) => new Date(t.openedAt).getTime() <= cutoff
                )
                for (const t of expiredTabs) {
                    fetch(`/api/ai/chat/sessions/${t.id}`, { method: 'DELETE' }).catch(() => { })
                }
            } catch { }
        }
    }, [])

    // ── Persist tabs to localStorage on change ─────────
    useEffect(() => {
        if (!initializedRef.current) return
        saveTabsToStorage(chatTabs, activeTabId)
    }, [chatTabs, activeTabId])

    // ── Load messages for active tab ───────────────────
    useEffect(() => {
        if (!activeTabId || messagesCache[activeTabId] || loadingMessages[activeTabId]) return
        loadMessagesForTab(activeTabId)
    }, [activeTabId]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-scroll ────────────────────────────────────
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messagesCache, activeTabId])

    // ── Focus input ────────────────────────────────────
    useEffect(() => {
        if (isOpen && activeInternalTab === 'chat' && activeTabId) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [isOpen, activeInternalTab, activeTabId])

    // ── Load Gmail status ──────────────────────────────
    useEffect(() => {
        if (isOpen) {
            fetchGmailStatus()
            setShowPulse(false)
        }
    }, [isOpen])

    // ── API calls ──────────────────────────────────────

    const loadMessagesForTab = async (tabId: string) => {
        setLoadingMessages((prev) => ({ ...prev, [tabId]: true }))
        try {
            const res = await fetch(`/api/ai/chat?conversationId=${tabId}`)
            if (res.ok) {
                const data = await res.json()
                const msgs: Message[] = (data.messages || []).map((m: { id: string; role: string; content: string; created_at: string }) => ({
                    id: m.id,
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                    timestamp: new Date(m.created_at),
                }))
                setMessagesCache((prev) => ({ ...prev, [tabId]: msgs }))
            }
        } catch {
            // Failed to load, set empty
            setMessagesCache((prev) => ({ ...prev, [tabId]: [] }))
        } finally {
            setLoadingMessages((prev) => ({ ...prev, [tabId]: false }))
        }
    }

    const fetchGmailStatus = async () => {
        try {
            const res = await fetch('/api/ai/gmail/sync')
            if (res.ok) {
                const data = await res.json()
                setGmailStatus(data)
            }
        } catch { }
    }

    const createNewChat = useCallback(() => {
        setIsCreatingNew(true)
        setActiveInternalTab('chat')
        setInput('')
        // We'll create the actual conversation on first message
        // For now just show an empty chat interface
        setActiveTabId(null)
    }, [])

    const sendMessage = useCallback(async () => {
        if (!input.trim() || isLoading) return

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date(),
        }

        const currentTabId = activeTabId
        const messageText = input.trim()
        setInput('')
        setIsLoading(true)

        // Optimistically add user message to cache
        if (currentTabId) {
            setMessagesCache((prev) => ({
                ...prev,
                [currentTabId]: [...(prev[currentTabId] || []), userMessage],
            }))
        }

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: messageText,
                    conversationId: currentTabId,
                }),
            })

            const data = await res.json()

            if (data.error) {
                const errorMsg: Message = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: `⚠️ Error: ${data.error}`,
                    timestamp: new Date(),
                }
                const tabForError = currentTabId || data.conversationId
                if (tabForError) {
                    setMessagesCache((prev) => ({
                        ...prev,
                        [tabForError]: [...(prev[tabForError] || [userMessage]), errorMsg],
                    }))
                }
            } else {
                const newConvId = data.conversationId
                const assistantMsg: Message = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: data.response,
                    timestamp: new Date(),
                }

                // If this was a new conversation, create the tab
                if (!currentTabId && newConvId) {
                    const newTab: ChatTab = {
                        id: newConvId,
                        title: messageText.substring(0, 50),
                        openedAt: new Date().toISOString(),
                    }
                    setChatTabs((prev) => [newTab, ...prev])
                    setActiveTabId(newConvId)
                    setIsCreatingNew(false)
                    setMessagesCache((prev) => ({
                        ...prev,
                        [newConvId]: [userMessage, assistantMsg],
                    }))
                } else if (currentTabId) {
                    setMessagesCache((prev) => ({
                        ...prev,
                        [currentTabId]: [...(prev[currentTabId] || []), assistantMsg],
                    }))
                }
            }
        } catch {
            const errorMsg: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '⚠️ Error de conexión. Verificá que el servidor esté corriendo.',
                timestamp: new Date(),
            }
            const tabForError = currentTabId
            if (tabForError) {
                setMessagesCache((prev) => ({
                    ...prev,
                    [tabForError]: [...(prev[tabForError] || []), errorMsg],
                }))
            }
        } finally {
            setIsLoading(false)
        }
    }, [input, isLoading, activeTabId])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    const closeTab = async (tabId: string, e?: React.MouseEvent) => {
        e?.stopPropagation()
        // Archive on server
        fetch(`/api/ai/chat/sessions/${tabId}`, { method: 'DELETE' }).catch(() => { })

        setChatTabs((prev) => {
            const newTabs = prev.filter((t) => t.id !== tabId)
            // If we closed the active tab, switch to next available
            if (activeTabId === tabId) {
                setActiveTabId(newTabs.length > 0 ? newTabs[0].id : null)
                if (newTabs.length === 0) setIsOpen(false)
            }
            return newTabs
        })
        setMessagesCache((prev) => {
            const next = { ...prev }
            delete next[tabId]
            return next
        })
    }

    const switchTab = (tabId: string) => {
        setActiveTabId(tabId)
        setActiveInternalTab('chat')
        setIsCreatingNew(false)
        if (!isOpen) setIsOpen(true)
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

            if (!activeTabId) return

            if (data.error) {
                setMessagesCache((prev) => ({
                    ...prev,
                    [activeTabId]: [
                        ...(prev[activeTabId] || []),
                        {
                            id: crypto.randomUUID(),
                            role: 'assistant' as const,
                            content: `📧 Error sincronizando Gmail: ${data.error}`,
                            timestamp: new Date(),
                        },
                    ],
                }))
            } else {
                setMessagesCache((prev) => ({
                    ...prev,
                    [activeTabId]: [
                        ...(prev[activeTabId] || []),
                        {
                            id: crypto.randomUUID(),
                            role: 'assistant' as const,
                            content: `📧 **Gmail sincronizado!**\n- Emails encontrados: ${data.totalFetched}\n- Nuevos procesados: ${data.newEmails}\n- Clasificados: ${data.classified}\n- Eventos creados: ${data.eventsCreated}${data.ordersProcessed > 0 ? `\n\n📦 **Pedidos detectados:** ${data.ordersProcessed}${data.ordersAutoCreated > 0 ? `\n- ✅ Creados automáticamente: ${data.ordersAutoCreated}` : ''}${data.ordersSentToReview > 0 ? `\n- ⚠️ Requieren revisión: ${data.ordersSentToReview} → Ver en /clientes-pedidos/import-review` : ''}` : ''}${data.errors?.length ? `\n\n⚠️ Errores: ${data.errors.length}` : ''}`,
                            timestamp: new Date(),
                        },
                    ],
                }))
                fetchGmailStatus()
            }
        } catch {
            if (activeTabId) {
                setMessagesCache((prev) => ({
                    ...prev,
                    [activeTabId]: [
                        ...(prev[activeTabId] || []),
                        {
                            id: crypto.randomUUID(),
                            role: 'assistant' as const,
                            content: '⚠️ Error al sincronizar Gmail.',
                            timestamp: new Date(),
                        },
                    ],
                }))
            }
        } finally {
            setIsSyncing(false)
        }
    }

    // ── Derived state ──────────────────────────────────

    const currentMessages = activeTabId ? (messagesCache[activeTabId] || []) : []
    const isLoadingCurrentTab = activeTabId ? loadingMessages[activeTabId] : false
    const showEmptyState = !activeTabId && !isCreatingNew && chatTabs.length === 0
    const showNewChatState = isCreatingNew || (!activeTabId && chatTabs.length === 0)

    const widgetSize = isExpanded
        ? 'w-[600px] h-[700px]'
        : 'w-[400px] h-[550px]'

    const hasOpenTabs = chatTabs.length > 0

    return (
        <>
            {/* ── Chat Window ────────────────────────────────── */}
            {isOpen && (
                <div
                    className={`fixed ${hasOpenTabs ? 'bottom-[46px]' : 'bottom-20'} right-5 ${widgetSize} bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col z-[9999] transition-all duration-300 overflow-hidden`}
                    style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.2)' }}
                >
                    {/* Header */}
                    <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-3 flex items-center justify-between rounded-t-2xl">
                        <div className="flex items-center gap-2">
                            <Brain className="h-5 w-5" />
                            <span className="font-semibold text-sm">GM Brain</span>
                            {activeTabId && (
                                <span className="text-[10px] bg-white/20 text-white/90 px-2 py-0.5 rounded-full max-w-[140px] truncate">
                                    {chatTabs.find((t) => t.id === activeTabId)?.title || 'Chat'}
                                </span>
                            )}
                            {gmailStatus && gmailStatus.connectedAccounts.length > 0 && (
                                <span className="text-[10px] bg-green-400/30 text-green-100 px-2 py-0.5 rounded-full">
                                    Gmail conectado
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={createNewChat}
                                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                                title="Nuevo chat"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                                title={isExpanded ? 'Minimizar' : 'Expandir'}
                            >
                                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                                title="Minimizar"
                            >
                                <Minimize2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Internal Tabs (Chat / Agenda / Settings) */}
                    <div className="flex border-b border-neutral-200">
                        {[
                            { id: 'chat' as InternalTab, icon: MessageCircle, label: 'Chat' },
                            { id: 'agenda' as InternalTab, icon: Calendar, label: 'Agenda' },
                            { id: 'settings' as InternalTab, icon: Settings, label: 'Config' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveInternalTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${activeInternalTab === tab.id
                                    ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
                                    : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'
                                    }`}
                            >
                                <tab.icon className="h-3.5 w-3.5" />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {activeInternalTab === 'chat' && (
                            <>
                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {isLoadingCurrentTab && (
                                        <div className="flex items-center justify-center h-full">
                                            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                                        </div>
                                    )}

                                    {!isLoadingCurrentTab && (showNewChatState || currentMessages.length === 0) && (
                                        <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400 gap-3">
                                            <Brain className="h-12 w-12 text-indigo-200" />
                                            <div>
                                                <p className="font-medium text-neutral-500">
                                                    {isCreatingNew ? '✨ Nuevo chat' : '¡Hola! Soy GM Brain'}
                                                </p>
                                                <p className="text-xs mt-1">
                                                    {isCreatingNew
                                                        ? 'Escribí tu consulta para comenzar una nueva conversación.'
                                                        : 'Preguntame sobre clientes, proveedores, pedidos, stock, o pedime que sincronice Gmail.'}
                                                </p>
                                            </div>
                                            {!isCreatingNew && (
                                                <div className="flex gap-2 mt-2">
                                                    <button
                                                        onClick={() => { setIsCreatingNew(true); setInput('¿Qué emails llegaron hoy?') }}
                                                        className="text-[11px] px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                                                    >
                                                        📧 Emails de hoy
                                                    </button>
                                                    <button
                                                        onClick={() => { setIsCreatingNew(true); setInput('¿Qué tengo pendiente en la agenda?') }}
                                                        className="text-[11px] px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                                                    >
                                                        📅 Mi agenda
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!isLoadingCurrentTab && currentMessages.map((msg) => (
                                        <div
                                            key={msg.id}
                                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div
                                                className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user'
                                                    ? 'bg-indigo-600 text-white rounded-br-md'
                                                    : 'bg-neutral-100 text-neutral-800 rounded-bl-md'
                                                    }`}
                                            >
                                                {msg.content}
                                            </div>
                                        </div>
                                    ))}

                                    {isLoading && (
                                        <div className="flex justify-start">
                                            <div className="bg-neutral-100 text-neutral-500 px-4 py-2.5 rounded-2xl rounded-bl-md flex items-center gap-2 text-sm">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Pensando...
                                            </div>
                                        </div>
                                    )}

                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Input */}
                                <div className="p-3 border-t border-neutral-200 bg-white">
                                    <div className="flex items-end gap-2">
                                        <div className="flex gap-1">
                                            <button
                                                onClick={syncGmail}
                                                disabled={isSyncing}
                                                className="p-2 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                                                title="Sincronizar Gmail"
                                            >
                                                {isSyncing ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Mail className="h-4 w-4" />
                                                )}
                                            </button>
                                        </div>
                                        <textarea
                                            ref={inputRef}
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            placeholder="Escribí tu mensaje..."
                                            rows={1}
                                            className="flex-1 resize-none border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-neutral-400 max-h-24"
                                            style={{ minHeight: '40px' }}
                                        />
                                        <button
                                            onClick={sendMessage}
                                            disabled={!input.trim() || isLoading}
                                            className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <Send className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        {activeInternalTab === 'agenda' && <AgendaPanel />}

                        {activeInternalTab === 'settings' && (
                            <div className="p-4 space-y-4">
                                <h3 className="font-semibold text-sm text-neutral-700">Configuración</h3>

                                {/* Gmail Connection */}
                                <div className="space-y-2">
                                    <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                                        Gmail
                                    </h4>
                                    {gmailStatus && gmailStatus.connectedAccounts.length > 0 ? (
                                        <div className="space-y-2">
                                            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                                                <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                                                    <Mail className="h-4 w-4" />
                                                    Conectado
                                                </div>
                                                {gmailStatus.connectedAccounts.map((acc) => (
                                                    <p key={acc} className="text-xs text-green-600 mt-1">
                                                        📧 {acc}
                                                    </p>
                                                ))}
                                                <div className="mt-2 flex gap-3 text-xs text-green-600">
                                                    <span>{gmailStatus.totalEmailsSynced} emails</span>
                                                    <span>{gmailStatus.totalEvents} eventos</span>
                                                </div>
                                            </div>
                                            <a
                                                href="/api/auth/google"
                                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-medium rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-200"
                                            >
                                                <Plus className="h-3 w-3" />
                                                Agregar otro email
                                            </a>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                                                <p className="text-xs text-amber-700">
                                                    Gmail no está conectado. Conectá tu cuenta para sincronizar emails.
                                                </p>
                                            </div>
                                            <a
                                                href="/api/auth/google"
                                                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                                            >
                                                <Mail className="h-3.5 w-3.5" />
                                                Conectar Gmail
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {/* Sync Controls */}
                                <div className="space-y-2">
                                    <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                                        Sincronización
                                    </h4>
                                    <button
                                        onClick={syncGmail}
                                        disabled={isSyncing || !gmailStatus?.connectedAccounts?.length}
                                        className="flex items-center gap-2 px-4 py-2 bg-neutral-100 text-neutral-700 text-xs font-medium rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50"
                                    >
                                        <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                                        {isSyncing ? 'Sincronizando...' : 'Sincronizar Gmail ahora'}
                                    </button>
                                </div>

                                {/* Brain Info */}
                                <div className="space-y-2">
                                    <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                                        Acerca de
                                    </h4>
                                    <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs text-neutral-600 space-y-1">
                                        <p><strong>GM Brain v2.0</strong></p>
                                        <p>Motor: Claude (Anthropic)</p>
                                        <p>Fuentes: Gmail · Chat Interno</p>
                                        <p>Capacidades: Clasificación, Agenda, Consultas ERP</p>
                                        <p className="text-neutral-400 mt-1">Los chats se guardan automáticamente por 7 días.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Bottom Tab Bar ──────────────────────────────── */}
            {hasOpenTabs && (
                <div className="fixed bottom-0 left-0 right-0 z-[9998] flex items-center bg-neutral-900/95 backdrop-blur-sm border-t border-neutral-700/50 h-[42px] px-2 gap-1 overflow-x-auto"
                    style={{ scrollbarWidth: 'none' }}
                >
                    {/* Brain icon / toggle */}
                    <button
                        onClick={() => {
                            if (isOpen) {
                                setIsOpen(false)
                            } else {
                                setIsOpen(true)
                                setActiveInternalTab('chat')
                                if (!activeTabId && chatTabs.length > 0) {
                                    setActiveTabId(chatTabs[0].id)
                                }
                            }
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-neutral-700/60 transition-colors flex-shrink-0"
                        title="GM Brain"
                    >
                        <Brain className="h-4 w-4 text-violet-400" />
                    </button>

                    <div className="w-px h-5 bg-neutral-700 mx-1 flex-shrink-0" />

                    {/* Chat Tabs */}
                    {chatTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => switchTab(tab.id)}
                            className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all max-w-[180px] flex-shrink-0 ${activeTabId === tab.id && isOpen
                                ? 'bg-indigo-600/80 text-white'
                                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/60'
                                }`}
                        >
                            <MessageCircle className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{tab.title}</span>
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => closeTab(tab.id, e as unknown as React.MouseEvent)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') closeTab(tab.id) }}
                                className={`ml-1 p-0.5 rounded flex-shrink-0 transition-colors cursor-pointer ${activeTabId === tab.id && isOpen
                                    ? 'hover:bg-white/20 text-white/70 hover:text-white'
                                    : 'hover:bg-neutral-600 text-neutral-500 hover:text-neutral-300 opacity-0 group-hover:opacity-100'
                                    }`}
                                title="Cerrar chat"
                            >
                                <X className="h-3 w-3" />
                            </span>
                        </button>
                    ))}

                    {/* New chat button */}
                    <button
                        onClick={() => {
                            createNewChat()
                            setIsOpen(true)
                        }}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/60 transition-colors flex-shrink-0"
                        title="Nuevo chat"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* ── Floating Button (only when no tabs open) ────── */}
            {!hasOpenTabs && (
                <button
                    onClick={() => {
                        setIsOpen(!isOpen)
                        if (!isOpen) {
                            setIsCreatingNew(true)
                            setActiveInternalTab('chat')
                        }
                    }}
                    className={`fixed bottom-5 right-5 z-[9999] p-4 rounded-full shadow-lg transition-all duration-300 ${isOpen
                        ? 'bg-neutral-700 hover:bg-neutral-800 rotate-0'
                        : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700'
                        }`}
                    style={{ boxShadow: '0 8px 30px rgba(99,102,241,0.4)' }}
                    title={isOpen ? 'Cerrar GM Brain' : 'Abrir GM Brain'}
                >
                    {isOpen ? (
                        <X className="h-6 w-6 text-white" />
                    ) : (
                        <Brain className="h-6 w-6 text-white" />
                    )}

                    {/* Pulse animation when closed */}
                    {!isOpen && showPulse && (
                        <span className="absolute top-0 right-0 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-300 opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-400" />
                        </span>
                    )}
                </button>
            )}
        </>
    )
}
