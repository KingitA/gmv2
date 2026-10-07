'use client'

// Piezas para armar "fichas" (artículo, proveedor, cliente…) con el sistema visual
// Megasur: cabecera con foto/título/acciones, índice de secciones a la izquierda
// (arriba en celular), secciones con título + para qué sirve, y pie con el estado
// de guardado. Maqueta aprobada: docs/rediseno-frontend/maquetas/fichas.html
//
// Uso típico dentro de un Dialog:
//   <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden flex flex-col">
//     <FichaCabecera … />
//     <FichaCuerpo secciones={[{ id, titulo, aviso? }]}>
//       <FichaSeccion id="…" titulo="…" ayuda="…" icono={Tag}>…campos…</FichaSeccion>
//     </FichaCuerpo>
//     <FichaPie …/>

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* ── Cabecera ─────────────────────────────────────────────── */
export function FichaCabecera({
  foto, titulo, meta, acciones, className,
}: { foto?: ReactNode; titulo: ReactNode; meta?: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <header className={cn('grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 border-b px-5 py-4 pr-12 sm:grid-cols-[auto_1fr_auto] sm:px-6', className)}>
      {foto ?? <div />}
      <div className="min-w-0">
        <h2 className="truncate text-xl font-bold leading-tight tracking-tight text-azul-900">{titulo}</h2>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-neutro-500">{meta}</div>}
      </div>
      {acciones && <div className="col-span-2 flex gap-2 sm:col-span-1 [&>*]:flex-1 sm:[&>*]:flex-none">{acciones}</div>}
    </header>
  )
}

/** Dato chico de la cabecera: "SKU 33701" con el valor resaltado. */
export function FichaMeta({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <span>
      {label && <>{label} </>}
      <b className="font-semibold text-azul-900">{children}</b>
    </span>
  )
}

export function FichaEstado({ activo, textoActivo = 'Activo', textoInactivo = 'Inactivo' }: { activo: boolean; textoActivo?: string; textoInactivo?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
      activo ? 'bg-exito-50 text-exito-600' : 'bg-neutro-100 text-neutro-500',
    )}>
      <span className="size-1.5 rounded-full bg-current" />
      {activo ? textoActivo : textoInactivo}
    </span>
  )
}

/* ── Cuerpo con índice ────────────────────────────────────── */
export interface SeccionIndice { id: string; titulo: string; nota?: string; aviso?: boolean }

export function FichaCuerpo({ secciones, children }: { secciones: SeccionIndice[]; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activa, setActiva] = useState(secciones[0]?.id)

  // Resalta en el índice la sección que se está viendo
  useEffect(() => {
    const raiz = scrollRef.current
    if (!raiz) return
    const obs = new IntersectionObserver(
      (entradas) => {
        const visibles = entradas.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visibles[0]) setActiva(visibles[0].target.id.replace(/^ficha-/, ''))
      },
      { root: raiz, rootMargin: '0px 0px -60% 0px', threshold: 0 },
    )
    secciones.forEach(s => { const el = raiz.querySelector(`#ficha-${s.id}`); if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [secciones])

  const ir = (id: string) => {
    setActiva(id)
    scrollRef.current?.querySelector(`#ficha-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[200px_1fr]">
      <nav aria-label="Secciones" className="flex shrink-0 gap-1 overflow-x-auto border-b bg-white p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-3">
        {secciones.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => ir(s.id)}
            className={cn(
              'flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] whitespace-nowrap transition-colors',
              activa === s.id ? 'bg-azul-50 font-semibold text-azul-600' : 'font-medium text-neutro-600 hover:bg-neutro-100',
            )}
          >
            {s.titulo}
            {s.nota && <small className={cn('hidden text-xs md:inline', s.aviso ? 'font-semibold text-alerta-500' : 'text-neutro-400')}>{s.nota}</small>}
          </button>
        ))}
      </nav>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-7">
        {children}
      </div>
    </div>
  )
}

/* ── Sección ──────────────────────────────────────────────── */
export function FichaSeccion({
  id, titulo, ayuda, icono: Icono, aviso, children,
}: { id: string; titulo: string; ayuda?: ReactNode; icono?: ComponentType<{ className?: string }>; aviso?: boolean; children: ReactNode }) {
  return (
    <section id={`ficha-${id}`} className="scroll-mt-2 border-b py-6 last:border-b-0">
      <h3 className="flex items-center gap-2.5 text-base font-bold tracking-tight text-azul-900">
        {Icono && (
          <span className={cn('grid size-7 place-items-center rounded-lg', aviso ? 'bg-alerta-50 text-alerta-500' : 'bg-azul-50 text-azul-600')}>
            <Icono className="size-4" />
          </span>
        )}
        {titulo}
      </h3>
      {ayuda && <p className="mt-1 mb-4 max-w-[62ch] text-[13px] text-neutro-500 md:ml-[38px]">{ayuda}</p>}
      <div className="md:ml-[38px]">{children}</div>
    </section>
  )
}

/** Grilla de campos: 4 columnas en PC, 2 en celular. */
export function Campos({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  return (
    <div className={cn(
      'grid grid-cols-2 gap-x-4 gap-y-4',
      cols === 4 && 'lg:grid-cols-4',
      cols === 3 && 'lg:grid-cols-3',
      className,
    )}>
      {children}
    </div>
  )
}

/** Un campo: etiqueta + aclaración opcional + control. `ancho` = columnas que ocupa. */
export function Campo({
  label, nota, ancho = 1, error, children, className,
}: { label: ReactNode; nota?: ReactNode; ancho?: 1 | 2 | 4; error?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'min-w-0',
      ancho === 2 && 'col-span-2',
      ancho === 4 && 'col-span-2 lg:col-span-4',
      error && '[&_input]:border-alerta-500 [&_button[role=combobox]]:border-alerta-500',
      className,
    )}>
      <div className="mb-1.5 text-[13px] font-semibold leading-tight text-neutro-600">
        {label}
        {nota && <span className="ml-1.5 font-medium text-neutro-400">{nota}</span>}
      </div>
      {children}
    </div>
  )
}

/** Input con unidad a la derecha ($, %, días). */
export function ConUnidad({ unidad, children }: { unidad: string; children: ReactNode }) {
  return (
    <div className="relative [&_input]:pr-10">
      {children}
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm font-semibold text-neutro-400">{unidad}</span>
    </div>
  )
}

/* ── Pie ──────────────────────────────────────────────────── */
export function FichaPie({ mensaje, children }: { mensaje?: ReactNode; children: ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-neutro-50 px-5 py-3 sm:px-6">
      <p className="text-[13px] text-neutro-500">{mensaje}</p>
      <div className="flex flex-1 justify-end gap-2 sm:flex-none [&>*]:flex-1 sm:[&>*]:flex-none">{children}</div>
    </footer>
  )
}
