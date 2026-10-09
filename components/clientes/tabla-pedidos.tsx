'use client'

// Lista de pedidos de CLIENTES: tabla compacta en PC, tarjetas en celular.
// Solo presentación: recibe los pedidos ya filtrados/ordenados y avisa al padre
// (app/clientes-pedidos/page.tsx) de cada acción. Las filas se pueden arrastrar
// al calendario de viajes (si la fila está seleccionada, arrastra toda la selección).

import type { DragEvent, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Trash2, Truck } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { TIPO_ARRASTRE_PEDIDOS } from '@/components/viajes/calendario-viajes'
import { formatDateAR } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { moneda } from "@/lib/formato"

export type PedidoFila = {
  id: string
  numero_pedido: string
  fecha: string
  estado: string
  prioridad: number | null
  total: number
  bultos?: number | null
  viaje_id: string | null
  /** Día previsto sin viaje (calendario). Si hay viaje, manda la fecha del viaje. */
  fecha_entrega?: string | null
  clientes?: { nombre_razon_social: string; cuit?: string | null; localidad?: string | null } | null
  vendedores?: { nombre: string } | null
  viajes?: { nombre: string; fecha: string } | null
  zona?: { id: string; nombre: string } | null
}

export const PRIORIDAD = {
  1: { label: 'Urgente', punto: 'bg-error-500', texto: 'text-error-600', fondo: 'bg-error-50' },
  2: { label: 'Alta', punto: 'bg-alerta-500', texto: 'text-alerta-600', fondo: 'bg-alerta-50' },
  3: { label: 'Normal', punto: 'bg-neutro-300', texto: 'text-neutro-500', fondo: '' },
} as const

export type Orden = 'prioridad' | 'numero' | 'fecha' | 'cliente' | 'zona' | 'estado' | 'viaje' | 'total'

interface Props {
  pedidos: PedidoFila[]
  seleccion: Set<string>
  onToggle: (id: string) => void
  onToggleTodos: () => void
  onAbrir: (p: PedidoFila) => void
  onPrioridad: (p: PedidoFila, prioridad: 1 | 2 | 3) => void
  onEliminar?: (p: PedidoFila) => void
  puedeEliminar: (estado: string) => boolean
  estadoBadge: (estado: string) => ReactNode
  /** Barra de preparación del depósito, si hay alguien preparando ese pedido. */
  picking?: Record<string, { operario: string; progreso: { total: number; preparados: number; faltantes: number; pendientes: number } }>
  orden: Orden
  dir: 'asc' | 'desc'
  onOrdenar: (o: Orden) => void
  /** Al empezar a arrastrar: ids que se arrastran. */
  onArrastrar: (ids: string[]) => void
  /** Sacarle la fecha de entrega a un pedido sin viaje. */
  onQuitarEntrega?: (p: PedidoFila) => void
}

const diaMes = (f: string) => `${Number(f.slice(8))}/${Number(f.slice(5, 7))}`

export function TablaPedidos(p: Props) {
  const todos = p.pedidos.length > 0 && p.pedidos.every(x => p.seleccion.has(x.id))
  const algunos = !todos && p.pedidos.some(x => p.seleccion.has(x.id))

  const empezarArrastre = (e: DragEvent, pedido: PedidoFila) => {
    const ids = p.seleccion.has(pedido.id) ? p.pedidos.filter(x => p.seleccion.has(x.id)).map(x => x.id) : [pedido.id]
    e.dataTransfer.setData(TIPO_ARRASTRE_PEDIDOS, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
    // Etiqueta que acompaña al cursor
    const etiqueta = document.createElement('div')
    etiqueta.textContent = ids.length === 1 ? `Pedido ${pedido.numero_pedido}` : `${ids.length} pedidos`
    etiqueta.style.cssText = 'position:absolute;top:-100px;padding:6px 10px;border-radius:8px;background:#33378E;color:#fff;font:600 13px Archivo,sans-serif'
    document.body.appendChild(etiqueta)
    e.dataTransfer.setDragImage(etiqueta, 10, 10)
    setTimeout(() => etiqueta.remove(), 0)
    p.onArrastrar(ids)
  }

  const Encabezado = ({ id, children, className }: { id: Orden; children: ReactNode; className?: string }) => (
    <th className={cn('h-10 px-2 text-left text-[12.5px] font-semibold whitespace-nowrap text-neutro-500', className)}>
      <button type="button" onClick={() => p.onOrdenar(id)} className="inline-flex items-center gap-1 hover:text-azul-900">
        {children}
        {p.orden === id ? (p.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-30" />}
      </button>
    </th>
  )

  return (
    <>
      {/* PC: tabla */}
      <div className="hidden overflow-x-auto rounded-xl border bg-white md:block">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          <thead className="border-b bg-neutro-50/70">
            <tr>
              <th className="w-10 pl-3"><Checkbox checked={todos} onCheckedChange={p.onToggleTodos} aria-label={algunos ? "Seleccionar todos (hay algunos marcados)" : "Seleccionar todos"} /></th>
              <th className="w-5" />
              <Encabezado id="prioridad" className="w-[104px]">Prioridad</Encabezado>
              <Encabezado id="numero" className="w-[78px]">N°</Encabezado>
              <Encabezado id="fecha" className="w-[92px]">Fecha</Encabezado>
              <Encabezado id="cliente">Cliente</Encabezado>
              <Encabezado id="zona" className="hidden w-[120px] lg:table-cell">Zona</Encabezado>
                            <Encabezado id="estado" className="w-[112px]">Estado</Encabezado>
              <Encabezado id="viaje" className="w-[140px]">Viaje</Encabezado>
              <Encabezado id="total" className="w-[120px] text-right">Total</Encabezado>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {p.pedidos.map(x => {
              const sel = p.seleccion.has(x.id)
              const pr = PRIORIDAD[(x.prioridad || 3) as 1 | 2 | 3]
              const pk = p.picking?.[x.id]
              return (
                <tr
                  key={x.id}
                  draggable
                  onDragStart={e => empezarArrastre(e, x)}
                  onClick={() => p.onAbrir(x)}
                  className={cn('group cursor-pointer border-b last:border-b-0 transition-colors hover:bg-azul-50/50', sel && 'bg-azul-50/70')}
                >
                  <td className="pl-3" onClick={e => e.stopPropagation()}>
                    <Checkbox checked={sel} onCheckedChange={() => p.onToggle(x.id)} aria-label={`Seleccionar pedido ${x.numero_pedido}`} />
                  </td>
                  <td className="text-neutro-300 group-hover:text-neutro-400" title="Arrastrá al calendario para subirlo a un viaje">
                    <GripVertical className="size-4 cursor-grab" />
                  </td>
                  <td className="px-2 normal-case" onClick={e => e.stopPropagation()}>
                    <select
                      value={x.prioridad || 3}
                      onChange={e => p.onPrioridad(x, Number(e.target.value) as 1 | 2 | 3)}
                      className={cn('h-8 cursor-pointer rounded-md border-0 bg-transparent pr-1 text-[13px] font-semibold outline-none hover:bg-neutro-100 focus:ring-2 focus:ring-ring/50', pr.texto)}
                      aria-label="Prioridad"
                    >
                      <option value={1}>● Urgente</option>
                      <option value={2}>● Alta</option>
                      <option value={3}>○ Normal</option>
                    </select>
                  </td>
                  <td className="px-2 font-semibold tabular-nums text-azul-900">{x.numero_pedido}</td>
                  <td className="px-2 whitespace-nowrap tabular-nums text-neutro-600">{formatDateAR(x.fecha)}</td>
                  <td className="px-2 py-2">
                    <div className="truncate font-semibold uppercase text-azul-900">{x.clientes?.nombre_razon_social || '—'}</div>
                    {(x.clientes?.localidad || x.vendedores?.nombre) && <div className="truncate text-xs uppercase text-neutro-500">{[x.clientes?.localidad, x.vendedores?.nombre].filter(Boolean).join(" · ")}</div>}
                    {pk && (
                      <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-exito-600">
                        <span className="size-1.5 animate-pulse rounded-full bg-exito-500" />Preparando: {pk.operario}
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-neutro-200">
                          <span className="block h-full bg-exito-500" style={{ width: `${pk.progreso.total ? Math.round(((pk.progreso.preparados + pk.progreso.faltantes) / pk.progreso.total) * 100) : 0}%` }} />
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="hidden truncate px-2 text-[13px] uppercase text-neutro-600 lg:table-cell">{x.zona?.nombre || <span className="text-neutro-300">—</span>}</td>
                                    <td className="px-2 normal-case">{p.estadoBadge(x.estado)}</td>
                  <td className="truncate px-2 text-[13px]">
                    {x.viajes?.nombre
                      ? <span className="flex min-w-0 items-center gap-1 font-medium uppercase text-azul-600" title={x.viajes.nombre}><Truck className="size-3.5 shrink-0" /><span className="truncate">{x.viajes.nombre}</span></span>
                      : x.fecha_entrega
                        ? <span className="inline-flex items-center gap-1 rounded-md bg-ambar-50 px-1.5 py-0.5 text-xs font-semibold normal-case text-ambar-800" onClick={e => e.stopPropagation()}>
                            Para el {diaMes(x.fecha_entrega)}
                            {p.onQuitarEntrega && <button type="button" aria-label="Sacar la fecha de entrega" className="text-ambar-600 hover:text-error-500" onClick={() => p.onQuitarEntrega!(x)}>×</button>}
                          </span>
                        : <span className="text-neutro-300">—</span>}
                  </td>
                  <td className="px-2 text-right font-semibold whitespace-nowrap tabular-nums text-azul-900">{x.total > 0 ? moneda(x.total || 0, 0) : '—'}</td>
                  <td className="pr-2 text-right" onClick={e => e.stopPropagation()}>
                    {p.onEliminar && p.puedeEliminar(x.estado) && (
                      <button type="button" onClick={() => p.onEliminar!(x)} aria-label={`Eliminar pedido ${x.numero_pedido}`}
                        className="grid size-8 place-items-center rounded-md text-neutro-300 opacity-0 transition group-hover:opacity-100 hover:bg-error-50 hover:text-error-500 focus:opacity-100">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Celular: tarjetas */}
      <div className="space-y-2 md:hidden">
        {p.pedidos.map(x => {
          const sel = p.seleccion.has(x.id)
          const pr = PRIORIDAD[(x.prioridad || 3) as 1 | 2 | 3]
          return (
            <div key={x.id} onClick={() => p.onAbrir(x)}
              className={cn('flex gap-3 rounded-xl border bg-white p-3 active:bg-azul-50', sel && 'border-azul-300 bg-azul-50/60')}>
              <div onClick={e => e.stopPropagation()} className="pt-0.5">
                <Checkbox checked={sel} onCheckedChange={() => p.onToggle(x.id)} aria-label={`Seleccionar pedido ${x.numero_pedido}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold uppercase text-azul-900">{x.clientes?.nombre_razon_social || '—'}</div>
                    <div className="text-xs text-neutro-500 tabular-nums">
                      N° {x.numero_pedido} · {formatDateAR(x.fecha)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-semibold tabular-nums text-azul-900">{x.total > 0 ? moneda(x.total || 0, 0) : '—'}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  {p.estadoBadge(x.estado)}
                  {(x.prioridad || 3) < 3 && <span className={cn('rounded-full px-2 py-0.5 font-semibold', pr.fondo, pr.texto)}>{pr.label}</span>}
                  {x.zona?.nombre && <span className="rounded-full bg-neutro-100 px-2 py-0.5 uppercase text-neutro-600">{x.zona.nombre}</span>}
                  {x.viajes?.nombre && <span className="inline-flex items-center gap-1 rounded-full bg-azul-50 px-2 py-0.5 font-medium uppercase text-azul-600"><Truck className="size-3" />{x.viajes.nombre}</span>}
                  {!x.viajes?.nombre && x.fecha_entrega && <span className="rounded-full bg-ambar-50 px-2 py-0.5 font-semibold text-ambar-800">Para el {diaMes(x.fecha_entrega)}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
