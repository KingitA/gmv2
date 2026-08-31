'use client'

import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import { formatDateAR } from '@/lib/utils'
import type { Column } from '@/components/playroom/DataTable'

interface CCRow {
  cliente_id: string
  nombre: string
  localidad: string
  vendedor_nombre: string
  saldo_libro: number
  pagos_a_cuenta: number
  total_deuda: number
  t0_30: number
  t31_60: number
  t61_90: number
  t90_mas: number
  comprobante_mas_viejo: string | null
  dias_promedio_mora: number
  cantidad_comprobantes: number
}

interface Summary {
  total: number
  total_por_comprobante?: number
  pagos_a_cuenta?: number
  t0_30: number
  t31_60: number
  t61_90: number
  t90_mas: number
}

interface ApiResponse {
  rows: CCRow[]
  summary: Summary
}

const TRAMO_COLORS = {
  t0_30: '#10b981',
  t31_60: '#f59e0b',
  t61_90: '#f97316',
  t90_mas: '#ef4444',
}

const MORA_OPTIONS = [
  { label: 'Todos', value: 0 },
  { label: 'Mora >30d', value: 30 },
  { label: 'Mora >60d', value: 60 },
  { label: 'Mora >90d', value: 90 },
]

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function pct(part: number, total: number) {
  return total > 0 ? ((part / total) * 100).toFixed(1) + '%' : '0%'
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

function FilterBtn({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  const c = color ?? '#7c3aed'
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
      style={active
        ? { background: `${c}25`, color: c, border: `1px solid ${c}45` }
        : { color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }
      }
    >
      {label}
    </button>
  )
}

const COLUMNS: Column<CCRow>[] = [
  { key: 'nombre', label: 'Cliente', sortable: true },
  { key: 'localidad', label: 'Localidad', sortable: true },
  { key: 'vendedor_nombre', label: 'Vendedor', sortable: true },
  {
    key: 't0_30', label: '0–30 d', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-emerald-400">{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 't31_60', label: '31–60 d', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-amber-400">{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 't61_90', label: '61–90 d', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono" style={{ color: '#f97316' }}>{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 't90_mas', label: '+90 d', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-red-400 font-semibold">{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 'total_deuda', label: 'Por comprobante', sortable: true, align: 'right',
    render: v => <span className="font-mono text-white/70">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'pagos_a_cuenta', label: 'A cuenta', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-emerald-400">−{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v ?? 0),
  },
  {
    key: 'saldo_libro', label: 'Debe (libro)', sortable: true, align: 'right',
    render: v => <span className="font-mono font-bold text-white">{ars(v)}</span>,
    exportValue: v => String(v ?? 0),
  },
  {
    key: 'comprobante_mas_viejo', label: 'Comp. más viejo', sortable: true,
    render: v => v ? formatDateAR(v) : '—',
    exportValue: v => v ?? '',
  },
  {
    key: 'dias_promedio_mora', label: 'Días mora prom.', sortable: true, align: 'right',
    render: v => (
      <span className="font-mono" style={{ color: v > 60 ? '#ef4444' : v > 30 ? '#f59e0b' : 'rgba(255,255,255,0.6)' }}>
        {v}d
      </span>
    ),
    exportValue: v => String(v),
  },
  {
    key: 'cantidad_comprobantes', label: '# Comp.', sortable: true, align: 'right',
    render: v => <span className="font-mono">{v}</span>,
  },
]

export default function CuentasCorrientes() {
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [moraMin, setMoraMin] = useState(0)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/playroom/cuentas-corrientes')
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
  const summary = apiData?.summary ?? { total: 0, t0_30: 0, t31_60: 0, t61_90: 0, t90_mas: 0 }

  const filtered = useMemo(() => rows.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (!r.nombre.toLowerCase().includes(q) && !r.vendedor_nombre.toLowerCase().includes(q)) return false
    }
    if (moraMin > 0) {
      const mora = r.t31_60 + r.t61_90 + r.t90_mas
      if (moraMin === 30 && mora <= 0) return false
      if (moraMin === 60 && r.t61_90 + r.t90_mas <= 0) return false
      if (moraMin === 90 && r.t90_mas <= 0) return false
    }
    return true
  }), [rows, search, moraMin])

  const kpis = useMemo(() => {
    const moraTotal = summary.t31_60 + summary.t61_90 + summary.t90_mas
    const baseMora = summary.total_por_comprobante ?? summary.total
    const moraPct = baseMora > 0 ? (moraTotal / baseMora) * 100 : 0
    const dso = filtered.length > 0
      ? Math.round(filtered.reduce((s, r) => s + r.dias_promedio_mora * r.total_deuda, 0) / filtered.reduce((s, r) => s + r.total_deuda, 0) || 0)
      : 0
    return { moraPct, dso }
  }, [summary, filtered])

  const chartData = useMemo(() => {
    return filtered.slice(0, 15).map(r => ({
      name: r.nombre.length > 20 ? r.nombre.slice(0, 18) + '…' : r.nombre,
      t0_30: r.t0_30,
      t31_60: r.t31_60,
      t61_90: r.t61_90,
      t90_mas: r.t90_mas,
    }))
  }, [filtered])

  if (error) return (
    <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <p className="text-red-400 text-sm">Error: {error}</p>
    </div>
  )

  return (
    <div className="space-y-5">

      {/* Filtros */}
      <div
        className="flex flex-wrap items-center gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(17,24,39,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente o vendedor…"
          style={{ ...inputStyle, width: 220 }}
        />

        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Antigüedad</label>
          <div className="flex gap-1">
            {MORA_OPTIONS.map(o => (
              <FilterBtn
                key={o.value}
                label={o.label}
                active={moraMin === o.value}
                color={o.value === 0 ? '#7c3aed' : o.value === 30 ? '#f59e0b' : o.value === 60 ? '#f97316' : '#ef4444'}
                onClick={() => setMoraMin(o.value)}
              />
            ))}
          </div>
        </div>

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
        <KPICard
          label="Total cuentas por cobrar"
          value={loading ? '...' : ars(summary.total)}
          subLabel={loading ? '' : `${rows.length} clientes con saldo${(summary.pagos_a_cuenta ?? 0) > 0.01 ? ` · a cuenta ${ars(summary.pagos_a_cuenta!)}` : ''}`}
          loading={loading}
        />
        <KPICard
          label="% en mora (>30 días)"
          value={loading ? '...' : pct(summary.t31_60 + summary.t61_90 + summary.t90_mas, summary.total_por_comprobante ?? summary.total)}
          subLabel={loading ? '' : ars(summary.t31_60 + summary.t61_90 + summary.t90_mas)}
          variant={kpis.moraPct > 50 ? 'danger' : kpis.moraPct > 20 ? 'warning' : 'default'}
          loading={loading}
        />
        <KPICard
          label="En riesgo (+90 días)"
          value={loading ? '...' : ars(summary.t90_mas)}
          subLabel={loading ? '' : pct(summary.t90_mas, summary.total_por_comprobante ?? summary.total) + ' del total'}
          variant={summary.t90_mas > 0 ? 'danger' : 'default'}
          loading={loading}
        />
        <KPICard
          label="DSO promedio"
          value={loading ? '...' : `${kpis.dso} días`}
          subLabel="días promedio de cobro"
          variant={kpis.dso > 60 ? 'danger' : kpis.dso > 30 ? 'warning' : 'default'}
          loading={loading}
        />
      </div>

      {/* Resumen por tramo */}
      {!loading && (
        <div className="grid grid-cols-4 gap-3">
          {([
            { key: 't0_30', label: '0–30 días', color: TRAMO_COLORS.t0_30 },
            { key: 't31_60', label: '31–60 días', color: TRAMO_COLORS.t31_60 },
            { key: 't61_90', label: '61–90 días', color: TRAMO_COLORS.t61_90 },
            { key: 't90_mas', label: '+90 días', color: TRAMO_COLORS.t90_mas },
          ] as const).map(({ key, label, color }) => {
            const val = summary[key]
            return (
              <div
                key={key}
                className="rounded-xl p-4"
                style={{ background: `${color}0a`, border: `1px solid ${color}25` }}
              >
                <div className="text-lg font-bold font-mono" style={{ color }}>{ars(val)}</div>
                <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</div>
                <div className="text-[10px] mt-0.5" style={{ color: `${color}99` }}>
                  {pct(val, summary.total_por_comprobante ?? summary.total)} del total
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Chart: top 15 clientes stacked */}
      {!loading && chartData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Top {chartData.length} clientes — Antigüedad de saldos
          </p>
          <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
              <XAxis
                type="number"
                tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`}
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number, name: string) => {
                  const labels: Record<string, string> = { t0_30: '0–30 días', t31_60: '31–60 días', t61_90: '61–90 días', t90_mas: '+90 días' }
                  return [ars(v), labels[name] ?? name]
                }}
                contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }}
              />
              <Legend
                formatter={(v: string) => {
                  const labels: Record<string, string> = { t0_30: '0–30 d', t31_60: '31–60 d', t61_90: '61–90 d', t90_mas: '+90 d' }
                  return <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{labels[v] ?? v}</span>
                }}
              />
              <Bar dataKey="t0_30" stackId="a" fill={TRAMO_COLORS.t0_30} fillOpacity={0.85} maxBarSize={20} />
              <Bar dataKey="t31_60" stackId="a" fill={TRAMO_COLORS.t31_60} fillOpacity={0.85} maxBarSize={20} />
              <Bar dataKey="t61_90" stackId="a" fill={TRAMO_COLORS.t61_90} fillOpacity={0.85} maxBarSize={20} />
              <Bar dataKey="t90_mas" stackId="a" fill={TRAMO_COLORS.t90_mas} fillOpacity={0.85} maxBarSize={20} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla */}
      <DataTable
        data={filtered}
        columns={COLUMNS}
        loading={loading}
        exportFilename="cuentas_corrientes"
        emptyMessage="No hay comprobantes con saldo pendiente"
        pageSize={30}
      />
    </div>
  )
}
