'use client'

import { useState, useEffect, useMemo } from 'react'
import KPICard from '@/components/playroom/KPICard'
import DataTable from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import { exportLibroIVACSV, exportLibroIVATXTFormatted } from '@/lib/playroom/exporters'
import type { FiscalARCARow } from '@/lib/playroom/exporters'
import type { Column } from '@/components/playroom/DataTable'
import type { PlayroomFiltersState } from '@/lib/playroom/types'

interface FiscalRow {
  id: string
  fecha: string
  tipo_comprobante: string
  tipo_label: string
  tm: string
  punto_venta: string
  numero_comprobante: string
  cliente_nombre: string
  cuit: string
  condicion_iva: string
  ti: string
  provincia: string
  total: number
  total_neto: number
  total_iva: number
  saldo_pendiente: number
  estado_pago: string
  neto1: number
  neto2: number
  iva1: number
  iva2: number
  exento: number
  perciva: number
  percba: number
  percrn: number
  perclp: number
}

interface SummaryItem {
  tipo: string
  label: string
  count: number
  total: number
}

interface ApiResponse {
  rows: FiscalRow[]
  summary: SummaryItem[]
}

const TIPO_COLORS: Record<string, string> = {
  FA: '#7c3aed', FB: '#06b6d4', FC: '#10b981',
  NCA: '#ef4444', NCB: '#f97316', NCC: '#f59e0b',
  PRES: '#6b7280', REV: '#374151',
}

const ESTADO_COLOR: Record<string, string> = {
  saldado: '#10b981',
  parcial: '#f59e0b',
  pendiente: '#ef4444',
}

const PROVINCIAS = [
  { value: '', label: 'Todas' },
  { value: 'ba', label: 'Buenos Aires' },
  { value: 'rn', label: 'Río Negro' },
  { value: 'lp', label: 'La Pampa' },
]

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

const btnBase: React.CSSProperties = {
  borderRadius: 8,
  padding: '5px 12px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  transition: 'opacity 0.15s',
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

const COLUMNS: Column<FiscalRow>[] = [
  {
    key: 'fecha', label: 'Fecha', sortable: true,
    render: v => new Date(v + 'T00:00:00').toLocaleDateString('es-AR'),
    exportValue: v => v,
  },
  {
    key: 'tipo_label', label: 'Tipo', sortable: true,
    render: (v, row) => {
      const color = TIPO_COLORS[row.tipo_comprobante] ?? '#6b7280'
      return (
        <span className="px-2 py-0.5 rounded text-xs font-bold font-mono"
          style={{ background: `${color}20`, color, border: `1px solid ${color}35` }}>
          {v}
        </span>
      )
    },
    exportValue: v => v,
  },
  {
    key: 'numero_comprobante', label: 'Número', sortable: true,
    render: (v, row) => (
      <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
        {row.punto_venta ? `${row.punto_venta}-` : ''}{v}
      </span>
    ),
    exportValue: v => v,
  },
  { key: 'cliente_nombre', label: 'Cliente', sortable: true },
  {
    key: 'cuit', label: 'CUIT', sortable: true,
    render: v => <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{v}</span>,
    exportValue: v => v,
  },
  { key: 'ti', label: 'TI', sortable: true },
  {
    key: 'total_neto', label: 'Neto', sortable: true, align: 'right',
    render: v => <span className="font-mono text-xs">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'total_iva', label: 'IVA', sortable: true, align: 'right',
    render: v => <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'perciva', label: 'Perc.IVA', sortable: true, align: 'right',
    render: v => v !== 0
      ? <span className="font-mono text-xs text-amber-400">{ars(v)}</span>
      : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>,
    exportValue: v => String(v),
  },
  {
    key: 'total', label: 'Total', sortable: true, align: 'right',
    render: v => <span className="font-mono font-semibold">{ars(v)}</span>,
    exportValue: v => String(v),
  },
  {
    key: 'estado_pago', label: 'Estado', sortable: true,
    render: (v: string) => {
      const color = ESTADO_COLOR[v] ?? '#6b7280'
      return (
        <span className="px-2 py-0.5 rounded text-xs font-semibold capitalize"
          style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}>
          {v}
        </span>
      )
    },
    exportValue: v => v,
  },
]

function toARCARow(r: FiscalRow): FiscalARCARow {
  return {
    fecha: r.fecha,
    cliente_nombre: r.cliente_nombre,
    tm: r.tm,
    punto_venta: r.punto_venta,
    numero_comprobante: r.numero_comprobante,
    ti: r.ti,
    cuit: r.cuit,
    exento: r.exento,
    perciva: r.perciva,
    percba: r.percba,
    percrn: r.percrn,
    perclp: r.perclp,
    neto1: r.neto1,
    neto2: r.neto2,
    iva1: r.iva1,
    iva2: r.iva2,
    total: r.total,
  }
}

interface ConciliacionInconsistencia {
  tipo: string
  numero: string
  fecha: string | null
  importe: number | null
  motivo: 'en_arca_no_en_sistema' | 'en_sistema_no_en_arca' | 'sin_cae'
  recuperable_log_id: string | null
}

interface ConciliacionResult {
  ok: boolean
  punto_venta: string
  resumen: Record<string, { ultimo_arca: number; en_sistema: number }>
  inconsistencias: ConciliacionInconsistencia[]
}

const MOTIVO_LABEL: Record<string, string> = {
  en_arca_no_en_sistema: 'existe en ARCA pero no en el sistema',
  en_sistema_no_en_arca: 'existe en el sistema pero ARCA no lo autorizó',
  sin_cae:               'comprobante fiscal sin CAE registrado',
}

export default function ComprobantesFiscal() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tipoFiltro, setTipoFiltro] = useState('Todos')
  const [searchText, setSearchText] = useState('')
  const [soloARCA, setSoloARCA] = useState(false)
  const [provinciaExport, setProvinciaExport] = useState('')
  const [conc, setConc] = useState<ConciliacionResult | null>(null)
  const [concLoading, setConcLoading] = useState(false)
  const [concError, setConcError] = useState<string | null>(null)
  const [reintentando, setReintentando] = useState<string | null>(null)

  const load = async (f = filters) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f.dateFrom, to: f.dateTo })
      if (soloARCA) params.set('solo_arca', 'true')
      const res = await fetch(`/api/playroom/fiscal?${params}`)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setApiData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const conciliar = async () => {
    setConcLoading(true)
    setConcError(null)
    try {
      const res = await fetch('/api/reportes/conciliacion-arca')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setConc(data)
    } catch (e: any) {
      setConcError(e.message)
    } finally {
      setConcLoading(false)
    }
  }

  const reintentarRegistro = async (logId: string, numero: string) => {
    setReintentando(logId)
    try {
      const res = await fetch(`/api/arca/huerfanos/${logId}/reintentar`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      alert(`Comprobante ${numero} registrado correctamente en el sistema (sin tocar ARCA).`)
      conciliar()
      load(filters)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setReintentando(null)
    }
  }

  useEffect(() => { load(); conciliar() }, [])

  const rows = apiData?.rows ?? []
  const summary = apiData?.summary ?? []

  const tiposDisponibles = useMemo(() => ['Todos', ...summary.map(s => s.tipo)], [summary])

  const filtered = useMemo(() => {
    let r = rows
    if (tipoFiltro !== 'Todos') r = r.filter(x => x.tipo_comprobante === tipoFiltro)
    if (searchText) {
      const q = searchText.toLowerCase()
      r = r.filter(x => x.cliente_nombre.toLowerCase().includes(q) || x.cuit.includes(q) || x.numero_comprobante.includes(q))
    }
    return r
  }, [rows, tipoFiltro, searchText])

  // ARCA rows: only FA/FB/FC/NCA/NCB/NCC
  const arcaRows = useMemo(() => {
    const TIPOS_ARCA = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC']
    let r = rows.filter(x => TIPOS_ARCA.includes(x.tipo_comprobante))
    if (provinciaExport) {
      const colMap: Record<string, string> = { ba: 'percba', rn: 'percrn', lp: 'perclp' }
      const col = colMap[provinciaExport]
      if (col) r = r.filter(x => x.provincia?.toLowerCase().includes(
        provinciaExport === 'ba' ? 'buenos aires' :
        provinciaExport === 'rn' ? 'río negro' :
        'la pampa'
      ))
    }
    return r.map(toARCARow)
  }, [rows, provinciaExport])

  const kpis = useMemo(() => {
    const ventas = ['FA', 'FB', 'FC']
    const ncs = ['NCA', 'NCB', 'NCC']
    const totalVentas = summary.filter(s => ventas.includes(s.tipo)).reduce((a, s) => a + s.total, 0)
    const totalNC = summary.filter(s => ncs.includes(s.tipo)).reduce((a, s) => a + s.total, 0)
    const pendiente = rows.filter(r => ventas.includes(r.tipo_comprobante)).reduce((s, r) => s + r.saldo_pendiente, 0)
    return { totalVentas, totalNC, countTotal: rows.length, pendiente }
  }, [summary, rows])

  const periodoLabel = filters.dateFrom.slice(0, 7).replace('-', '_')

  function handleCSV() {
    exportLibroIVACSV(arcaRows, `IVAV_${periodoLabel}${provinciaExport ? '_' + provinciaExport.toUpperCase() : ''}`)
  }

  function handleTXT() {
    const label = provinciaExport.toUpperCase() || 'ALL'
    exportLibroIVATXTFormatted(arcaRows, `IVAV_${periodoLabel}_${label}`)
  }

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
        placeholder="Buscar cliente, CUIT o número…"
        style={{ ...inputStyle, width: 220 }}
      />
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Tipo</label>
        <div className="flex gap-1">
          {tiposDisponibles.map(t => (
            <FilterBtn key={t} label={t} active={tipoFiltro === t}
              color={TIPO_COLORS[t] ?? '#7c3aed'} onClick={() => setTipoFiltro(t)} />
          ))}
        </div>
      </div>
      <button
        onClick={() => { setSoloARCA(v => !v); setTimeout(() => load(filters), 0) }}
        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
        style={soloARCA
          ? { background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)' }
          : { color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }
        }
      >
        Solo ARCA
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      <PlayroomFilters filters={filters} onChange={setFilters} onRefresh={() => load(filters)} loading={loading} extras={extraFilters} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total facturado (FA/B/C)" value={loading ? '...' : ars(kpis.totalVentas)} loading={loading} />
        <KPICard label="Total notas de crédito" value={loading ? '...' : ars(kpis.totalNC)} variant={kpis.totalNC > 0 ? 'warning' : 'default'} loading={loading} />
        <KPICard label="Comprobantes en período" value={loading ? '...' : kpis.countTotal} loading={loading} />
        <KPICard label="Saldo pendiente" value={loading ? '...' : ars(kpis.pendiente)} variant={kpis.pendiente > 0 ? 'danger' : 'default'} loading={loading} />
      </div>

      {/* Summary por tipo */}
      {!loading && summary.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Totales por tipo de comprobante
          </p>
          <div className="flex flex-wrap gap-3">
            {summary.map(s => {
              const color = TIPO_COLORS[s.tipo] ?? '#6b7280'
              return (
                <div key={s.tipo} className="rounded-lg p-3 min-w-[120px]" style={{ background: `${color}0f`, border: `1px solid ${color}25` }}>
                  <div className="text-xs font-bold font-mono mb-1" style={{ color }}>{s.label}</div>
                  <div className="text-sm font-semibold font-mono text-white">{ars(s.total)}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.count} comp.</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Conciliación contra ARCA */}
      <div className="rounded-xl p-5" style={{
        background: concError ? 'rgba(239,68,68,0.06)' : conc && !conc.ok ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.05)',
        border: `1px solid ${concError ? 'rgba(239,68,68,0.25)' : conc && !conc.ok ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.2)'}`,
      }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Conciliación contra ARCA — numeración fiscal PV {conc?.punto_venta ?? '0007'}
          </p>
          <button
            onClick={conciliar}
            disabled={concLoading}
            style={{ ...btnBase, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {concLoading ? 'Conciliando…' : 'Volver a conciliar'}
          </button>
        </div>

        {concLoading && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Consultando ARCA…</p>}
        {concError && <p className="text-xs text-red-400">Error al conciliar: {concError}</p>}

        {conc && !concLoading && conc.ok && (
          <p className="text-sm" style={{ color: '#34d399' }}>
            ✓ Conciliación OK — todos los comprobantes autorizados por ARCA están registrados en el sistema
            ({Object.entries(conc.resumen).map(([t, r]) => `${t}: ${r.ultimo_arca}`).join(' · ')})
          </p>
        )}

        {conc && !concLoading && !conc.ok && (
          <div className="space-y-2">
            {conc.inconsistencias.map((inc, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <p className="text-xs" style={{ color: '#fbbf24' }}>
                  ⚠️ Inconsistencia en {inc.tipo} número {inc.numero}
                  {inc.fecha ? ` con fecha ${inc.fecha}` : ''}
                  {inc.importe != null ? ` por ${ars(Math.abs(inc.importe))}` : ''}
                  {' — '}{MOTIVO_LABEL[inc.motivo]}. Verificar.
                </p>
                {inc.recuperable_log_id && (
                  <button
                    onClick={() => reintentarRegistro(inc.recuperable_log_id!, inc.numero)}
                    disabled={reintentando === inc.recuperable_log_id}
                    style={{ ...btnBase, background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }}
                  >
                    {reintentando === inc.recuperable_log_id ? 'Registrando…' : 'Reintentar registro (sin tocar ARCA)'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Exportación ARCA */}
      <div className="rounded-xl p-5" style={{ background: '#0f172a', border: '1px solid rgba(124,58,237,0.2)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(124,58,237,0.6)' }}>
          Exportar para ARCA / Contador
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Provincia IIBB</label>
            <select
              value={provinciaExport}
              onChange={e => setProvinciaExport(e.target.value)}
              style={{ ...inputStyle, paddingRight: 28 }}
            >
              {PROVINCIAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <button
            onClick={handleCSV}
            disabled={loading || arcaRows.length === 0}
            style={{ ...btnBase, background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.35)' }}
          >
            CSV ARCA{provinciaExport ? ' · ' + provinciaExport.toUpperCase() : ''}
          </button>
          <button
            onClick={handleTXT}
            disabled={loading || arcaRows.length === 0}
            style={{ ...btnBase, background: 'rgba(6,182,212,0.1)', color: '#67e8f9', border: '1px solid rgba(6,182,212,0.25)' }}
          >
            TXT Provincia{provinciaExport ? ' · ' + provinciaExport.toUpperCase() : ''}
          </button>
          {arcaRows.length > 0 && !loading && (
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {arcaRows.length} comprobantes listos para exportar
            </span>
          )}
        </div>

        {/* Formato oficial Libro IVA Digital (RG 4597) — segunda opción hasta
            que el contador defina cuál adopta */}
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Formato oficial ARCA (Libro IVA Digital · RG 4597):
          </span>
          <button
            onClick={() => window.open(`/api/reportes/libro-iva-digital?mes=${filters.dateFrom.slice(5, 7)}&anio=${filters.dateFrom.slice(0, 4)}&archivo=cbte`, '_blank')}
            disabled={loading}
            style={{ ...btnBase, background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}
          >
            Libro IVA Digital · CBTE
          </button>
          <button
            onClick={() => window.open(`/api/reportes/libro-iva-digital?mes=${filters.dateFrom.slice(5, 7)}&anio=${filters.dateFrom.slice(0, 4)}&archivo=alicuotas`, '_blank')}
            disabled={loading}
            style={{ ...btnBase, background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}
          >
            Libro IVA Digital · Alícuotas
          </button>
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={COLUMNS}
        loading={loading}
        exportFilename="comprobantes_fiscal"
        emptyMessage="No hay comprobantes en el período seleccionado"
        pageSize={30}
      />
    </div>
  )
}
