'use client'

// Reportes de compras (E-81). Un solo informe con un selector: cada reporte es una consulta
// fija que hace la cuenta en la base (las mismas funciones que usa Jarvis) y acá solo se
// muestra y se exporta. No modifica nada.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import DataTable, { type Column } from '@/components/playroom/DataTable'
import { DateInputAR } from '@/components/ui/date-input-ar'
import { Input } from '@/components/ui/input'
import { formatear, type Formato } from '@/lib/playroom/bloques'
import { fecha as fmtFecha, hoyISO, numeroPlano, sumarDiasISO } from '@/lib/formato'

interface Definicion {
  id: string
  titulo: string
  descripcion: string
  /** filtros que usa este reporte */
  periodo?: boolean
  proveedor?: boolean
  articulo?: 'opcional' | 'obligatorio'
  soloAdmin?: boolean
}

// El orden y los ids son los de lib/jarvis/compras.ts → REPORTES_COMPRAS
const REPORTES: Definicion[] = [
  { id: 'compras_proveedor_mes', titulo: 'Compras por proveedor y mes', descripcion: 'Lo comprado (comprobantes validados), con factura y sin factura por separado', periodo: true, proveedor: true },
  { id: 'costo_articulo', titulo: 'Evolución del costo de un artículo', descripcion: 'Cada cambio de costo y cada compra del artículo, del más nuevo al más viejo', periodo: true, articulo: 'obligatorio' },
  { id: 'deuda_proveedores', titulo: 'Antigüedad de la deuda a proveedores', descripcion: 'Lo que se le debe a cada uno según la cuenta corriente, por antigüedad', proveedor: true },
  { id: 'retenciones', titulo: 'Retenciones por período', descripcion: 'Certificados de retención de Ganancias emitidos', periodo: true, proveedor: true, soloAdmin: true },
  { id: 'oc_pendientes', titulo: 'Órdenes de compra pendientes de recibir', descripcion: 'Qué falta que llegue, de quién y desde cuándo', proveedor: true },
  { id: 'cumplimiento_proveedor', titulo: 'Cumplimiento del proveedor', descripcion: 'Faltantes, sobrantes y diferencias de precio por proveedor', periodo: true, proveedor: true },
  { id: 'notas_esperadas', titulo: 'Notas de crédito y débito esperadas', descripcion: 'Las que el proveedor todavía no mandó, por antigüedad', proveedor: true, articulo: 'opcional' },
]

interface Respuesta {
  titulo: string
  columnas: { clave: string; titulo: string; formato?: Formato }[]
  filas: Record<string, string | number | null>[]
  total?: Record<string, number>
  nota?: string
  error?: string
}

const etiqueta = 'text-[13px] font-semibold text-neutro-600'

export default function ReportesCompras() {
  const hoy = hoyISO()
  const [reporteId, setReporteId] = useState(REPORTES[0].id)
  const [desde, setDesde] = useState(sumarDiasISO(hoy, -364))
  const [hasta, setHasta] = useState(hoy)
  const [proveedor, setProveedor] = useState('')
  const [articulo, setArticulo] = useState('')
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const def = REPORTES.find((r) => r.id === reporteId)!
  const faltaArticulo = def.articulo === 'obligatorio' && !articulo.trim()

  const cargar = useCallback(async () => {
    if (faltaArticulo) { setDatos(null); setError(null); return }
    setCargando(true); setError(null)
    try {
      const q = new URLSearchParams({ reporte: reporteId })
      if (def.periodo) { q.set('desde', desde); q.set('hasta', hasta) }
      if (def.proveedor && proveedor.trim()) q.set('proveedor', proveedor.trim())
      if (def.articulo && articulo.trim()) q.set('articulo', articulo.trim())
      const r = await fetch(`/api/playroom/compras?${q}`)
      const j = (await r.json().catch(() => ({}))) as Respuesta
      if (!r.ok) throw new Error(j?.error || `No se pudo cargar (error ${r.status})`)
      setDatos(j)
    } catch (e: any) {
      setDatos(null)
      setError(e?.message || 'No se pudo cargar')
    } finally {
      setCargando(false)
    }
    // Los filtros de texto se aplican con el botón o Enter, no en cada tecla
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reporteId, desde, hasta])
  useEffect(() => { cargar() }, [cargar])

  const columnas: Column<Record<string, any>>[] = useMemo(() => (datos?.columnas ?? []).map((c) => {
    const numerica = c.formato === 'pesos' || c.formato === 'numero' || c.formato === 'porcentaje'
    return {
      key: c.clave, label: c.titulo, sortable: true, align: numerica ? 'right' as const : 'left' as const,
      render: (v: any) => <span className={numerica ? 'tabular-nums' : undefined}>{formatear(v, c.formato ?? 'texto')}</span>,
      // Excel en castellano: números con coma decimal y sin miles; fechas dd/mm/aaaa
      exportValue: (v: any) => v == null ? '' : numerica && typeof v === 'number' ? (Number.isInteger(v) ? String(v) : numeroPlano(v))
        : c.formato === 'fecha' ? fmtFecha(String(v).slice(0, 10)) : String(v),
    }
  }), [datos])

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-neutro-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1 space-y-1">
            <label className={etiqueta}>Reporte</label>
            <select value={reporteId} onChange={(e) => setReporteId(e.target.value)}
              className="h-10 w-full rounded-lg border border-neutro-300 bg-white px-2 text-sm">
              {REPORTES.map((r) => <option key={r.id} value={r.id}>{r.titulo}{r.soloAdmin ? ' (solo administrador)' : ''}</option>)}
            </select>
          </div>
          {def.periodo && (
            <>
              <div className="space-y-1">
                <label className={etiqueta}>Desde</label>
                <DateInputAR value={desde} onChange={(v) => v && setDesde(v)} className="w-36" />
              </div>
              <div className="space-y-1">
                <label className={etiqueta}>Hasta</label>
                <DateInputAR value={hasta} onChange={(v) => v && setHasta(v)} className="w-36" />
              </div>
            </>
          )}
          {def.proveedor && (
            <div className="space-y-1">
              <label className={etiqueta}>Proveedor (opcional)</label>
              <Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') cargar() }}
                placeholder="Parte del nombre" className="w-52" />
            </div>
          )}
          {def.articulo && (
            <div className="space-y-1">
              <label className={etiqueta}>Artículo{def.articulo === 'opcional' ? ' (opcional)' : ''}</label>
              <Input value={articulo} onChange={(e) => setArticulo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') cargar() }}
                placeholder="Código o descripción" className="w-60" />
            </div>
          )}
          <button onClick={cargar} disabled={cargando || faltaArticulo}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutro-300 bg-white px-3 text-sm font-semibold text-azul-800 hover:bg-neutro-50 disabled:opacity-40">
            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} /> Ver
          </button>
        </div>
        <p className="mt-2 text-[13px] text-neutro-500">{def.descripcion}.</p>
      </div>

      {faltaArticulo && (
        <div className="rounded-xl border border-neutro-200 bg-white px-3 py-6 text-center text-sm text-neutro-600">
          Escribí el código o parte de la descripción del artículo y tocá “Ver”.
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {!faltaArticulo && !error && (
        <>
          {datos?.total && Object.keys(datos.total).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {datos.columnas.filter((c) => datos.total![c.clave] != null).map((c) => (
                <div key={c.clave} className="rounded-xl border border-neutro-200 bg-white px-3 py-2">
                  <div className="text-[13px] font-semibold text-neutro-600">Total {c.titulo.toLowerCase()}</div>
                  <div className="text-lg font-bold tabular-nums text-azul-900">{formatear(datos.total![c.clave], c.formato ?? 'numero')}</div>
                </div>
              ))}
            </div>
          )}
          <DataTable data={datos?.filas ?? []} columns={columnas} loading={cargando && !datos} pageSize={50}
            exportFilename={`compras_${reporteId}`} emptyMessage="No hay datos para estos filtros" />
          {datos?.nota && <p className="text-[13px] text-neutro-500">{datos.nota}</p>}
        </>
      )}
    </div>
  )
}
