'use client'

import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import ComparativoBadge from '@/components/playroom/ComparativoBadge'
import type { Column } from '@/components/playroom/DataTable'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface ComisionRow {
  viajante_id: string
  nombre: string
  devengado: number
  devengado_anterior: number
  variacion_pct: number
  cobrable: number
  pagado: number
  pendiente_cobro: number
  cantidad_pedidos: number
  cantidad_clientes: number
}

interface Summary {
  total_devengado: number
  total_cobrable: number
  total_pagado: number
  total_pendiente: number
}

interface ApiResponse {
  rows: ComisionRow[]
  summary: Summary
  meta: { dateFrom: string; dateTo: string; prevFrom: string; prevTo: string }
}

const COLORS = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6']

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

const COLUMNS: Column<ComisionRow>[] = [
  { key: 'nombre', label: 'Viajante', sortable: true },
  {
    key: 'devengado', label: 'Devengado', sortable: true, align: 'right',
    render: v => <span className="font-mono font-semibold">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'devengado_anterior', label: 'Período ant.', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{v > 0 ? ars(v) : '—'}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'variacion_pct', label: 'Var. %', sortable: true, align: 'right',
    render: (v, row) => row.devengado_anterior > 0
      ? <ComparativoBadge pct={v} size="sm" />
      : <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => `${Number(v).toFixed(1)}%`,
  },
  {
    key: 'cobrable', label: 'Cobrable', sortable: true, align: 'right',
    render: v => <span className="font-mono text-emerald-400">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'pagado', label: 'Pagado', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'pendiente_cobro', label: 'Pendiente', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-amber-400 font-semibold">{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 'cantidad_pedidos', label: '# Pedidos', sortable: true, align: 'right',
    render: v => <span className="font-mono">{v}</span>,
  },
  {
    key: 'cantidad_clientes', label: '# Clientes', sortable: true, align: 'right',
    render: v => <span className="font-mono">{v}</span>,
  },
]

export default function ComisionesViajantes() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (f = filters) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo, compare: f.comparePeriod })
      const res = await fetch(`/api/playroom/comisiones?${params}`)
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
  const summary = apiData?.summary ?? { total_devengado: 0, total_cobrable: 0, total_pagado: 0, total_pendiente: 0 }

  const kpis = useMemo(() => {
    const cobrabilidad = summary.total_devengado > 0
      ? (summary.total_cobrable / summary.total_devengado) * 100
      : 0
    return { cobrabilidad }
  }, [summary])

  const chartData = useMemo(() =>
    rows.map((r, i) => ({
      name: r.nombre.split(' ')[0],
      fullName: r.nombre,
      devengado: r.devengado,
      cobrable: r.cobrable,
      color: COLORS[i % COLORS.length],
    }))
  , [rows])

  if (error) return (
    <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <p className="text-red-400 text-sm">Error: {error}</p>
    </div>
  )

  return (
    <div className="space-y-5">
      <PlayroomFilters
        filters={filters}
        onChange={setFilters}
        onRefresh={() => load(filters)}
        loading={loading}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Total devengado"
          value={loading ? '...' : ars(summary.total_devengado)}
          subLabel={loading ? '' : `${rows.length} viajantes`}
          loading={loading}
        />
        <KPICard
          label="Cobrable"
          value={loading ? '...' : ars(summary.total_cobrable)}
          subLabel={loading ? '' : `${kpis.cobrabilidad.toFixed(0)}% del devengado`}
          variant="success"
          loading={loading}
        />
        <KPICard
          label="Pendiente de pago"
          value={loading ? '...' : ars(summary.total_pendiente)}
          variant={summary.total_pendiente > 0 ? 'warning' : 'default'}
          loading={loading}
        />
        <KPICard
          label="Ya pagado"
          value={loading ? '...' : ars(summary.total_pagado)}
          loading={loading}
        />
      </div>

      {/* Chart */}
      {!loading && chartData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Comisiones devengadas por viajante
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 10, right: 10, top: 0, bottom: 10 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number, name: string) => [ars(v), name === 'devengado' ? 'Devengado' : 'Cobrable']}
                labelFormatter={(_l, p) => p?.[0]?.payload?.fullName || _l}
                contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }}
              />
              <Bar dataKey="devengado" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {chartData.map((e, i) => (
                  <Cell key={i} fill={e.color} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <DataTable
        data={rows}
        columns={COLUMNS}
        loading={loading}
        exportFilename="comisiones_viajantes"
        emptyMessage="No hay comisiones en el período seleccionado"
        pageSize={30}
      />
    </div>
  )
}
