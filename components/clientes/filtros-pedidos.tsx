'use client'

// Barra de filtros de la lista de pedidos (CLIENTES). Solo presentación: los
// valores viven en la URL (los maneja app/clientes-pedidos/page.tsx).

import { useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateInputAR } from '@/components/ui/date-input-ar'
import { cn } from '@/lib/utils'

export type Filtros = {
  q: string
  estados: string[]          // vacío = todos
  vendedor: string           // '' = todos
  zona: string
  prioridad: string          // '', '1', '2', '3'
  viaje: string              // '', 'con', 'sin'
  desde: string              // '' = sin límite
  hasta: string
}

/** Estados que se ofrecen como botones rápidos (el resto con "Todos"). */
export const ESTADOS_RAPIDOS: { value: string; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'impreso', label: 'Impreso' },
  { value: 'en_preparacion', label: 'En preparación' },
  { value: 'facturado', label: 'Facturado' },
  { value: 'en_viaje', label: 'En viaje' },
  { value: 'entregado', label: 'Entregado' },
  { value: 'en_venta', label: 'En venta' },
  { value: 'pendiente_facturacion', label: 'Pend. facturación' },
  { value: 'listo_para_retirar', label: 'Listo para retirar' },
  { value: 'listo_para_enviar', label: 'Listo para enviar' },
  { value: 'rechazado', label: 'Rechazado' },
  { value: 'eliminado', label: 'Eliminado' },
]

interface Props {
  f: Filtros
  set: (cambios: Partial<Filtros>) => void
  vendedores: { id: string; nombre: string }[]
  zonas: { id: string; nombre: string }[]
  hayFiltrosExtra: boolean
  onLimpiar: () => void
}

export function FiltrosPedidos({ f, set, vendedores, zonas, hayFiltrosExtra, onLimpiar }: Props) {
  const [abiertoMovil, setAbiertoMovil] = useState(false)
  const toggleEstado = (v: string) =>
    set({ estados: f.estados.includes(v) ? f.estados.filter(x => x !== v) : [...f.estados, v] })

  return (
    <div className="space-y-3 rounded-xl border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutro-400" />
          <Input value={f.q} onChange={e => set({ q: e.target.value })} placeholder="Buscar por número, cliente o CUIT" className="pl-9" />
        </div>
        <button type="button" onClick={() => setAbiertoMovil(v => !v)}
          className={cn('inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold md:hidden', hayFiltrosExtra && 'border-azul-300 bg-azul-50 text-azul-600')}>
          <SlidersHorizontal className="size-4" />Filtros
        </button>
        <div className={cn('w-full flex-wrap items-center gap-2 md:flex md:w-auto', abiertoMovil ? 'grid grid-cols-2' : 'hidden')}>
          <Select value={f.vendedor || 'todos'} onValueChange={v => set({ vendedor: v === 'todos' ? '' : v })}>
            <SelectTrigger className="md:w-44"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los vendedores</SelectItem>
              {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={f.zona || 'todas'} onValueChange={v => set({ zona: v === 'todas' ? '' : v })}>
            <SelectTrigger className="md:w-40"><SelectValue placeholder="Zona" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las zonas</SelectItem>
              {zonas.map(z => <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={f.prioridad || 'todas'} onValueChange={v => set({ prioridad: v === 'todas' ? '' : v })}>
            <SelectTrigger className="md:w-36"><SelectValue placeholder="Prioridad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Toda prioridad</SelectItem>
              <SelectItem value="1">Urgente</SelectItem>
              <SelectItem value="2">Alta</SelectItem>
              <SelectItem value="3">Normal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={f.viaje || 'todos'} onValueChange={v => set({ viaje: v === 'todos' ? '' : v })}>
            <SelectTrigger className="md:w-36"><SelectValue placeholder="Viaje" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Con o sin viaje</SelectItem>
              <SelectItem value="sin">Sin viaje</SelectItem>
              <SelectItem value="con">Con viaje</SelectItem>
            </SelectContent>
          </Select>
          <div className="col-span-2 flex items-center gap-2 md:col-span-1">
            <span className="text-[13px] font-medium text-neutro-500">Desde</span>
            {/* Mientras se escribe la fecha llega vacía: solo se aplica una fecha completa.
                Para sacar el límite, la ✕. */}
            <div className="w-[130px]"><DateInputAR value={f.desde} onChange={v => { if (v) set({ desde: v }) }} /></div>
            {f.desde && <button type="button" aria-label="Sin fecha desde" title="Sin límite de fecha" className="-ml-1 text-neutro-400 hover:text-error-500" onClick={() => set({ desde: '' })}><X className="size-4" /></button>}
            <span className="text-[13px] font-medium text-neutro-500">hasta</span>
            <div className="w-[130px]"><DateInputAR value={f.hasta} onChange={v => { if (v) set({ hasta: v }) }} /></div>
            {f.hasta && <button type="button" aria-label="Sin fecha hasta" className="-ml-1 text-neutro-400 hover:text-error-500" onClick={() => set({ hasta: '' })}><X className="size-4" /></button>}
          </div>
          {hayFiltrosExtra && (
            <button type="button" onClick={onLimpiar} className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-azul-600 hover:bg-azul-50">
              <X className="size-4" />Limpiar filtros
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Estados">
        <button type="button" onClick={() => set({ estados: [] })}
          className={cn('rounded-full border px-3 py-1 text-[13px] font-medium transition-colors', f.estados.length === 0 ? 'border-azul-600 bg-azul-600 text-white' : 'text-neutro-600 hover:bg-neutro-100')}>
          Todos
        </button>
        {ESTADOS_RAPIDOS.map(e => {
          const on = f.estados.includes(e.value)
          return (
            <button key={e.value} type="button" aria-pressed={on} onClick={() => toggleEstado(e.value)}
              className={cn('rounded-full border px-3 py-1 text-[13px] font-medium transition-colors', on ? 'border-azul-600 bg-azul-50 text-azul-700' : 'text-neutro-600 hover:bg-neutro-100')}>
              {e.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
