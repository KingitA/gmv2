'use client'

import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import ComparativoBadge from '@/components/playroom/ComparativoBadge'
import { formatDateAR } from '@/lib/utils'
import type { Column } from '@/components/playroom/DataTable'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface ClienteRow {
  cliente_id: string
  nombre: string
  localidad: string
  tipo_canal: string
  vendedor_nombre: string
  facturacion: number
  facturacion_anterior: number
  variacion_pct: number
  cantidad_comprobantes: number
  saldo_pendiente: number
  ultima_compra: string | null
  estado: 'Activo' | 'En riesgo' | 'Perdido' | 'Nuevo'
  clasificacion: 'A' | 'B' | 'C'
}

interface ApiResponse {
  rows: ClienteRow[]
  meta: { dateFrom: string; dateTo: string; prevFrom: string; prevTo: string; totalFact: number }
}

const ESTADO_COLOR: Record<string, string> = {
  Activo: '#15805A',
  'En riesgo': '#CD9014',
  Perdido: '#D2364B',
  Nuevo: '#4549B5',
}
const ABC_COLOR: Record<string, string> = { A: '#4549B5', B: '#22A9C9', C: '#6E7290' }

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

const inputStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E3E5EF',
  borderRadius: 8,
  padding: '4px 10px',
  color: '#20233A',
  fontSize: 12,
  outline: 'none',
}

function FilterBtn({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  const c = color ?? '#4549B5'
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
      style={active
        ? { background: `${c}25`, color: c, border: `1px solid ${c}45` }
        : { color: '#545871', background: '#FFFFFF', border: '1px solid #E3E5EF' }
      }
    >
      {label}
    </button>
  )
}

const COLUMNS: Column<ClienteRow>[] = [
  {
    key: 'clasificacion', label: 'ABC', sortable: true,
    render: (v: 'A' | 'B' | 'C') => (
      <span className="font-bold text-base" style={{ color: ABC_COLOR[v] }}>{v}</span>
    ),
  },
  { key: 'nombre', label: 'Cliente', sortable: true },
  { key: 'localidad', label: 'Localidad', sortable: true },
  { key: 'vendedor_nombre', label: 'Vendedor', sortable: true },
  { key: 'tipo_canal', label: 'Canal', sortable: true },
  {
    key: 'facturacion', label: 'Facturación', sortable: true, align: 'right',
    render: v => <span className="font-mono font-semibold">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'facturacion_anterior', label: 'Período ant.', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: '#545871' }}>{v > 0 ? ars(v) : '—'}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'variacion_pct', label: 'Var. %', sortable: true, align: 'right',
    render: (v, row) => row.facturacion_anterior > 0
      ? <ComparativoBadge pct={v} size="sm" />
      : <span className="text-xs" style={{ color: '#9295AE' }}>—</span>,
    exportValue: v => `${Number(v).toFixed(1)}%`,
  },
  {
    key: 'cantidad_comprobantes', label: '# Comp.', sortable: true, align: 'right',
    render: v => <span className="font-mono">{v}</span>,
  },
  {
    key: 'saldo_pendiente', label: 'Saldo pend.', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-ambar-700">{ars(v)}</span>
      : <span style={{ color: '#9295AE' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 'ultima_compra', label: 'Última compra', sortable: true,
    render: v => v ? formatDateAR(v) : '—',
    exportValue: v => v ?? '',
  },
  {
    key: 'estado', label: 'Estado', sortable: true,
    render: (v: string) => (
      <span
        className="px-2 py-0.5 rounded-md text-xs font-semibold"
        style={{
          background: `${ESTADO_COLOR[v]}18`,
          color: ESTADO_COLOR[v],
          border: `1px solid ${ESTADO_COLOR[v]}35`,
        }}
      >
        {v}
      </span>
    ),
    exportValue: v => v,
  },
]

export default function RankingClientesABC() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estadoFiltro, setEstadoFiltro] = useState('Todos')
  const [abcFiltro, setAbcFiltro] = useState('Todos')

  const load = async (f = filters) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo, compare: f.comparePeriod })
      const res = await fetch(`/api/playroom/clientes-abc?${params}`)
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

  const filtered = useMemo(() => rows.filter(r => {
    if (estadoFiltro !== 'Todos' && r.estado !== estadoFiltro) return false
    if (abcFiltro !== 'Todos' && r.clasificacion !== abcFiltro) return false
    return true
  }), [rows, estadoFiltro, abcFiltro])

  const kpis = useMemo(() => {
    const countA = rows.filter(r => r.clasificacion === 'A').length
    const countB = rows.filter(r => r.clasificacion === 'B').length
    const countC = rows.filter(r => r.clasificacion === 'C').length
    const enRiesgo = rows.filter(r => r.estado === 'En riesgo' || r.estado === 'Perdido').length
    const nuevos = rows.filter(r => r.estado === 'Nuevo').length
    const total = apiData?.meta.totalFact ?? 0
    const top10 = rows.slice(0, 10).reduce((s, r) => s + r.facturacion, 0)
    const concPct = total > 0 ? (top10 / total) * 100 : 0
    return { countA, countB, countC, enRiesgo, nuevos, concPct, total }
  }, [rows, apiData])

  const paretoData = useMemo(() => {
    let cum = 0
    const total = apiData?.meta.totalFact ?? 0
    return rows.slice(0, 25).map(r => {
      cum += r.facturacion
      return {
        name: r.nombre.length > 18 ? r.nombre.slice(0, 16) + '…' : r.nombre,
        facturacion: r.facturacion,
        acumulado_pct: total > 0 ? (cum / total) * 100 : 0,
        clasificacion: r.clasificacion,
      }
    })
  }, [rows, apiData])

  if (error) return (
    <div className="rounded-xl p-6" style={{ background: '#FBEBED', border: '1px solid #F6D0D5' }}>
      <p className="text-error-600 text-sm">Error: {error}</p>
    </div>
  )

  const extraFilters = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: '#6E7290' }}>Estado</label>
        <div className="flex gap-1">
          {['Todos', 'Activo', 'En riesgo', 'Perdido', 'Nuevo'].map(s => (
            <FilterBtn key={s} label={s} active={estadoFiltro === s} color={ESTADO_COLOR[s]} onClick={() => setEstadoFiltro(s)} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: '#6E7290' }}>Clase</label>
        <div className="flex gap-1">
          {['Todos', 'A', 'B', 'C'].map(s => (
            <FilterBtn key={s} label={s} active={abcFiltro === s} color={ABC_COLOR[s]} onClick={() => setAbcFiltro(s)} />
          ))}
        </div>
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
          label="Clientes A / B / C"
          value={loading ? '...' : `${kpis.countA} / ${kpis.countB} / ${kpis.countC}`}
          subLabel={loading ? '' : `${rows.length} total en el período`}
          loading={loading}
        />
        <KPICard
          label="En riesgo o perdidos"
          value={loading ? '...' : kpis.enRiesgo}
          variant={kpis.enRiesgo > 0 ? 'danger' : 'default'}
          loading={loading}
        />
        <KPICard
          label="Clientes nuevos"
          value={loading ? '...' : kpis.nuevos}
          variant={kpis.nuevos > 0 ? 'success' : 'default'}
          loading={loading}
        />
        <KPICard
          label="Concentración top 10"
          value={loading ? '...' : `${kpis.concPct.toFixed(1)}%`}
          subLabel="del total facturado"
          loading={loading}
        />
      </div>

      {/* Pareto chart */}
      {!loading && paretoData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#FFFFFF', border: '1px solid #E3E5EF' }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold" style={{ color: '#545871' }}>
              Curva Pareto — top {paretoData.length} clientes · {ars(kpis.total)} total
            </p>
            {apiData?.meta && (
              <p className="text-xs" style={{ color: '#9295AE' }}>
                vs {apiData.meta.prevFrom} → {apiData.meta.prevTo}
              </p>
            )}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={paretoData} margin={{ left: 10, right: 10, top: 0, bottom: 70 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#6E7290', fontSize: 10 }}
                axisLine={{ stroke: '#E3E5EF' }}
                tickLine={false}
                angle={-45}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`}
                tick={{ fill: '#6E7290', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => [ars(v), 'Facturación']}
                contentStyle={{ background: '#FFFFFF', border: '1px solid #E3E5EF', borderRadius: 8, color: '#1E2030', fontSize: 12 }}
              />
              <Bar dataKey="facturacion" radius={[4, 4, 0, 0]} maxBarSize={24}>
                {paretoData.map((e, i) => (
                  <Cell key={i} fill={ABC_COLOR[e.clasificacion]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-5 mt-1">
            {(['A', 'B', 'C'] as const).map(k => (
              <div key={k} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: ABC_COLOR[k] }} />
                <span className="text-xs" style={{ color: '#6E7290' }}>
                  Clase {k} · {rows.filter(r => r.clasificacion === k).length} clientes
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla */}
      <DataTable
        data={filtered}
        columns={COLUMNS}
        loading={loading}
        exportFilename="ranking_clientes_abc"
        emptyMessage="No hay clientes para el período seleccionado"
        pageSize={30}
      />
    </div>
  )
}
