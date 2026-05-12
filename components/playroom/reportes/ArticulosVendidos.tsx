'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { X, GripVertical, ChevronDown, ChevronUp } from 'lucide-react'
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

interface AdvFilters {
  vendedor_id: string
  tipo_comprobante: string   // '' | 'factura' | 'presupuesto'
  provincia: string
  condicion_iva: string      // '' | substring para ilike
  localidad: string
  zona: string
  con_descuento: string      // '' | 'mercaderia' | 'general' | 'viajante' | 'comercial' | 'financiero' | 'sin_descuento'
  cliente_id: string
}

const ADV_EMPTY: AdvFilters = {
  vendedor_id: '', tipo_comprobante: '', provincia: '',
  condicion_iva: '', localidad: '', zona: '',
  con_descuento: '', cliente_id: '',
}

const ABC_COLOR: Record<string, string> = { A: '#7c3aed', B: '#06b6d4', C: '#6b7280' }

const PROVINCIAS_AR = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
]

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

const sel: React.CSSProperties = {
  background: '#1f2937',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: '4px 10px',
  color: '#fff',
  fontSize: 12,
  outline: 'none',
  colorScheme: 'dark',
}

function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={sel}>
      {children}
    </select>
  )
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.4)' }}>{children}</label>
}

function TextInput({ value, onChange, placeholder, width = 130 }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...sel, width }}
    />
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
  const [advFilters, setAdvFilters] = useState<AdvFilters>(ADV_EMPTY)
  const [showAdv, setShowAdv] = useState(false)

  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Frontend-only filters
  const [abcFiltro, setAbcFiltro] = useState('Todos')
  const [rubroFiltro, setRubroFiltro] = useState('Todos')
  const [proveedorFiltro, setProveedorFiltro] = useState('Todos')
  const [marcaFiltro, setMarcaFiltro] = useState('Todos')
  const [searchText, setSearchText] = useState('')
  const [fuente, setFuente] = useState<'' | 'pedido' | 'comprobante'>('')
  const [sortBy, setSortBy] = useState<'revenue' | 'unidades'>('revenue')

  // Sidebar
  const [selectedArticulo, setSelectedArticulo] = useState<ArticuloRow | null>(null)
  const [clienteDetalle, setClienteDetalle] = useState<{ clientes: ClienteDetalleRow[]; totales: { unidades: number; revenue: number } } | null>(null)
  const [clienteLoading, setClienteLoading] = useState(false)
  const [panelWidth, setPanelWidth] = useState(560)
  const panelRef = useRef<HTMLDivElement>(null)

  // Filter options
  const [vendedores, setVendedores]   = useState<{ id: string; nombre: string }[]>([])
  const [localidades, setLocalidades] = useState<string[]>([])
  const [zonas, setZonas]             = useState<string[]>([])

  useEffect(() => {
    fetch('/api/vendedores').then(r => r.json()).then(d => Array.isArray(d) ? setVendedores(d) : null)
    fetch('/api/playroom/filter-options').then(r => r.json()).then(d => {
      if (d.localidades) setLocalidades(d.localidades)
      if (d.zonas)       setZonas(d.zonas)
    })
  }, [])

  // Resize handle
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const panel = panelRef.current
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(340, window.innerWidth - ev.clientX)
      if (panel) panel.style.width = w + 'px'
    }
    const onUp = (ev: MouseEvent) => {
      const w = Math.max(340, window.innerWidth - ev.clientX)
      if (panel) panel.style.width = w + 'px'
      setPanelWidth(w)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Cargar clientes del artículo seleccionado
  useEffect(() => {
    if (!selectedArticulo) { setClienteDetalle(null); return }
    setClienteLoading(true)
    const params = new URLSearchParams({ articulo_id: selectedArticulo.articulo_id, from: filters.dateFrom, to: filters.dateTo })
    if (fuente) params.set('fuente', fuente)
    fetch(`/api/playroom/articulos-vendidos/clientes?${params}`)
      .then(r => r.json())
      .then(d => setClienteDetalle(d))
      .catch(() => setClienteDetalle(null))
      .finally(() => setClienteLoading(false))
  }, [selectedArticulo])

  const load = useCallback(async (f = filters, adv = advFilters, fuenteVal = fuente) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo, compare: f.comparePeriod })
      if (adv.vendedor_id)    params.set('vendedor_id', adv.vendedor_id)
      if (adv.tipo_comprobante) params.set('tipo_comprobante', adv.tipo_comprobante)
      if (adv.provincia)      params.set('provincia', adv.provincia)
      if (adv.condicion_iva)  params.set('condicion_iva', adv.condicion_iva)
      if (adv.localidad)      params.set('localidad', adv.localidad)
      if (adv.zona)           params.set('zona', adv.zona)
      if (adv.con_descuento)  params.set('con_descuento', adv.con_descuento)
      if (adv.cliente_id)     params.set('cliente_id', adv.cliente_id)
      if (fuenteVal)          params.set('fuente', fuenteVal)
      const res = await fetch(`/api/playroom/articulos-vendidos?${params}`)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setApiData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters, advFilters, fuente])

  useEffect(() => { load() }, [])

  const rows = apiData?.rows ?? []

  // Opciones de filtros frontend derivadas de los datos
  const rubros     = useMemo(() => ['Todos', ...new Set(rows.map(r => r.rubro).filter(r => r !== '—'))], [rows])
  const proveedores = useMemo(() => ['Todos', ...new Set(rows.map(r => r.proveedor).filter(r => r !== '—'))], [rows])
  const marcas     = useMemo(() => ['Todos', ...new Set(rows.map(r => r.marca).filter(r => r !== '—'))], [rows])

  const filtered = useMemo(() => {
    const base = rows.filter(r => {
      if (abcFiltro !== 'Todos' && r.clasificacion !== abcFiltro) return false
      if (rubroFiltro !== 'Todos' && r.rubro !== rubroFiltro) return false
      if (proveedorFiltro !== 'Todos' && r.proveedor !== proveedorFiltro) return false
      if (marcaFiltro !== 'Todos' && r.marca !== marcaFiltro) return false
      if (searchText) {
        const q = searchText.toLowerCase()
        if (!r.descripcion.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false
      }
      return true
    })
    if (sortBy === 'unidades') return [...base].sort((a, b) => b.unidades - a.unidades)
    return base // ya viene ordenado por revenue desde la API
  }, [rows, abcFiltro, rubroFiltro, proveedorFiltro, marcaFiltro, searchText, sortBy])

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
    filtered.slice(0, 15).map(r => ({
      name: r.sku,
      desc: r.descripcion,
      value: sortBy === 'unidades' ? r.unidades : r.revenue,
      clasificacion: r.clasificacion,
    }))
  , [filtered, sortBy])

  // Cantidad de filtros avanzados activos
  const advCount = Object.values(advFilters).filter(Boolean).length

  const resetAdv = () => { setAdvFilters(ADV_EMPTY) }

  if (error) return (
    <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <p className="text-red-400 text-sm">Error: {error}</p>
    </div>
  )

  // ── Fila de filtros básicos (extras del PlayroomFilters) ──────────────────
  const extraFilters = (
    <div className="flex flex-col gap-2 w-full">
      {/* Fila 1: búsqueda + ABC + proveedor + marca */}
      <div className="flex flex-wrap items-center gap-2">
        <TextInput value={searchText} onChange={setSearchText} placeholder="Buscar SKU o descripción…" width={200} />

        <div className="flex items-center gap-1.5">
          <FieldLabel>ABC</FieldLabel>
          <div className="flex gap-1">
            {['Todos', 'A', 'B', 'C'].map(s => (
              <FilterBtn key={s} label={s} active={abcFiltro === s} color={ABC_COLOR[s] ?? '#7c3aed'} onClick={() => setAbcFiltro(s)} />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <FieldLabel>Rubro</FieldLabel>
          <Sel value={rubroFiltro} onChange={setRubroFiltro}>
            {rubros.map(r => <option key={r} value={r}>{r}</option>)}
          </Sel>
        </div>

        <div className="flex items-center gap-1.5">
          <FieldLabel>Proveedor</FieldLabel>
          <Sel value={proveedorFiltro} onChange={setProveedorFiltro}>
            {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
          </Sel>
        </div>

        <div className="flex items-center gap-1.5">
          <FieldLabel>Marca</FieldLabel>
          <Sel value={marcaFiltro} onChange={setMarcaFiltro}>
            {marcas.map(m => <option key={m} value={m}>{m}</option>)}
          </Sel>
        </div>

        {/* Toggle vendida / facturada */}
        <div className="flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '3px' }}>
          {([
            { val: '' as const,            label: 'Vendida',   icon: '🛒' },
            { val: 'comprobante' as const, label: 'Facturada', icon: '🧾' },
          ] as const).map(opt => (
            <button
              key={opt.val}
              onClick={() => { setFuente(opt.val); load(filters, advFilters, opt.val) }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
              style={fuente === opt.val
                ? { background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', color: '#fff', boxShadow: '0 1px 6px rgba(124,58,237,0.4)' }
                : { color: 'rgba(255,255,255,0.35)' }
              }
            >
              <span style={{ fontSize: 11 }}>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Toggle monto / cantidad */}
        <div className="flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '3px' }}>
          {([
            { val: 'revenue' as const,  label: 'Monto',    icon: '$' },
            { val: 'unidades' as const, label: 'Cantidad',  icon: '#' },
          ] as const).map(opt => (
            <button
              key={opt.val}
              onClick={() => setSortBy(opt.val)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
              style={sortBy === opt.val
                ? { background: 'linear-gradient(135deg, #059669, #06b6d4)', color: '#fff', boxShadow: '0 1px 6px rgba(5,150,105,0.4)' }
                : { color: 'rgba(255,255,255,0.35)' }
              }
            >
              <span style={{ fontSize: 11, fontWeight: 700 }}>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Toggle filtros avanzados */}
        <button
          onClick={() => setShowAdv(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ml-auto"
          style={advCount > 0
            ? { background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }
            : { color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }
          }
        >
          {showAdv ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Filtros avanzados
          {advCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: '#7c3aed', color: '#fff' }}>{advCount}</span>}
        </button>
      </div>

      {/* Fila 2: filtros avanzados (backend) */}
      {showAdv && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-3"
          style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.12)' }}
        >
          <div className="flex items-center gap-1.5">
            <FieldLabel>Viajante</FieldLabel>
            <Sel value={advFilters.vendedor_id} onChange={v => setAdvFilters(f => ({ ...f, vendedor_id: v }))}>
              <option value="">Todos</option>
              {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Sel>
          </div>

          <div className="flex items-center gap-1.5">
            <FieldLabel>Comprobante</FieldLabel>
            <Sel value={advFilters.tipo_comprobante} onChange={v => setAdvFilters(f => ({ ...f, tipo_comprobante: v }))}>
              <option value="">Todos</option>
              <option value="factura">Solo facturas (FA/FB/FC)</option>
              <option value="presupuesto">Solo presupuestos (PRES/REV)</option>
            </Sel>
          </div>

          <div className="flex items-center gap-1.5">
            <FieldLabel>Provincia</FieldLabel>
            <Sel value={advFilters.provincia} onChange={v => setAdvFilters(f => ({ ...f, provincia: v }))}>
              <option value="">Todas</option>
              {PROVINCIAS_AR.map(p => <option key={p} value={p}>{p}</option>)}
            </Sel>
          </div>

          <div className="flex items-center gap-1.5">
            <FieldLabel>Tipo cliente</FieldLabel>
            <Sel value={advFilters.condicion_iva} onChange={v => setAdvFilters(f => ({ ...f, condicion_iva: v }))}>
              <option value="">Todos</option>
              <option value="Responsable Inscripto">Resp. Inscripto</option>
              <option value="Monotributo">Monotributo</option>
              <option value="Consumidor Final">Consumidor Final</option>
              <option value="Exento">Exento</option>
            </Sel>
          </div>

          <div className="flex items-center gap-1.5">
            <FieldLabel>Localidad</FieldLabel>
            <Sel value={advFilters.localidad} onChange={v => setAdvFilters(f => ({ ...f, localidad: v }))}>
              <option value="">Todas</option>
              {localidades.map(l => <option key={l} value={l}>{l}</option>)}
            </Sel>
          </div>

          <div className="flex items-center gap-1.5">
            <FieldLabel>Zona</FieldLabel>
            <Sel value={advFilters.zona} onChange={v => setAdvFilters(f => ({ ...f, zona: v }))}>
              <option value="">Todas</option>
              {zonas.map(z => <option key={z} value={z}>{z}</option>)}
            </Sel>
          </div>

          <div className="flex items-center gap-1.5">
            <FieldLabel>Descuento</FieldLabel>
            <Sel value={advFilters.con_descuento} onChange={v => setAdvFilters(f => ({ ...f, con_descuento: v }))}>
              <option value="">Todos</option>
              <option value="mercaderia">Mercadería</option>
              <option value="general">General</option>
              <option value="viajante">Viajante</option>
              <option value="comercial">Comercial</option>
              <option value="financiero">Financiero (contado)</option>
              <option value="sin_descuento">Sin descuento</option>
            </Sel>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {advCount > 0 && (
              <button
                onClick={resetAdv}
                className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Limpiar
              </button>
            )}
            <button
              onClick={() => load(filters, advFilters)}
              className="text-xs px-3 py-1 rounded-lg font-medium transition-colors"
              style={{ background: 'rgba(124,58,237,0.25)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-5">
      <PlayroomFilters
        filters={filters}
        onChange={setFilters}
        onRefresh={() => load(filters, advFilters)}
        loading={loading}
        extras={extraFilters}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Venta neta total" value={loading ? '...' : ars(kpis.totalRevenue)} subLabel={loading ? '' : `${rows.length} SKUs vendidos`} loading={loading} />
        <KPICard label="SKUs con movimiento" value={loading ? '...' : kpis.skusActivos} loading={loading} />
        <KPICard
          label="Margen bruto promedio"
          value={loading ? '...' : kpis.avgMargen !== null ? `${kpis.avgMargen.toFixed(1)}%` : '—'}
          variant={kpis.avgMargen !== null && kpis.avgMargen < 15 ? 'danger' : kpis.avgMargen !== null && kpis.avgMargen < 25 ? 'warning' : 'default'}
          loading={loading}
        />
        <KPICard label="Concentración top 10" value={loading ? '...' : `${kpis.concPct.toFixed(1)}%`} subLabel="del total vendido" loading={loading} />
      </div>

      {/* Chart top 15 */}
      {!loading && chartData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Top {chartData.length} artículos — {sortBy === 'unidades' ? 'por Cantidad vendida' : `Venta neta · ${ars(kpis.totalRevenue)} total`}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 10, right: 10, top: 0, bottom: 60 }}>
              <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} axisLine={{ stroke: 'rgba(255,255,255,0.05)' }} tickLine={false} angle={-45} textAnchor="end" interval={0} />
              <YAxis
                tickFormatter={sortBy === 'unidades' ? (v: number) => v.toLocaleString('es-AR') : (v: number) => `$${(v / 1000000).toFixed(1)}M`}
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 10 }} axisLine={false} tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => sortBy === 'unidades' ? [v.toLocaleString('es-AR'), 'Unidades'] : [ars(v), 'Venta neta']}
                labelFormatter={(_l, p) => p?.[0]?.payload?.desc || _l}
                contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {chartData.map((e, i) => <Cell key={i} fill={ABC_COLOR[e.clasificacion]} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-5 mt-1">
            {(['A', 'B', 'C'] as const).map(k => (
              <div key={k} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: ABC_COLOR[k] }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Clase {k} · {rows.filter(r => r.clasificacion === k).length} SKUs</span>
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

      {/* ── Panel lateral resizable ─────────────────────────────────────────── */}
      {selectedArticulo && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setSelectedArticulo(null)}
        >
          <div
            ref={panelRef}
            className="h-full flex flex-col overflow-hidden relative"
            style={{ width: panelWidth, minWidth: 340, maxWidth: '90vw', background: '#111827', borderLeft: '1px solid rgba(255,255,255,0.08)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle de resize — borde izquierdo */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1.5 z-10 cursor-ew-resize flex items-center justify-center group"
              onMouseDown={handleResizeStart}
              style={{ background: 'transparent' }}
            >
              <div className="w-1 h-10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(124,58,237,0.6)' }} />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>Clientes que compraron</p>
                <p className="text-sm font-semibold text-white">{selectedArticulo.descripcion}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  SKU {selectedArticulo.sku} · {filters.dateFrom} → {filters.dateTo}
                </p>
              </div>
              <button onClick={() => setSelectedArticulo(null)} className="p-1.5 rounded-lg mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Resumen del artículo */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {[
                { label: 'Rubro', v: selectedArticulo.rubro },
                { label: 'Marca', v: selectedArticulo.marca },
                { label: 'Proveedor', v: selectedArticulo.proveedor },
                { label: 'ABC', v: selectedArticulo.clasificacion },
                { label: 'Margen', v: selectedArticulo.margen_bruto_pct !== null ? `${selectedArticulo.margen_bruto_pct.toFixed(1)}%` : '—' },
              ].map(({ label, v }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
                  <p className="text-xs font-medium text-white">{v}</p>
                </div>
              ))}
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

            {/* Tabla de clientes */}
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
                        <th key={h}
                          className={`px-4 py-2.5 ${['Ud.', 'P. Unit.', 'Venta', '%'].includes(h) ? 'text-right' : 'text-left'}`}
                          style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clienteDetalle?.clientes.map((c, i) => (
                      <tr key={c.cliente_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.02)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
                      >
                        <td className="px-4 py-2.5" style={{ color: 'rgba(255,255,255,0.8)', maxWidth: 160 }}>
                          <span className="block truncate" title={c.nombre}>{c.nombre}</span>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{c.localidad}</td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {c.unidades.toLocaleString('es-AR')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: 'rgba(255,255,255,0.6)' }}>
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
