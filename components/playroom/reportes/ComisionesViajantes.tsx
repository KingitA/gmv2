'use client'

import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import ComparativoBadge from '@/components/playroom/ComparativoBadge'
import ComisionesDrawer from '@/components/playroom/reportes/ComisionesDrawer'
import type { Column } from '@/components/playroom/DataTable'
import type { PlayroomFiltersState } from '@/lib/playroom/types'
import * as XLSX from 'xlsx'

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
  por_segmento?: Record<string, number>
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
  meta: { dateFrom: string; dateTo: string; prevFrom: string; prevTo: string; tipo: string }
}

const COLORS = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6']

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export default function ComisionesViajantes() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tipo, setTipo] = useState<'vendida' | 'cobrada'>('cobrada')
  const [drawerViajante, setDrawerViajante] = useState<ComisionRow | null>(null)

  const load = async (f = filters, t = tipo) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo, compare: f.comparePeriod, tipo: t })
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

  const handleTipoChange = (newTipo: 'vendida' | 'cobrada') => {
    setTipo(newTipo)
    load(filters, newTipo)
  }

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

  const handleExportExcel = () => {
    const data = rows.map(r => ({
      Viajante: r.nombre,
      [tipo === 'cobrada' ? 'Total Cobrada' : 'Total Devengada']: r.devengado,
      'Período anterior': r.devengado_anterior,
      'Var. %': `${r.variacion_pct.toFixed(1)}%`,
      Cobrable: r.cobrable,
      Pagado: r.pagado,
      Pendiente: r.pendiente_cobro,
      '# Pedidos': r.cantidad_pedidos,
      '# Clientes': r.cantidad_clientes,
      'Limpieza/Bazar': r.por_segmento?.limpieza_bazar ?? 0,
      'Perfumería 0': r.por_segmento?.perfumeria ?? 0,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Comisiones')
    XLSX.writeFile(wb, `comisiones_${tipo}_${apiData?.meta.dateFrom ?? ''}_${apiData?.meta.dateTo ?? ''}.xlsx`)
  }

  const handleExportPDF = () => {
    window.print()
  }

  const columns: Column<ComisionRow>[] = [
    { key: 'nombre', label: 'Viajante', sortable: true },
    {
      key: 'devengado',
      label: tipo === 'cobrada' ? 'Total Cobrada' : 'Total Devengada',
      sortable: true, align: 'right',
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
        onRefresh={() => load(filters, tipo)}
        loading={loading}
      />

      {/* Selector tipo + export */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {(['cobrada', 'vendida'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleTipoChange(t)}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${tipo === t ? 'bg-blue-500 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              {t === 'cobrada' ? 'Mercadería Cobrada' : 'Mercadería Vendida'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}
          >
            Exportar Excel
          </button>
          <button
            onClick={handleExportPDF}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
            style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}
          >
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Label de qué tipo se está viendo */}
      <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
        {tipo === 'cobrada'
          ? 'Comisiones reales — calculadas sobre comprobantes cobrados'
          : 'Comisiones estimadas — calculadas sobre pedidos (consulta)'}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label={tipo === 'cobrada' ? 'Total cobrado' : 'Total devengado'}
          value={loading ? '...' : ars(summary.total_devengado)}
          subLabel={loading ? '' : `${rows.length} viajantes`}
          loading={loading}
        />
        <KPICard
          label="Cobrable"
          value={loading ? '...' : ars(summary.total_cobrable)}
          subLabel={loading ? '' : `${kpis.cobrabilidad.toFixed(0)}% del total`}
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
            Comisiones por viajante — {tipo === 'cobrada' ? 'mercadería cobrada' : 'mercadería vendida'}
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
                formatter={(v: number, name: string) => [ars(v), name === 'devengado' ? (tipo === 'cobrada' ? 'Cobrada' : 'Devengada') : 'Cobrable']}
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
        columns={columns}
        loading={loading}
        exportFilename={`comisiones_${tipo}`}
        emptyMessage="No hay comisiones en el período seleccionado"
        pageSize={30}
        onRowClick={row => setDrawerViajante(row)}
      />

      <ComisionesDrawer
        open={drawerViajante !== null}
        onClose={() => setDrawerViajante(null)}
        viajante={drawerViajante}
        tipo={tipo}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
      />
    </div>
  )
}
