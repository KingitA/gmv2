'use client'

import { useState, useEffect, useMemo } from 'react'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import ComparativoBadge from '@/components/playroom/ComparativoBadge'
import type { Column } from '@/components/playroom/DataTable'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface NCRow {
  cliente_id: string
  nombre: string
  nc_count: number
  nc_monto: number
  nc_monto_anterior: number
  variacion_pct: number
  fact_monto: number
  ratio_nc_pct: number | null
  tipo_mas_frecuente: string
  ultima_nc: string | null
}

interface Summary {
  total_nc: number
  total_nc_prev: number
  total_facturado: number
  ratio_pct: number
  variacion_nc_pct: number
}

interface ApiResponse {
  rows: NCRow[]
  summary: Summary
  meta: { dateFrom: string; dateTo: string; prevFrom: string; prevTo: string }
}

const TIPO_COLORS: Record<string, string> = {
  NCA: '#ef4444', NCB: '#f97316', NCC: '#f59e0b',
}

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: '4px 10px',
  color: '#fff',
  fontSize: 12,
  outline: 'none',
}

const COLUMNS: Column<NCRow>[] = [
  { key: 'nombre', label: 'Cliente', sortable: true },
  {
    key: 'nc_count', label: '# NC', sortable: true, align: 'right',
    render: v => <span className="font-mono">{v}</span>,
  },
  {
    key: 'nc_monto', label: 'Monto NC', sortable: true, align: 'right',
    render: v => <span className="font-mono font-semibold text-red-400">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'nc_monto_anterior', label: 'NC anterior', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{v > 0 ? ars(v) : '—'}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'variacion_pct', label: 'Var. NC %', sortable: true, align: 'right',
    render: (v, row) => row.nc_monto_anterior > 0
      ? <ComparativoBadge pct={v} size="sm" invertColor />
      : <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => `${Number(v).toFixed(1)}%`,
  },
  {
    key: 'fact_monto', label: 'Facturado', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>{v > 0 ? ars(v) : '—'}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'ratio_nc_pct', label: '% NC/Fact.', sortable: true, align: 'right',
    render: v => v !== null
      ? (
        <span className="font-mono font-semibold" style={{ color: Number(v) > 15 ? '#ef4444' : Number(v) > 5 ? '#f59e0b' : '#10b981' }}>
          {Number(v).toFixed(1)}%
        </span>
      )
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => v !== null ? `${Number(v).toFixed(1)}%` : '',
  },
  {
    key: 'tipo_mas_frecuente', label: 'Tipo NC', sortable: true,
    render: v => {
      const color = TIPO_COLORS[v] ?? '#6b7280'
      return (
        <span
          className="px-2 py-0.5 rounded text-xs font-bold font-mono"
          style={{ background: `${color}20`, color, border: `1px solid ${color}35` }}
        >
          {v}
        </span>
      )
    },
    exportValue: v => v,
  },
  {
    key: 'ultima_nc', label: 'Última NC', sortable: true,
    render: v => v ? new Date(v).toLocaleDateString('es-AR') : '—',
    exportValue: v => v ?? '',
  },
]

export default function ComprobantesOperativo() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [ratioMin, setRatioMin] = useState(0)

  const load = async (f = filters) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo, compare: f.comparePeriod })
      const res = await fetch(`/api/playroom/control-nc?${params}`)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setApiData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const rows = apiData?.rows ?? []
  const summary = apiData?.summary ?? { total_nc: 0, total_nc_prev: 0, total_facturado: 0, ratio_pct: 0, variacion_nc_pct: 0 }

  const filtered = useMemo(() => rows.filter(r => {
    if (searchText && !r.nombre.toLowerCase().includes(searchText.toLowerCase())) return false
    if (ratioMin > 0 && (r.ratio_nc_pct ?? 0) < ratioMin) return false
    return true
  }), [rows, searchText, ratioMin])

  if (error) return (
    <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <p className="text-red-400 text-sm">Error: {error}</p>
    </div>
  )

  const extraFilters = (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        value={searchText}
        onChange={e => setSearchText(e.target.value)}
        placeholder="Buscar cliente…"
        style={{ ...inputStyle, width: 200 }}
      />
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>% NC mín.</label>
        <input
          type="number"
          value={ratioMin || ''}
          onChange={e => setRatioMin(Number(e.target.value))}
          placeholder="0"
          style={{ ...inputStyle, width: 70 }}
        />
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      <PlayroomFilters
        filters={filters}
        onChange={setFilters}
        onRefresh={() => load(filters)}
        loading={loading}
        extras={extraFilters}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Total NCs emitidas"
          value={loading ? '...' : ars(summary.total_nc)}
          subLabel={loading ? '' : `${rows.length} clientes con NC`}
          variant={summary.total_nc > 0 ? 'danger' : 'default'}
          loading={loading}
        />
        <KPICard
          label="Var. NCs vs período ant."
          value={loading ? '...' : `${summary.variacion_nc_pct >= 0 ? '+' : ''}${summary.variacion_nc_pct.toFixed(1)}%`}
          variant={summary.variacion_nc_pct > 20 ? 'danger' : summary.variacion_nc_pct > 0 ? 'warning' : 'success'}
          loading={loading}
        />
        <KPICard
          label="% NC sobre facturación"
          value={loading ? '...' : `${summary.ratio_pct.toFixed(2)}%`}
          subLabel={loading ? '' : `de ${ars(summary.total_facturado)} facturado`}
          variant={summary.ratio_pct > 10 ? 'danger' : summary.ratio_pct > 5 ? 'warning' : 'default'}
          loading={loading}
        />
        <KPICard
          label="NCs anterior"
          value={loading ? '...' : ars(summary.total_nc_prev)}
          loading={loading}
        />
      </div>

      <DataTable
        data={filtered}
        columns={COLUMNS}
        loading={loading}
        exportFilename="control_nc"
        emptyMessage="No hay notas de crédito en el período seleccionado"
        pageSize={30}
      />
    </div>
  )
}
