'use client'

// Playroom: el lugar para mirar y preguntar sin tocar nada. Tablero de tarjetas
// (catálogo + fijadas desde el chat), Megasur siempre abierto al costado, y los
// informes de siempre. Nada de lo que se haga acá modifica datos del sistema.

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { ArrowLeft, BarChart3, FileSpreadsheet, Lightbulb, Package, Receipt, Users, Wallet, Sparkles, type LucideIcon } from 'lucide-react'
import { useUrlParams } from '@/lib/hooks/use-url-state'
import { cn } from '@/lib/utils'
import { TableroVista, useTablero } from '@/components/playroom/tablero'
import { MegasurPanel, type MegasurPanelRef } from '@/components/playroom/megasur-panel'
import RotacionStockMuerto from '@/components/playroom/reportes/RotacionStockMuerto'
import RankingClientesABC from '@/components/playroom/reportes/RankingClientesABC'
import CuentasCorrientes from '@/components/playroom/reportes/CuentasCorrientes'
import ArticulosVendidos from '@/components/playroom/reportes/ArticulosVendidos'
import ComisionesViajantes from '@/components/playroom/reportes/ComisionesViajantes'
import ComprobantesFiscal from '@/components/playroom/reportes/ComprobantesFiscal'

const INFORMES: { id: string; titulo: string; descripcion: string; icono: LucideIcon; Componente: ComponentType }[] = [
  { id: 'articulos', titulo: 'Artículos vendidos', descripcion: 'Venta neta, márgenes y comparativos', icono: BarChart3, Componente: ArticulosVendidos },
  { id: 'cuentas', titulo: 'Cuentas corrientes', descripcion: 'Antigüedad de saldos, mora y días de cobro', icono: Wallet, Componente: CuentasCorrientes },
  { id: 'clientes-abc', titulo: 'Clientes ABC', descripcion: 'Ranking por facturación y variaciones', icono: Users, Componente: RankingClientesABC },
  { id: 'comisiones', titulo: 'Comisiones', descripcion: 'Devengadas y desempeño por viajante', icono: Receipt, Componente: ComisionesViajantes },
  { id: 'rotacion', titulo: 'Rotación y stock muerto', descripcion: 'Capital inmovilizado y qué liquidar', icono: Package, Componente: RotacionStockMuerto },
  { id: 'fiscal', titulo: 'Fiscal ARCA', descripcion: 'Libro IVA ventas y exportación', icono: FileSpreadsheet, Componente: ComprobantesFiscal },
]

interface Novedad { id: string; tono: 'alerta' | 'atencion' | 'oportunidad'; titulo: string; detalle?: string; acciones?: { texto: string; pregunta: string }[] }

function saludo() {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }))
  return h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

/** Negritas del resumen (**así**) resaltadas */
function conNegritas(t: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <b key={i} className="font-bold text-ambar-200">{p.slice(2, -2)}</b> : p)
}

export default function PlayroomPage() {
  const url = useUrlParams()
  const informeId = url.get('informe', '')
  const informe = INFORMES.find(i => i.id === informeId)
  const tablero = useTablero()
  const chat = useRef<MegasurPanelRef>(null)

  // Partes del cerebro (otra sesión): si todavía no existen, se muestra su lugar reservado
  const [resumen, setResumen] = useState<string | null | undefined>(undefined)
  const [novedades, setNovedades] = useState<Novedad[] | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/playroom/resumen-del-dia').then(r => (r.ok ? r.json() : null)).then(j => setResumen(j?.texto ?? null)).catch(() => setResumen(null))
    fetch('/api/playroom/novedades').then(r => (r.ok ? r.json() : null)).then(j => setNovedades(Array.isArray(j?.items) ? j.items : null)).catch(() => setNovedades(null))
  }, [])

  const preguntar = (t: string) => chat.current?.preguntar(t)
  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' })

  return (
    <div className="mx-auto grid w-full max-w-[1700px] gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <main className="min-w-0 space-y-5">
        {informe ? (
          // ── Un informe abierto ──
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => url.set({ informe: '' }, 'push', { informe: '' })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutro-200 bg-white px-3 py-2 text-sm font-semibold text-azul-600 hover:bg-azul-50">
                <ArrowLeft className="h-4 w-4" />Volver al tablero
              </button>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-azul-900">{informe.titulo}</h1>
                <p className="text-sm text-neutro-500">{informe.descripcion}</p>
              </div>
            </div>
            <informe.Componente />
          </>
        ) : (
          <>
            {/* ── Saludo ── */}
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">{saludo()}</h1>
              <p className="text-sm text-neutro-500">
                <span className="capitalize">{fecha}</span> · Acá se mira y se pregunta: nada de lo que hagas cambia el sistema
              </p>
            </div>

            {/* ── Resumen del día (lo escribe Megasur) ── */}
            {resumen ? (
              <div className="flex items-start gap-3.5 rounded-2xl bg-gradient-to-br from-azul-900 to-azul-600 px-5 py-4 text-white">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 font-extrabold">M</div>
                <div>
                  <p className="text-[15px] leading-relaxed">{conNegritas(resumen)}</p>
                  <p className="mt-1.5 text-xs text-white/60">Resumen escrito por Megasur con los datos de hoy</p>
                </div>
              </div>
            ) : resumen === null ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-azul-200 bg-azul-50/40 px-5 py-3.5">
                <Sparkles className="h-5 w-5 shrink-0 text-azul-400" />
                <p className="text-sm text-neutro-600"><b className="font-semibold text-azul-900">Próximamente:</b> Megasur te va a escribir acá, cada mañana, cómo viene el día en dos o tres líneas.</p>
              </div>
            ) : null}

            {/* ── Tablero ── */}
            <TableroVista t={tablero} onPreguntar={preguntar} />

            {/* ── Lo que Megasur notó ── */}
            <section className="rounded-2xl border border-neutro-200 bg-white p-4 sm:p-5">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold tracking-tight text-azul-900">Lo que Megasur notó</h2>
                <span className="text-xs text-neutro-400">Nunca hace nada sin que vos lo decidas</span>
              </div>
              {novedades && novedades.length > 0 ? (
                <ul className="divide-y divide-neutro-100">
                  {novedades.map(n => (
                    <li key={n.id} className="flex gap-3 py-3">
                      <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg text-sm font-extrabold',
                        n.tono === 'alerta' ? 'bg-alerta-50 text-alerta-600' : n.tono === 'oportunidad' ? 'bg-exito-50 text-exito-600' : 'bg-ambar-50 text-ambar-700')}>
                        {n.tono === 'alerta' ? '!' : n.tono === 'oportunidad' ? '↗' : '$'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-azul-900">{n.titulo}</p>
                        {n.detalle && <p className="text-[13px] text-neutro-600">{n.detalle}</p>}
                        {!!n.acciones?.length && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {n.acciones.map(a => (
                              <button key={a.texto} type="button" onClick={() => preguntar(a.pregunta)}
                                className="rounded-full border border-neutro-200 bg-white px-2.5 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50">{a.texto}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : novedades === undefined ? null : (
                <div className="mt-2 flex items-start gap-3 rounded-xl bg-neutro-50 px-4 py-3">
                  <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-ambar-500" />
                  <p className="text-sm text-neutro-600">
                    <b className="font-semibold text-azul-900">Próximamente:</b> Megasur va a avisarte solo lo que conviene mirar.
                    Por ejemplo, clientes que dejaron de comprar, un margen que bajó con una lista nueva o un artículo que se queda sin stock.
                    Cada aviso va a traer botones para preguntarle más.
                  </p>
                </div>
              )}
            </section>

            {/* ── Informes ── */}
            <section>
              <h2 className="mb-3 text-lg font-bold tracking-tight text-azul-900">Informes</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {INFORMES.map(({ id, titulo, descripcion, icono: Icono }) => (
                  <button key={id} type="button" onClick={() => url.set({ informe: id }, 'push', { informe: '' })}
                    className="flex items-start gap-3 rounded-2xl border border-neutro-200 bg-white p-4 text-left transition-shadow hover:shadow-sm">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-azul-50 text-azul-600"><Icono className="h-5 w-5" /></span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold text-azul-900">{titulo}</span>
                      <span className="block text-[13px] text-neutro-500">{descripcion}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {/* ── Megasur, siempre a mano ── */}
      <MegasurPanel ref={chat} onFijar={tablero.fijar}
        className="h-[620px] xl:sticky xl:top-5 xl:h-[calc(100dvh-8.5rem)]" />
    </div>
  )
}
