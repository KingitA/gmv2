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

// Una sola serie: todas las barras en azul-500 (los colores por viajante no codifican nada)
const COLORS = ['#4549B5']

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
      render: v => <span className="font-mono" style={{ color: '#6E7290' }}>{v > 0 ? ars(v) : '—'}</span>,
      exportValue: v => String(v),
    },
    {
      key: 'variacion_pct', label: 'Var. %', sortable: true, align: 'right',
      render: (v, row) => row.devengado_anterior > 0
        ? <ComparativoBadge pct={v} size="sm" />
        : <span className="text-xs" style={{ color: '#9295AE' }}>—</span>,
      exportValue: v => `${Number(v).toFixed(1)}%`,
    },
    {
      key: 'cobrable', label: 'Cobrable', sortable: true, align: 'right',
      render: v => <span className="font-mono text-exito-600">{ars(v)}</span>,
      exportValue: v => String(v),
    },
    {
      key: 'pagado', label: 'Pagado', sortable: true, align: 'right',
      render: v => <span className="font-mono" style={{ color: '#545871' }}>{ars(v)}</span>,
      exportValue: v => String(v),
    },
    {
      key: 'pendiente_cobro', label: 'Pendiente', sortable: true, align: 'right',
      render: v => v > 0
        ? <span className="font-mono text-ambar-700 font-semibold">{ars(v)}</span>
        : <span style={{ color: '#9295AE' }}>—</span>,
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
    <div className="rounded-xl p-6" style={{ background: '#FBEBED', border: '1px solid #F6D0D5' }}>
      <p className="text-error-600 text-sm">Error: {error}</p>
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
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: '#F0F1F7', border: '1px solid #E3E5EF' }}>
          {(['cobrada', 'vendida'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleTipoChange(t)}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${tipo === t ? 'bg-azul-600 text-white shadow-sm' : 'text-neutro-500 hover:text-neutro-800'}`}
            >
              {t === 'cobrada' ? 'Mercadería Cobrada' : 'Mercadería Vendida'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-exito-600 hover:text-exito-700 transition-colors"
            style={{ background: '#E6F4EE', border: '1px solid #C5E6D7' }}
          >
            Exportar Excel
          </button>
          <button
            onClick={handleExportPDF}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-azul-600 hover:text-azul-800 transition-colors"
            style={{ background: '#EEEEF6', border: '1px solid #CFD0E4' }}
          >
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Label de qué tipo se está viendo */}
      <div className="text-xs font-semibold" style={{ color: '#545871' }}>
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
        <div className="rounded-xl p-5" style={{ background: '#FFFFFF', border: '1px solid #E3E5EF' }}>
          <p className="text-xs font-semibold mb-4" style={{ color: '#545871' }}>
            Comisiones por viajante — {tipo === 'cobrada' ? 'mercadería cobrada' : 'mercadería vendida'}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 10, right: 10, top: 0, bottom: 10 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#6E7290', fontSize: 11 }}
                axisLine={{ stroke: '#E3E5EF' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fill: '#6E7290', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number, name: string) => [ars(v), name === 'devengado' ? (tipo === 'cobrada' ? 'Cobrada' : 'Devengada') : 'Cobrable']}
                labelFormatter={(_l, p) => p?.[0]?.payload?.fullName || _l}
                contentStyle={{ background: '#FFFFFF', border: '1px solid #E3E5EF', borderRadius: 8, color: '#1E2030', fontSize: 12 }}
              />
              <Bar dataKey="devengado" radius={[4, 4, 0, 0]} maxBarSize={24}>
                {chartData.map((e, i) => (
                  <Cell key={i} fill={e.color} />
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
