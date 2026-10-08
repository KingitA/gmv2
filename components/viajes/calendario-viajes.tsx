'use client'

// Calendario de viajes (semana o mes), compartido por la pantalla Viajes y CLIENTES.
// - Click en un viaje → su hoja de ruta.
// - Arrastrar un viaje a otro día → cambia la fecha (solo si todavía no salió).
// - "+" en un día → programar viaje ese día.
// - Soltar PEDIDOS (arrastrados desde la lista de CLIENTES) sobre un viaje o un día.
// Extraído de app/viajes/page.tsx: mismo comportamiento que tenía ahí.

import { useMemo, useState, type DragEvent } from 'react'
import { Plus } from 'lucide-react'
import { ESTADO_VIAJE_COLOR } from '@/lib/viajes/estados'
import { quienLleva, sumarDias, viajeMovible, type ViajeCal } from '@/lib/viajes/use-viajes-rango'
import { cn } from '@/lib/utils'

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
/** Tipo de dato del arrastre de pedidos (lo pone la lista de pedidos). */
export const TIPO_ARRASTRE_PEDIDOS = 'application/x-gm-pedidos'

interface Props {
  /** Celdas en orden lunes→domingo; null = día de relleno de otro mes. */
  celdas: (string | null)[]
  viajes: ViajeCal[]
  hoy: string
  /** Semana: celdas más altas y con más detalle. */
  modo: 'semana' | 'mes'
  onAbrirViaje: (id: string) => void
  onProgramar: (dia: string) => void
  onMoverViaje: (id: string, nuevaFecha: string) => void
  /** Si se pasan, el calendario acepta pedidos arrastrados. */
  onSoltarPedidosEnViaje?: (viaje: ViajeCal) => void
  onSoltarPedidosEnDia?: (dia: string) => void
  /** Pedidos con fecha de entrega y sin viaje, por día (CLIENTES). */
  sueltos?: Map<string, PedidoSuelto[]>
  onAbrirSuelto?: (id: string) => void
  onQuitarSuelto?: (id: string) => void
  /** Al empezar a arrastrar un suelto (para subirlo a un viaje o moverlo de día). */
  onArrastrarSuelto?: (id: string) => void
}

export type PedidoSuelto = { id: string; cliente: string; zona: string | null }

function ChipSuelto({ s, onAbrir, onQuitar, onArrastrar }: { s: PedidoSuelto; onAbrir?: () => void; onQuitar?: () => void; onArrastrar?: () => void }) {
  return (
    <div
      draggable={!!onArrastrar}
      onDragStart={(e) => { e.dataTransfer.setData(TIPO_ARRASTRE_PEDIDOS, JSON.stringify([s.id])); e.dataTransfer.effectAllowed = 'move'; onArrastrar?.() }}
      className="group/suelto flex w-full items-start gap-1 rounded-lg border border-dashed border-ambar-400 bg-ambar-50/70 px-2 py-1 text-left hover:bg-ambar-50"
      title="Pedido sin viaje para este día: tocá para abrirlo, arrastralo a un viaje o a otro día"
    >
      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[11px] font-semibold uppercase text-ambar-900">{s.cliente}</span>
        {s.zona && <span className="block truncate text-[10px] uppercase text-ambar-700/80">{s.zona}</span>}
      </button>
      {onQuitar && (
        <button type="button" onClick={onQuitar} aria-label={`Sacar a ${s.cliente} de este día`}
          className="shrink-0 rounded px-0.5 text-[13px] leading-none text-ambar-600 hover:bg-ambar-100 hover:text-error-500">×</button>
      )}
    </div>
  )
}

export function CalendarioViajes(p: Props) {
  const aceptaPedidos = !!(p.onSoltarPedidosEnViaje || p.onSoltarPedidosEnDia)

  // Un viaje de N días aparece en cada uno de sus días (con "día i/N")
  const porDia = useMemo(() => {
    const m = new Map<string, Array<ViajeCal & { dia_n: number }>>()
    for (const v of p.viajes) {
      const inicio = String(v.fecha).slice(0, 10)
      const n = Math.max(1, Number(v.dias) || 1)
      for (let i = 0; i < n; i++) {
        const k = sumarDias(inicio, i)
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push({ ...v, dia_n: i + 1 })
      }
    }
    return m
  }, [p.viajes])

  // Arrastre de un VIAJE (cambiar fecha)
  const [viajeArr, setViajeArr] = useState<string | null>(null)
  const [desfase, setDesfase] = useState(0)
  // Dónde está el cursor mientras se arrastra algo: un día o un viaje
  const [sobreDia, setSobreDia] = useState<string | null>(null)
  const [sobreViaje, setSobreViaje] = useState<string | null>(null)

  const esPedidos = (e: DragEvent) => aceptaPedidos && e.dataTransfer.types.includes(TIPO_ARRASTRE_PEDIDOS)

  const limpiar = () => { setViajeArr(null); setSobreDia(null); setSobreViaje(null) }

  // Celular: agenda vertical (un día por fila). En el mes, solo los días con viajes y hoy.
  const diasAgenda = (p.celdas.filter(Boolean) as string[])
    .filter(d => p.modo === 'semana' || d === p.hoy || (porDia.get(d)?.length ?? 0) > 0 || (p.sueltos?.get(d)?.length ?? 0) > 0)
  const nombreDia = (d: string) => DIAS_SEMANA[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]

  return (
    <>
    <div className="divide-y overflow-hidden rounded-xl border bg-white md:hidden">
      {diasAgenda.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutro-500">No hay viajes este mes.</p>}
      {diasAgenda.map(d => {
        const vs = porDia.get(d) || []
        return (
          <div key={d} className={cn('flex gap-3 px-3 py-2.5', d === p.hoy && 'bg-azul-50/50')}>
            <div className="w-11 shrink-0 text-center">
              <div className="text-[11px] font-semibold text-neutro-500">{nombreDia(d)}</div>
              <div className={cn('mx-auto grid size-7 place-items-center rounded-full text-sm font-bold', d === p.hoy ? 'bg-azul-600 text-white' : 'text-azul-900')}>{Number(d.slice(8))}</div>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {vs.length === 0 && !(p.sueltos?.get(d)?.length) && <div className="pt-1.5 text-[13px] text-neutro-400">Sin viajes</div>}
              {(p.sueltos?.get(d) || []).map(x => <ChipSuelto key={x.id} s={x} onAbrir={() => p.onAbrirSuelto?.(x.id)} onQuitar={p.onQuitarSuelto ? () => p.onQuitarSuelto!(x.id) : undefined} />)}
              {vs.map(v => (
                <button key={`${v.id}-${v.dia_n}`} type="button" onClick={() => p.onAbrirViaje(v.id)}
                  className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left active:bg-azul-50">
                  <span className={cn('size-2 shrink-0 rounded-full', ESTADO_VIAJE_COLOR[v.estado] || 'bg-neutro-400')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-azul-900">{v.zonas.map(z => z.nombre).join(' + ') || v.nombre}{v.dias > 1 && <span className="ml-1 font-normal text-neutro-400">{v.dia_n}/{v.dias}</span>}</span>
                    <span className="block truncate text-xs text-neutro-500">{quienLleva(v)}{v.pedidos_count > 0 && ` · ${v.pedidos_count} ped. · ${v.bultos} bultos`}</span>
                  </span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => p.onProgramar(d)} aria-label={`Programar viaje el ${d}`}
              className="grid size-8 shrink-0 place-items-center self-start rounded-md text-neutro-400 active:bg-neutro-100">
              <Plus className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
    <div className="hidden overflow-hidden rounded-xl border bg-white md:block">
      <div className="grid grid-cols-7 border-b bg-neutro-50 text-xs font-semibold text-neutro-500">
        {DIAS_SEMANA.map(d => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {p.celdas.map((dia, i) => {
          const viajesDia = dia ? porDia.get(dia) || [] : []
          const resaltado = !!dia && sobreDia === dia && !sobreViaje
          return (
            <div
              key={dia ?? `x${i}`}
              className={cn(
                'group relative border-r border-b p-1.5 transition-colors [&:nth-child(7n)]:border-r-0',
                p.modo === 'semana' ? 'min-h-36' : 'min-h-24 sm:min-h-28',
                !dia && 'bg-neutro-50/60',
                dia === p.hoy && 'bg-azul-50/50',
                resaltado && 'bg-ambar-50 ring-2 ring-inset ring-ambar-400',
              )}
              onDragOver={e => {
                if (!dia) return
                if (viajeArr || esPedidos(e)) { e.preventDefault(); if (sobreDia !== dia) setSobreDia(dia) }
              }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node) && sobreDia === dia) setSobreDia(null) }}
              onDrop={e => {
                if (!dia) return
                e.preventDefault()
                if (viajeArr) p.onMoverViaje(viajeArr, sumarDias(dia, -desfase))
                else if (esPedidos(e) && !sobreViaje) p.onSoltarPedidosEnDia?.(dia)
                limpiar()
              }}
            >
              {dia && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn('grid size-6 place-items-center rounded-full text-xs font-semibold', dia === p.hoy ? 'bg-azul-600 text-white' : 'text-neutro-500')}>
                      {Number(dia.slice(8))}
                    </span>
                    <button
                      type="button"
                      onClick={() => p.onProgramar(dia)}
                      className="grid size-6 place-items-center rounded-md text-neutro-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutro-100 hover:text-azul-600 focus:opacity-100 max-md:opacity-100"
                      title="Programar viaje este día"
                      aria-label={`Programar viaje el ${dia}`}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {viajesDia.map(v => {
                      const movible = viajeMovible(v.estado)
                      const sobreEste = sobreViaje === v.id
                      return (
                        <button
                          key={`${v.id}-${v.dia_n}`}
                          type="button"
                          onClick={() => p.onAbrirViaje(v.id)}
                          draggable={movible}
                          onDragStart={e => { setViajeArr(v.id); setDesfase(v.dia_n - 1); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={limpiar}
                          onDragOver={e => {
                            if (esPedidos(e) && p.onSoltarPedidosEnViaje) { e.preventDefault(); e.stopPropagation(); setSobreViaje(v.id); setSobreDia(dia) }
                          }}
                          onDragLeave={() => { if (sobreViaje === v.id) setSobreViaje(null) }}
                          onDrop={e => {
                            if (esPedidos(e) && p.onSoltarPedidosEnViaje) { e.preventDefault(); e.stopPropagation(); p.onSoltarPedidosEnViaje(v); limpiar() }
                          }}
                          title={movible ? 'Arrastrá a otro día para cambiar la fecha' : undefined}
                          className={cn(
                            'w-full rounded-lg border bg-white px-2 py-1.5 text-left shadow-xs transition hover:border-azul-200 hover:bg-azul-50/40',
                            movible && 'cursor-grab active:cursor-grabbing',
                            viajeArr === v.id && 'opacity-40',
                            sobreEste && 'border-cian-500 bg-cian-50 ring-2 ring-cian-500',
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={cn('size-2 shrink-0 rounded-full', ESTADO_VIAJE_COLOR[v.estado] || 'bg-neutro-400')} />
                            <span className="truncate text-xs font-semibold text-azul-900">
                              {v.zonas.map(z => z.nombre).join(' + ') || v.nombre}
                            </span>
                            {v.dias > 1 && <span className="shrink-0 text-[11px] text-neutro-400">{v.dia_n}/{v.dias}</span>}
                          </div>
                          <div className="truncate text-[11px] text-neutro-500">
                            {quienLleva(v)}
                          </div>
                          {p.modo === 'semana' && v.pedidos_count > 0 && (
                            <div className="mt-0.5 text-[11px] font-medium text-neutro-600 tabular-nums">
                              {v.pedidos_count} ped. · {v.bultos} bultos
                            </div>
                          )}
                          {sobreEste && <div className="mt-1 text-[11px] font-semibold text-cian-700">Soltá para subirlos</div>}
                        </button>
                      )
                    })}
                    {(p.sueltos?.get(dia) || []).map(x => <ChipSuelto key={x.id} s={x} onAbrir={() => p.onAbrirSuelto?.(x.id)} onQuitar={p.onQuitarSuelto ? () => p.onQuitarSuelto!(x.id) : undefined} onArrastrar={p.onArrastrarSuelto ? () => p.onArrastrarSuelto!(x.id) : undefined} />)}
                    {resaltado && aceptaPedidos && !viajeArr && (
                      <div className="rounded-md border border-dashed border-ambar-400 px-2 py-1 text-[11px] font-medium text-ambar-800">
                        Soltá para dejarlos este día
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
    </>
  )
}

/** Celdas de la semana (lunes→domingo) que contiene `fecha`. */
export function celdasSemana(fecha: string): string[] {
  const d = new Date(fecha + 'T00:00:00Z')
  const lunes = sumarDias(fecha, -((d.getUTCDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
}

/** Celdas del mes (con relleno null para completar semanas). */
export function celdasMes(anio: number, mes: number): (string | null)[] {
  const iso = (d: number) => `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const primero = new Date(anio, mes, 1)
  const offset = (primero.getDay() + 6) % 7
  const dias = new Date(anio, mes + 1, 0).getDate()
  const out: (string | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= dias; d++) out.push(iso(d))
  while (out.length % 7) out.push(null)
  return out
}
