import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router"
import { decidirAtras, indiceHistorial } from "../nav/atras"
import { useContadoresOutbox, useMetaDataset, useOnline, useRuntime } from "../react/contexto"
import { fechaHoraCorta, hace } from "./formato"

// UI base de las 3 apps. Pensada para el NuStar 65-sp: 720×1600 @ xhdpi
// (360×800 dp), dedo con guante, sol. Alto contraste, objetivos táctiles ≥ 44 px,
// sin animaciones pesadas.

/**
 * Encabezado de pantalla: atrás + título + red + contador de pendientes (siempre visible).
 * `compacto`: 44 px en vez de 56 (el botón atrás sigue midiendo 44). Lo usa depósito, donde
 * cada píxel de alto es una línea más de descripción de artículo en pantalla.
 */
export function Encabezado({ titulo, atras = true, derecha, compacto = false }: { titulo: string; atras?: boolean; derecha?: ReactNode; compacto?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const volver = () => {
    const d = decidirAtras(location.pathname, indiceHistorial())
    if (d.accion === "back") navigate(-1)
    else if (d.accion === "padre") navigate(d.a, { replace: true })
  }
  return (
    <header className={`sticky top-0 z-20 flex items-center gap-1 bg-barra px-2 text-white shadow ${compacto ? "h-11" : "h-14"}`}>
      {atras && (
        <button onClick={volver} aria-label="Atrás" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-white/20">
          <svg viewBox="0 0 24 24" className={compacto ? "h-5 w-5" : "h-6 w-6"} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      <h1 className={`min-w-0 flex-1 truncate px-1 font-semibold ${compacto ? "text-base" : "text-lg"}`}>{titulo}</h1>
      {derecha}
      <IndicadorRed />
      <IndicadorPendientes />
    </header>
  )
}

export function IndicadorRed() {
  const online = useOnline()
  return (
    <span
      className={`mr-1 rounded-full px-2 py-0.5 text-xs font-semibold ${online ? "bg-en-linea text-en-linea-texto" : "bg-sin-red text-sin-red-texto"}`}
      aria-live="polite"
    >
      {online ? "En línea" : "Sin red"}
    </span>
  )
}

/** Contador de operaciones sin enviar. Toca → pantalla de pendientes (/pendientes). */
export function IndicadorPendientes() {
  const c = useContadoresOutbox()
  const navigate = useNavigate()
  const hay = c.pendientes + c.rechazados
  return (
    <button
      onClick={() => navigate("/pendientes")}
      aria-label={`${c.pendientes} pendientes de enviar, ${c.rechazados} rechazadas`}
      className={`flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2 text-sm font-bold ${
        c.rechazados ? "bg-red-600" : c.pendientes ? "bg-en-cola text-en-cola-texto" : "bg-white/15"
      }`}
    >
      {c.enviando && c.pendientes > 0 ? "↻" : "⇪"} {hay}
    </button>
  )
}

/**
 * Frescura del dato mostrado desde la réplica: "Datos al 18/09 14:30".
 * La hora es la del SERVIDOR que generó los datos (no la del reloj del equipo).
 */
export function Frescura({ dataset, etiqueta = "Datos al", viejoTrasMin = 60, compacto = false }: { dataset: string; etiqueta?: string; viejoTrasMin?: number; compacto?: boolean }) {
  const meta = useMetaDataset(dataset)
  const { sync } = useRuntime()
  const [sinc, setSinc] = useState(false)
  const viejo = !meta?.generadoAt || Date.now() - Date.parse(meta.generadoAt) > viejoTrasMin * 60_000
  return (
    <div className={`flex items-center gap-2 px-3 text-xs ${compacto ? "py-0.5" : "py-1.5"} ${viejo ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`}>
      <span className="flex-1">
        {meta?.generadoAt ? `${etiqueta} ${fechaHoraCorta(meta.generadoAt)} (${hace(meta.syncedAt)})` : "Sin datos descargados todavía"}
        {meta?.error ? " · último intento falló" : ""}
      </span>
      <button
        className="rounded px-2 py-1 font-semibold underline active:bg-black/10"
        disabled={sinc}
        onClick={async () => {
          setSinc(true)
          try {
            await sync.dataset(dataset)
          } finally {
            setSinc(false)
          }
        }}
      >
        {sinc ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  )
}

/**
 * Lista virtualizada (miles de filas sin trabar el handheld). Altura fija por fila,
 * o por tipo de fila con `altoDe` (ej. encabezados de grupo más bajos).
 * `indiceInicial`: fila que tiene que quedar a la vista al montar (volver de un
 * detalle a la misma altura de la lista).
 */
export function ListaVirtual<T>({
  items,
  alto = 64,
  altoDe,
  indiceInicial,
  render,
  vacio = "No hay nada para mostrar.",
  clave,
}: {
  items: T[]
  alto?: number
  altoDe?: (item: T, i: number) => number
  indiceInicial?: number
  render: (item: T, i: number) => ReactNode
  vacio?: ReactNode
  clave: (item: T) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => (altoDe ? altoDe(items[i]!, i) : alto),
    overscan: 6,
  })
  const posicionado = useRef(false)
  useEffect(() => {
    if (posicionado.current || indiceInicial === undefined || indiceInicial < 0 || indiceInicial >= items.length) return
    posicionado.current = true
    v.scrollToIndex(indiceInicial, { align: "center" })
  }, [indiceInicial, items.length, v])
  if (!items.length) return <div className="p-8 text-center text-slate-500">{vacio}</div>
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => (
          <div key={clave(items[vi.index]!)} style={{ position: "absolute", top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
            {render(items[vi.index]!, vi.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Boton({ children, variante = "primario", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "peligro" }) {
  const v = {
    primario: "bg-barra text-white active:bg-barra-activo",
    secundario: "bg-white text-slate-900 border border-slate-300 active:bg-slate-100",
    peligro: "bg-red-600 text-white active:bg-red-700",
  }[variante]
  return (
    <button {...p} className={`h-12 rounded-lg px-4 text-base font-semibold disabled:opacity-50 ${v} ${className}`}>
      {children}
    </button>
  )
}

/** Hoja inferior. Abrir/cerrar SIEMPRE con useOverlay (entrada de historial). */
export function Hoja({ abierta, onCerrar, titulo, children }: { abierta: boolean; onCerrar: () => void; titulo: string; children: ReactNode }) {
  if (!abierta) return null
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onCerrar}>
      <div className="max-h-[85vh] overflow-auto rounded-t-2xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="h-10 w-10 rounded-full text-2xl leading-none active:bg-slate-100">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
