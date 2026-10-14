'use client'

import { CalendarRange, RefreshCw } from 'lucide-react'
import { FechaInput } from '@/components/finanzas/fecha-input'
import { todayArgentina } from '@/lib/utils'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface PlayroomFiltersProps {
  filters: PlayroomFiltersState
  onChange: (filters: PlayroomFiltersState) => void
  onRefresh?: () => void
  loading?: boolean
  extras?: React.ReactNode
}

const hoy = todayArgentina()
export const defaultFilters: PlayroomFiltersState = {
  dateFrom: hoy.slice(0, 7) + '-01',
  dateTo: hoy,
  comparePeriod: 'none',
}

const selectClass =
  'h-8 rounded-lg border border-neutro-200 bg-white px-3 text-[13px] text-neutro-800 outline-none focus:border-azul-400'

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
    <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl mb-5 bg-white border border-neutro-200">
      <CalendarRange className="h-4 w-4 flex-shrink-0 text-azul-600" />

      <div className="flex items-center gap-2">
        <label className="text-xs text-neutro-500">Desde</label>
        <FechaInput
          value={filters.dateFrom}
          onChange={iso => { if (iso) set('dateFrom', iso) }}
          containerClassName="w-[128px]"
          className="h-8 border-neutro-200 bg-white text-[13px] text-neutro-800"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-neutro-500">Hasta</label>
        <FechaInput
          value={filters.dateTo}
          onChange={iso => { if (iso) set('dateTo', iso) }}
          containerClassName="w-[128px]"
          className="h-8 border-neutro-200 bg-white text-[13px] text-neutro-800"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-neutro-500">Comparar vs</label>
        <select
          value={filters.comparePeriod}
          onChange={e => set('comparePeriod', e.target.value as PlayroomFiltersState['comparePeriod'])}
          className={selectClass}
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
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 bg-azul-50 text-azul-700 border border-azul-100 hover:bg-azul-100"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      )}
    </div>
  )
}
