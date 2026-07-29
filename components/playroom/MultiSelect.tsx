'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  width?: number
  searchable?: boolean
}

/**
 * Dropdown multi-selección estilo Playroom (dark). Sin selección = "Todos".
 */
export default function MultiSelect({
  options,
  values,
  onChange,
  placeholder = 'Todos',
  width = 160,
  searchable = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEffect(() => { if (!open) setSearch('') }, [open])

  const filtered = useMemo(() => {
    if (!search) return options
    const q = search.toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, search])

  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value])

  const labelFor = (value: string) => options.find(o => o.value === value)?.label ?? value

  const buttonText = values.length === 0
    ? placeholder
    : values.length === 1
      ? labelFor(values[0])
      : `${values.length} seleccionados`

  return (
    <div ref={rootRef} className="relative" style={{ width }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors"
        style={{
          background: '#1f2937',
          border: values.length > 0 ? '1px solid rgba(124,58,237,0.45)' : '1px solid rgba(255,255,255,0.08)',
          color: values.length > 0 ? '#a78bfa' : '#fff',
          minHeight: 26,
        }}
      >
        <span className="truncate text-left">{buttonText}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {values.length > 0 && (
            <X
              className="h-3 w-3"
              style={{ color: 'rgba(255,255,255,0.4)' }}
              onClick={e => { e.stopPropagation(); onChange([]) }}
            />
          )}
          <ChevronDown className="h-3 w-3" style={{ color: 'rgba(255,255,255,0.4)' }} />
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full min-w-[180px] rounded-lg overflow-hidden shadow-xl"
          style={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {searchable && (
            <div className="p-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded px-2 py-1 text-xs"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', outline: 'none' }}
              />
            </div>
          )}

          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange([]); setOpen(false) }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors hover:bg-white/5"
              style={{ color: values.length === 0 ? '#a78bfa' : 'rgba(255,255,255,0.6)' }}
            >
              <span className="w-3.5" />
              {placeholder} (limpiar)
            </button>
            {filtered.map(o => {
              const checked = values.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors hover:bg-white/5"
                  style={{ color: checked ? '#fff' : 'rgba(255,255,255,0.6)' }}
                >
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded flex-shrink-0"
                    style={{
                      background: checked ? '#7c3aed' : 'transparent',
                      border: checked ? '1px solid #7c3aed' : '1px solid rgba(255,255,255,0.2)',
                    }}
                  >
                    {checked && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Sin resultados</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
