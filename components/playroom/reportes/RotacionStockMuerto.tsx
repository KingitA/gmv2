'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import type { Column } from '@/components/playroom/DataTable'

type Sugerencia = 'OK' | 'Devolver' | 'Liquidar'

interface RotacionRow {
  articulo_id: string
  sku: string
  descripcion: string
  proveedor_nombre: string
  marca_nombre: string
  rubro: string
  stock_actual: number
  ultimo_costo: number
  capital_inmovilizado: number
  ultima_venta: string | null
  dias_sin_venta: number | null
  velocidad_90d: number
  dias_stock_proyectados: number | null
  sugerencia: Sugerencia
}

const SUGERENCIA_COLOR: Record<Sugerencia, string> = {
  OK: '#10b981',
  Devolver: '#f59e0b',
  Liquidar: '#ef4444',
}

const DIAS_OPTIONS = [
  { label: 'Todos', value: 0 },
  { label: '+30 días', value: 30 },
  { label: '+60 días', value: 60 },
  { label: '+90 días', value: 90 },
  { label: '+180 días', value: 180 },
  { label: '+365 días', value: 365 },
]

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function fmtDias(n: number | null) {
  if (n === null) return '—'
  if (n >= 9999) return '∞'
  return `${n}d`
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: '6px 12px',
  color: '#fff',
  fontSize: 13,
  outline: 'none',
}

const COLUMNS: Column<RotacionRow>[] = [
  { key: 'sku', label: 'SKU', sortable: true },
  {
    key: 'descripcion', label: 'Descripción', sortable: true,
    render: v => <span className="max-w-[220px] truncate block" title={v}>{v}</span>,
  },
  { key: 'proveedor_nombre', label: 'Proveedor', sortable: true },
  { key: 'rubro', label: 'Rubro', sortable: true },
  {
    key: 'stock_actual', label: 'Stock', sortable: true, align: 'right',
    render: v => <span className="font-mono">{Number(v).toLocaleString('es-AR')}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'ultimo_costo', label: 'Costo unit.', sortable: true, align: 'right',
    render: v => <span className="font-mono">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'capital_inmovilizado', label: 'Capital $', sortable: true, align: 'right',
    render: v => <span className="font-mono font-semibold text-amber-400">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'ultima_venta', label: 'Última venta', sortable: true,
    render: v => v ? new Date(v).toLocaleDateString('es-AR') : <span style={{ color: 'rgba(255,255,255,0.25)' }}>Sin ventas</span>,
    exportValue: v => v ?? '',
  },
  {
    key: 'dias_sin_venta', label: 'Sin venta', sortable: true, align: 'right',
    render: v => <span className="font-mono">{fmtDias(v)}</span>,
    exportValue: v => String(v ?? ''),
  },
  {
    key: 'velocidad_90d', label: 'Vel. 90d u/día', sortable: true, align: 'right',
    render: v => <span className="font-mono">{Number(v).toFixed(2)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'dias_stock_proyectados', label: 'Stock proyect.', sortable: true, align: 'right',
    render: v => <span className="font-mono">{fmtDias(v)}</span>,
    exportValue: v => String(v ?? ''),
  },
  {
    key: 'sugerencia', label: 'Sugerencia', sortable: true,
    render: (v: Sugerencia) => (
      <span
        className="px-2 py-0.5 rounded-md text-xs font-semibold"
        style={{
          background: `${SUGERENCIA_COLOR[v]}18`,
          color: SUGERENCIA_COLOR[v],
          border: `1px solid ${SUGERENCIA_COLOR[v]}35`,
        }}
      >
        {v}
      </span>
    ),
    exportValue: v => v,
  },
]

export default function RotacionStockMuerto() {
  const [data, setData] = useState<RotacionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [diasMin, setDiasMin] = useState(0)
  const [soloConStock, setSoloConStock] = useState(true)
  const [capitalMin, setCapitalMin] = useState(0)
  const [sugerenciaFiltro, setSugerenciaFiltro] = useState<Sugerencia | 'Todas'>('Todas')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/playroom/rotacion')
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => data.filter(r => {
    if (soloConStock && r.stock_actual <= 0) return false
    if (diasMin > 0 && (r.dias_sin_venta ?? 99999) < diasMin) return false
    if (capitalMin > 0 && r.capital_inmovilizado < capitalMin) return false
    if (sugerenciaFiltro !== 'Todas' && r.sugerencia !== sugerenciaFiltro) return false
    return true
  }), [data, soloConStock, diasMin, capitalMin, sugerenciaFiltro])

  const kpis = useMemo(() => {
    const capitalTotal = filtered.reduce((s, r) => s + r.capital_inmovilizado, 0)
    const sin90 = filtered.filter(r => (r.dias_sin_venta ?? 99999) >= 90).length
    const capitalRecuperable = filtered
      .filter(r => r.sugerencia === 'Liquidar')
      .reduce((s, r) => s + r.capital_inmovilizado, 0)

    const rubroMap = new Map<string, number>()
    filtered
      .filter(r => (r.dias_sin_venta ?? 99999) >= 90 && r.stock_actual > 0)
      .forEach(r => rubroMap.set(r.rubro, (rubroMap.get(r.rubro) ?? 0) + r.capital_inmovilizado))
    const topRubro = [...rubroMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

    return { capitalTotal, sin90, capitalRecuperable, topRubro }
  }, [filtered])

  const chartData = useMemo(() =>
    filtered.slice(0, 20).map(r => ({
      name: r.sku,
      desc: r.descripcion,
      capital: r.capital_inmovilizado,
      sug: r.sugerencia,
    }))
  , [filtered])

  if (error) {
    return (
      <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <p className="text-red-400 text-sm">Error cargando datos: {error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Filtros */}
      <div
        className="flex flex-wrap items-center gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(17,24,39,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Días sin venta</label>
          <select value={diasMin} onChange={e => setDiasMin(Number(e.target.value))} style={inputStyle}>
            {DIAS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Capital mín. $</label>
          <input
            type="number"
            value={capitalMin || ''}
            onChange={e => setCapitalMin(Number(e.target.value))}
            placeholder="0"
            style={{ ...inputStyle, width: 100 }}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Sugerencia</label>
          <div className="flex gap-1">
            {(['Todas', 'OK', 'Devolver', 'Liquidar'] as const).map(s => {
              const active = sugerenciaFiltro === s
              const color = s !== 'Todas' ? SUGERENCIA_COLOR[s as Sugerencia] : '#7c3aed'
              return (
                <button
                  key={s}
                  onClick={() => setSugerenciaFiltro(s)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={active
                    ? { background: `${color}25`, color, border: `1px solid ${color}45` }
                    : { color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }
                  }
                >
                  {s}
                </button>
              )
            })}
          </div>
        </div>

        {/* Solo con stock toggle */}
        <label className="flex items-center gap-2 cursor-pointer ml-1">
          <div
            onClick={() => setSoloConStock(s => !s)}
            className="relative cursor-pointer rounded-full transition-colors"
            style={{ width: 36, height: 20, background: soloConStock ? '#7c3aed' : 'rgba(255,255,255,0.1)', flexShrink: 0 }}
          >
            <div
              className="absolute top-0.5 rounded-full bg-white transition-transform"
              style={{ width: 16, height: 16, transform: soloConStock ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </div>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Solo con stock</span>
        </label>

        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
          {loading ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Capital inmovilizado" value={loading ? '...' : ars(kpis.capitalTotal)} variant="warning" loading={loading} />
        <KPICard label="SKUs sin movimiento >90d" value={loading ? '...' : kpis.sin90} variant="danger" loading={loading} />
        <KPICard label="Capital recuperable" value={loading ? '...' : ars(kpis.capitalRecuperable)} subLabel="Sugerencia Liquidar" variant="danger" loading={loading} />
        <KPICard label="Top rubro stock muerto" value={loading ? '...' : kpis.topRubro} loading={loading} />
      </div>

      {/* Chart: top 20 por capital */}
      {!loading && chartData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Top {chartData.length} SKUs — Capital inmovilizado
          </p>
          <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 26)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
              <XAxis
                type="number"
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={64}
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => [ars(v), 'Capital']}
                labelFormatter={(_l, p) => p?.[0]?.payload?.desc || _l}
                contentStyle={{
                  background: '#1f2937',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 12,
                }}
              />
              <Bar dataKey="capital" radius={[0, 4, 4, 0]} maxBarSize={20}>
                {chartData.map((e, i) => (
                  <Cell key={i} fill={SUGERENCIA_COLOR[e.sug]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-5 mt-3">
            {(Object.entries(SUGERENCIA_COLOR) as [Sugerencia, string][]).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: v }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{k}</span>
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
        exportFilename="rotacion_stock_muerto"
        emptyMessage="No hay artículos que coincidan con los filtros"
        pageSize={30}
      />
    </div>
  )
}
