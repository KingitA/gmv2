'use client'

// Informe: preparación de pedidos por empleado del depósito.
// Cuántos pedidos preparó cada uno, cuántos renglones y unidades pickeó, cuánta plata
// preparó y cuánto tarda por pedido. Solo lectura: GET /api/playroom/preparacion.

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Info } from 'lucide-react'
import * as XLSX from 'xlsx'
import KPICard from '@/components/playroom/KPICard'
import DataTable, { type Column } from '@/components/playroom/DataTable'
import PlayroomFilters, { defaultFilters } from '@/components/playroom/PlayroomFilters'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CargaProgreso } from '@/components/ui/carga-progreso'
import type { PlayroomFiltersState } from '@/lib/playroom/types'
import { pesosCorto } from '@/lib/playroom/bloques'
import { fechaCorta, hora, moneda, numero } from '@/lib/formato'

interface PedidoDetalle {
  pedido_id: string
  numero: string | null
  renglones: number
  unidades: number
  monto: number
  minutos: number | null
  desde: string | null
  hasta: string | null
}
interface FilaEmpleado {
  usuario_id: string | null
  nombre: string
  pedidos: number
  renglones: number
  unidades: number
  monto: number
  minutos_promedio: number | null
  minutos_total: number
  renglones_hora: number | null
  detalle: PedidoDetalle[]
}
interface Respuesta {
  filas: FilaEmpleado[]
  total: { pedidos: number; renglones: number; unidades: number; monto: number; empleados: number; minutos_promedio: number | null }
  meta: { from: string; to: string }
}

const num = (n: number) => numero(n, 0, 2)
/** "12 min" / "1 h 05 min" */
function duracion(min: number | null | undefined) {
  if (min == null) return '—'
  if (min < 60) return `${numero(min, 0, 1)} min`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return `${h} h ${String(m).padStart(2, '0')} min`
}
const fechaHora = (iso: string | null) =>
  iso ? `${fechaCorta(iso)} ${hora(iso)}` : '—'

export default function PreparacionDeposito() {
  const [filters, setFilters] = useState<PlayroomFiltersState>(defaultFilters)
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [empleado, setEmpleado] = useState<FilaEmpleado | null>(null)

  const cargar = async (f = filters) => {
    setCargando(true); setError(null)
    try {
      const res = await fetch(`/api/playroom/preparacion?${new URLSearchParams({ from: f.dateFrom, to: f.dateTo })}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`)
      setDatos(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filas = datos?.filas ?? []
  const total = datos?.total
  const grafico = useMemo(() => filas.map(f => ({ nombre: f.nombre, monto: f.monto })), [filas])

  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(filas.map(f => ({
      Empleado: f.nombre, Pedidos: f.pedidos, Renglones: f.renglones, Unidades: f.unidades,
      'Plata preparada': f.monto, 'Min. por pedido': f.minutos_promedio ?? '', 'Renglones por hora': f.renglones_hora ?? '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Preparación')
    XLSX.writeFile(wb, `preparacion_${datos?.meta.from ?? ''}_${datos?.meta.to ?? ''}.xlsx`)
  }

  const columnas: Column<FilaEmpleado>[] = [
    { key: 'nombre', label: 'Empleado', sortable: true, render: v => <span className="font-semibold text-azul-900">{v}</span> },
    { key: 'pedidos', label: 'Pedidos', sortable: true, align: 'right', render: v => num(v) },
    { key: 'renglones', label: 'Renglones', sortable: true, align: 'right', render: v => num(v) },
    { key: 'unidades', label: 'Unidades', sortable: true, align: 'right', render: v => num(v) },
    { key: 'monto', label: 'Plata preparada', sortable: true, align: 'right', render: v => <span className="font-mono font-semibold">{moneda(v, 0)}</span>, exportValue: v => String(v) },
    { key: 'minutos_promedio', label: 'Tiempo por pedido', sortable: true, align: 'right', render: v => duracion(v), exportValue: v => (v == null ? '' : String(v)) },
    { key: 'renglones_hora', label: 'Renglones por hora', sortable: true, align: 'right', render: v => (v == null ? '—' : numero(v, 0, 2)) },
  ]

  return (
    <div className="space-y-5">
      <PlayroomFilters
        filters={filters}
        onChange={f => { setFilters(f); cargar(f) }}
        onRefresh={() => cargar()}
        loading={cargando}
        extras={
          <button type="button" onClick={exportar} disabled={!filas.length}
            className="h-8 rounded-lg border border-neutro-200 bg-white px-3 text-[13px] font-semibold text-azul-600 hover:bg-azul-50 disabled:opacity-50">
            Descargar Excel
          </button>
        }
      />

      {error && <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">No se pudo cargar el informe: {error}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KPICard label="Pedidos preparados" value={total ? num(total.pedidos) : '—'} subLabel={total ? `${total.empleados} empleado${total.empleados === 1 ? '' : 's'}` : undefined} loading={cargando} />
        <KPICard label="Renglones pickeados" value={total ? num(total.renglones) : '—'} loading={cargando} />
        <KPICard label="Unidades" value={total ? num(total.unidades) : '—'} loading={cargando} />
        <KPICard label="Plata preparada" value={total ? pesosCorto(total.monto) : '—'} loading={cargando} />
        <KPICard label="Tiempo promedio por pedido" value={total ? duracion(total.minutos_promedio) : '—'} loading={cargando} />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-neutro-200 bg-white px-4 py-3 text-[13px] text-neutro-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-azul-500" />
        <p>
          Sale de lo que registra la <b className="font-semibold text-azul-900">app del depósito</b>: quién escaneó cada renglón, cuántas unidades y a qué hora.
          El tiempo es el de la sesión de cada uno en el pedido (o del primer al último escaneo, si no la cerró).
          Los pedidos preparados sin la app no aparecen acá.
        </p>
      </div>

      {cargando && !datos ? (
        <CargaProgreso compacto mensajes={['Buscando lo que preparó cada uno…', 'Sumando renglones y unidades…', 'Midiendo tiempos…', 'Ya casi está…']} className="mx-auto max-w-sm py-10" />
      ) : filas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutro-300 bg-white px-6 py-10 text-center">
          <p className="font-semibold text-azul-900">No hay preparaciones registradas en estas fechas</p>
          <p className="mt-1 text-sm text-neutro-500">Probá con un rango más amplio. Los datos aparecen a medida que el depósito prepara con la app.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-neutro-200 bg-white p-4 sm:p-5">
            <h3 className="mb-3 text-[15px] font-bold text-azul-900">Plata preparada por empleado</h3>
            <div style={{ height: Math.max(120, grafico.length * 34 + 16) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grafico} layout="vertical" margin={{ top: 0, right: 80, bottom: 0, left: 0 }}>
                  <XAxis type="number" hide />{/* formato-ok: eje de Recharts */}
                  <YAxis type="category" dataKey="nombre" width={140} tick={{ fill: '#545871', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: '#F0F1F7' }} formatter={(v: any) => [moneda(Number(v), 0), 'Plata preparada']}
                    contentStyle={{ background: '#fff', border: '1px solid #E3E5EF', borderRadius: 8, color: '#1E2030', fontSize: 12 }} />
                  <Bar dataKey="monto" fill="#4549B5" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    <LabelList dataKey="monto" position="right" formatter={(v: any) => pesosCorto(Number(v) || 0)} style={{ fill: '#1E2030', fontSize: 12, fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <DataTable data={filas} columns={columnas} exportFilename="preparacion_deposito" onRowClick={setEmpleado} />
          <p className="-mt-3 text-xs text-neutro-400">Tocá un empleado para ver pedido por pedido.</p>
        </>
      )}

      <Dialog open={!!empleado} onOpenChange={o => { if (!o) setEmpleado(null) }}>
        <DialogContent className="max-w-3xl">
          {empleado && (
            <>
              <DialogHeader>
                <DialogTitle>{empleado.nombre}</DialogTitle>
                <DialogDescription>
                  {num(empleado.pedidos)} pedidos · {num(empleado.renglones)} renglones · {num(empleado.unidades)} unidades · {moneda(empleado.monto, 0)} · {duracion(empleado.minutos_promedio)} por pedido
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto rounded-xl border border-neutro-200">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-neutro-50 text-xs text-neutro-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Pedido</th>
                      <th className="px-3 py-2 text-left font-semibold">Desde</th>
                      <th className="px-3 py-2 text-right font-semibold">Renglones</th>
                      <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                      <th className="px-3 py-2 text-right font-semibold">Plata</th>
                      <th className="px-3 py-2 text-right font-semibold">Tiempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empleado.detalle.map(p => (
                      <tr key={p.pedido_id} className="border-t border-neutro-100">
                        <td className="px-3 py-2 font-semibold text-azul-900">{p.numero ? `Pedido ${p.numero}` : '—'}</td>
                        <td className="px-3 py-2 text-neutro-600">{fechaHora(p.desde)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(p.renglones)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(p.unidades)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{moneda(p.monto, 0)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{duracion(p.minutos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
