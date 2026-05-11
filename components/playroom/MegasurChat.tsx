'use client'

import { useState, useRef } from 'react'

interface MegasurChatProps {
  onOpen: (mensaje?: string) => void
}

const SUGERENCIAS = [
  '¿Cuánto vendimos este mes?',
  '¿Qué clientes tienen deuda?',
  '¿Stock sin movimiento 60 días?',
  '¿Comisiones del mes?',
]

export default function MegasurChat({ onOpen }: MegasurChatProps) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const msg = input.trim()
    setInput('')
    onOpen(msg || undefined)
  }

  return (
    <div
      className="mb-6 rounded-2xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(6,182,212,0.05) 100%)',
        border: '1px solid rgba(124,58,237,0.2)',
        boxShadow: '0 0 40px rgba(124,58,237,0.06)',
      }}
    >
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)' }}
        >
          M
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Preguntale a Megasur Assistant… (ventas, clientes, stock, comisiones)"
            className="flex-1 rounded-xl px-4 py-2.5 text-sm"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(124,58,237,0.2)',
              color: '#fff',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', opacity: 1 }}
          >
            Preguntar
          </button>
        </form>
      </div>

      {/* Sugerencias rápidas */}
      <div className="flex flex-wrap gap-2 mt-3 ml-13" style={{ marginLeft: '52px' }}>
        {SUGERENCIAS.map(s => (
          <button
            key={s}
            onClick={() => { setInput(''); onOpen(s) }}
            className="text-[11px] px-2.5 py-1 rounded-lg transition-colors"
            style={{ background: 'rgba(124,58,237,0.1)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(124,58,237,0.15)' }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
