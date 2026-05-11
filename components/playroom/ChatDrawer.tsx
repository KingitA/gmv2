'use client'

import { useState, useRef, useEffect } from 'react'
import ChatMessage from '@/components/playroom/ChatMessage'

interface Message {
  role: 'user' | 'assistant'
  content: string
  data?: any[] | null
}

interface ChatDrawerProps {
  open: boolean
  onClose: () => void
  initialMessage?: string
}

export default function ChatDrawer({ open, onClose, initialMessage }: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historial, setHistorial] = useState<any[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sentInitial = useRef(false)

  useEffect(() => {
    if (open && initialMessage && !sentInitial.current) {
      sentInitial.current = true
      enviar(initialMessage)
    }
  }, [open, initialMessage])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function enviar(texto?: string) {
    const msg = (texto ?? input).trim()
    if (!msg || loading) return
    setInput('')

    const userMsg: Message = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/playroom/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: msg, historial }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: json.respuesta,
        data: json.data,
      }])
      setHistorial(json.historial_actualizado ?? [])
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${e.message}`,
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  function limpiar() {
    setMessages([])
    setHistorial([])
    sentInitial.current = false
    setInput('')
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 z-50 h-full flex flex-col"
        style={{
          width: '480px',
          background: '#0a0f1e',
          borderLeft: '1px solid rgba(124,58,237,0.2)',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)' }}>
              M
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Megasur Assistant</p>
              <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>BI · Compañia de higiene total s.r.l</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={limpiar}
                className="text-[10px] px-2 py-1 rounded"
                style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Nueva conv.
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-lg"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)' }}>
                M
              </div>
              <p className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Hola! Soy el asistente BI de Megasur.<br />
                Preguntame sobre ventas, clientes, stock o comisiones.
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {[
                  '¿Cuánto vendimos este mes?',
                  '¿Qué clientes tienen deuda?',
                  '¿Qué artículos no se mueven hace 60 días?',
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => enviar(q)}
                    className="text-xs px-3 py-2.5 rounded-xl text-left transition-colors"
                    style={{ background: 'rgba(124,58,237,0.1)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(124,58,237,0.2)' }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <ChatMessage key={i} role={m.role} content={m.content} data={m.data} />
          ))}

          {loading && <ChatMessage role="assistant" content="" loading />}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Preguntá sobre ventas, clientes, stock…"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-xl px-4 py-3 text-sm"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(124,58,237,0.25)',
                color: '#fff',
                outline: 'none',
                maxHeight: '120px',
                lineHeight: '1.5',
              }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={() => enviar()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity"
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
                opacity: !input.trim() || loading ? 0.4 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] mt-2 text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Enter para enviar · Shift+Enter para nueva línea
          </p>
        </div>
      </div>
    </>
  )
}
