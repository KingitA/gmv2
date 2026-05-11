'use client'

import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { X } from 'lucide-react'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import ComparativoBadge from '@/components/playroom/ComparativoBadge'
import type { Column } from '@/components/playroom/DataTable'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface ArticuloRow {
  articulo_id: string
  sku: string
  descripcion: string
  rubro: string
  marca: string
  proveedor: string
  unidades: number
  unidades_anterior: number
  revenue: number
  revenue_anterior: number
  variacion_pct: number
  costo_total: number
  margen_bruto_pct: number | null
  bonificadas: number
  clasificacion: 'A' | 'B' | 'C'
}

interface ApiResponse {
  rows: ArticuloRow[]
  meta: { dateFrom: string; dateTo: string; prevFrom: string; prevTo: string; totalRevenue: number }
}

interface ClienteDetalleRow {
  cliente_id: string
  nombre: string
  localidad: string
  unidades: number
  revenue: number
  precio_unitario: number
  porcentaje: number
}

const ABC_COLOR: Record<string, string> = { A: '#7c3aed', B: '#06b6d4', C: '#6b7280' }

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

const COLUMNS: Column<ArticuloRow>[] = [
  {
    key: 'clasificacion', label: 'ABC', sortable: true,
    render: (v: 'A' | 'B' | 'C') => <span className="font-bold" style={{ color: ABC_COLOR[v] }}>{v}</span>,
  },
  { key: 'sku', label: 'SKU', sortable: true },
  {
    key: 'descripcion', label: 'Descripción', sortable: true,
    render: v => <span className="max-w-[200px] truncate block" title={v}>{v}</span>,
  },
  { key: 'rubro', label: 'Rubro', sortable: true },
  { key: 'proveedor', label: 'Proveedor', sortable: true },
  {
    key: 'unidades', label: 'Unidades', sortable: true, align: 'right',
    render: v => <span className="font-mono">{Number(v).toLocaleString('es-AR')}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'unidades_anterior', label: 'Ud. ant.', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{v > 0 ? Number(v).toLocaleString('es-AR') : '—'}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'revenue', label: 'Venta neta', sortable: true, align: 'right',
    render: v => <span className="font-mono font-semibold">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'revenue_anterior', label: 'Período ant.', sortable: true, align: 'right',
    render: v => <span className="font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{v > 0 ? ars(v) : '—'}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'variacion_pct', label: 'Var. %', sortable: true, align: 'right',
    render: (v, row) => row.revenue_anterior > 0
      ? <ComparativoBadge pct={v} size="sm" />
      : <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => `${Number(v).toFixed(1)}%`,
  },
  {
    key: 'margen_bruto_pct', label: 'Margen %', sortable: true, align: 'right',
    render: v => v !== null
      ? <span className="font-mono" style={{ color: Number(v) >= 30 ? '#10b981' : Number(v) >= 15 ? '#f59e0b' : '#ef4444' }}>{Number(v).toFixed(1)}%</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => v !== null ? `${Number(v).toFixed(1)}%` : '',
  },
  {
    key: 'bonificadas', label: 'Bonif.', sortable: true, align: 'right',
    render: v => v > 0
      ? <span className="font-mono text-amber-400">{Number(v).toLocaleString('es-AR')}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
]

export default function ArticulosVendidos() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abcFiltro, setAbcFiltro] = useState('Todos')
  const [rubroFiltro, setRubroFiltro] = useState('Todos')
  const [searchText, setSearchText] = useState('')
  const [selectedArticulo, setSelectedArticulo] = useState<ArticuloRow | null>(null)
  const [clienteDetalle, setClienteDetalle] = useState<{ clientes: ClienteDetalleRow[]; totales: { unidades: number; revenue: number } } | null>(null)
  const [clienteLoading, setClienteLoading] = useState(false)

  useEffect(() => {
    if (!selectedArticulo) { setClienteDetalle(null); return }
    setClienteLoading(true)
    const params = new URLSearchParams({ articulo_id: selectedArticulo.articulo_id, from: filters.dateFrom, to: filters.dateTo })
    fetch(`/api/playroom/articulos-vendidos/clientes?${params}`)
      .then(r => r.json())
      .then(d => setClienteDetalle(d))
      .catch(() => setClienteDetalle(null))
      .finally(() => setClienteLoading(false))
  }, [selectedArticulo])

  const load = async (f = filters) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo, compare: f.comparePeriod })
      const res = await fetch(`/api/playroom/articulos-vendidos?${params}`)
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

  const rubros = useMemo(() => ['Todos', ...new Set(rows.map(r => r.rubro).filter(r => r !== '—'))], [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (abcFiltro !== 'Todos' && r.clasificacion !== abcFiltro) return false
    if (rubroFiltro !== 'Todos' && r.rubro !== rubroFiltro) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      if (!r.descripcion.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false
    }
    return true
  }), [rows, abcFiltro, rubroFiltro, searchText])

  const kpis = useMemo(() => {
    const totalRevenue = apiData?.meta.totalRevenue ?? 0
    const skusActivos = rows.filter(r => r.unidades > 0).length
    const avgMargen = filtered.filter(r => r.margen_bruto_pct !== null).length > 0
      ? filtered.reduce((s, r) => s + (r.margen_bruto_pct ?? 0) * r.revenue, 0) / filtered.reduce((s, r) => s + r.revenue, 0)
      : null
    const top10Rev = rows.slice(0, 10).reduce((s, r) => s + r.revenue, 0)
    const concPct = totalRevenue > 0 ? (top10Rev / totalRevenue) * 100 : 0
    return { skusActivos, avgMargen, concPct, totalRevenue }
  }, [rows, filtered, apiData])

  const chartData = useMemo(() =>
    filtered.slice(0, 20).map(r => ({
      name: r.sku,
      desc: r.descripcion,
      revenue: r.revenue,
      clasificacion: r.clasificacion,
    }))
  , [filtered])

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
        placeholder="Buscar SKU o descripción…"
        style={{ ...inputStyle, width: 200 }}
      />
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>ABC</label>
        <div className="flex gap-1">
          {['Todos', 'A', 'B', 'C'].map(s => (
            <FilterBtn key={s} label={s} active={abcFiltro === s} color={ABC_COLOR[s] ?? '#7c3aed'} onClick={() => setAbcFiltro(s)} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Rubro</label>
        <select value={rubroFiltro} onChange={e => setRubroFiltro(e.target.value)} style={inputStyle}>
          {rubros.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
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
          label="Venta neta total"
          value={loading ? '...' : ars(kpis.totalRevenue)}
          subLabel={loading ? '' : `${rows.length} SKUs vendidos`}
          loading={loading}
        />
        <KPICard
          label="SKUs con movimiento"
          value={loading ? '...' : kpis.skusActivos}
          loading={loading}
        />
        <KPICard
          label="Margen bruto promedio"
          value={loading ? '...' : kpis.avgMargen !== null ? `${kpis.avgMargen.toFixed(1)}%` : '—'}
          variant={kpis.avgMargen !== null && kpis.avgMargen < 15 ? 'danger' : kpis.avgMargen !== null && kpis.avgMargen < 25 ? 'warning' : 'default'}
          loading={loading}
        />
        <KPICard
          label="Concentración top 10"
          value={loading ? '...' : `${kpis.concPct.toFixed(1)}%`}
          subLabel="del total vendido"
          loading={loading}
        />
      </div>

      {/* Chart top 20 */}
      {!loading && chartData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Top {chartData.length} artículos — Venta neta · {ars(kpis.totalRevenue)} total
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 10, right: 10, top: 0, bottom: 60 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
                tickLine={false}
                angle={-45}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`}
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => [ars(v), 'Venta neta']}
                labelFormatter={(_l, p) => p?.[0]?.payload?.desc || _l}
                contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }}
              />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {chartData.map((e, i) => (
                  <Cell key={i} fill={ABC_COLOR[e.clasificacion]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-5 mt-1">
            {(['A', 'B', 'C'] as const).map(k => (
              <div key={k} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: ABC_COLOR[k] }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Clase {k} · {rows.filter(r => r.clasificacion === k).length} SKUs
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DataTable
        data={filtered}
        columns={COLUMNS}
        loading={loading}
        exportFilename="articulos_vendidos"
        emptyMessage="No hay artículos vendidos para el período seleccionado"
        pageSize={30}
        onRowClick={row => setSelectedArticulo(row)}
      />

      {/* Cliente detail modal */}
      {selectedArticulo && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSelectedArticulo(null)}
        >
          <div
            className="h-full w-full max-w-lg flex flex-col overflow-hidden"
            style={{ background: '#111827', borderLeft: '1px solid rgba(255,255,255,0.08)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Clientes que compraron
                </p>
                <p className="text-sm font-semibold text-white">{selectedArticulo.descripcion}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  SKU {selectedArticulo.sku} · {filters.dateFrom} → {filters.dateTo}
                </p>
              </div>
              <button onClick={() => setSelectedArticulo(null)} className="p-1.5 rounded-lg mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Totales */}
            {clienteDetalle && !clienteLoading && (
              <div className="flex gap-6 px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Total unidades</p>
                  <p className="text-base font-semibold text-white font-mono">{clienteDetalle.totales.unidades.toLocaleString('es-AR')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Venta neta total</p>
                  <p className="text-base font-semibold text-white font-mono">{ars(clienteDetalle.totales.revenue)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Clientes</p>
                  <p className="text-base font-semibold text-white font-mono">{clienteDetalle.clientes.length}</p>
                </div>
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {clienteLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
                  ))}
                </div>
              ) : clienteDetalle?.clientes.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>Sin datos para el período</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      {['Cliente', 'Localidad', 'Ud.', 'P. Unit.', 'Venta', '%'].map(h => (
                        <th key={h} className={`px-4 py-2.5 ${h === 'Ud.' || h === 'P. Unit.' || h === 'Venta' || h === '%' ? 'text-right' : 'text-left'}`}
                          style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clienteDetalle?.clientes.map((c, i) => (
                      <tr key={c.cliente_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td className="px-4 py-2.5" style={{ color: 'rgba(255,255,255,0.8)', maxWidth: 160 }}>
                          <span className="block truncate" title={c.nombre}>{c.nombre}</span>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{c.localidad}</td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {c.unidades.toLocaleString('es-AR')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                          {c.precio_unitario > 0 ? ars(c.precio_unitario) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold" style={{ color: '#a78bfa' }}>
                          {ars(c.revenue)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.porcentaje)}%`, background: i < 3 ? '#7c3aed' : 'rgba(124,58,237,0.4)' }} />
                            </div>
                            <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.5)', minWidth: 32, textAlign: 'right' }}>
                              {c.porcentaje.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
