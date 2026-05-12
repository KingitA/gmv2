'use client'

import { CalendarRange, RefreshCw } from 'lucide-react'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface PlayroomFiltersProps {
  filters: PlayroomFiltersState
  onChange: (filters: PlayroomFiltersState) => void
  onRefresh?: () => void
  loading?: boolean
  extras?: React.ReactNode
}

const now = new Date()
export const defaultFilters: PlayroomFiltersState = {
  dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  dateTo: now.toISOString().slice(0, 10),
  comparePeriod: 'none',
}

const inputStyle: React.CSSProperties = {
  background: '#1f2937',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  padding: '6px 12px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  colorScheme: 'dark',
}

export default function PlayroomFilters({
  filters,
  onChange,
  onRefresh,
  loading,
  extras,
}: PlayroomFiltersProps) {
  const set = (key: keyof PlayroomFiltersState, value: string) =>
    onChange({ ...filters, [key]: value })

  return (
    <div
      className="flex flex-wrap items-center gap-3 p-4 rounded-xl mb-5"
      style={{
        background: 'rgba(17,24,39,0.6)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <CalendarRange className="h-4 w-4 flex-shrink-0" style={{ color: '#7c3aed' }} />

      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Desde</label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => set('dateFrom', e.target.value)}
          style={inputStyle}
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Hasta</label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => set('dateTo', e.target.value)}
          style={inputStyle}
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Comparar vs</label>
        <select
          value={filters.comparePeriod}
          onChange={e => set('comparePeriod', e.target.value as PlayroomFiltersState['comparePeriod'])}
          style={inputStyle}
        >
          <option value="previous">Período anterior</option>
          <option value="year_ago">Mismo período año anterior</option>
          <option value="none">Sin comparativo</option>
        </select>
      </div>

      {extras}

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
          style={{
            background: 'rgba(124,58,237,0.15)',
            color: '#a78bfa',
            border: '1px solid rgba(124,58,237,0.2)',
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      )}
    </div>
  )
}
