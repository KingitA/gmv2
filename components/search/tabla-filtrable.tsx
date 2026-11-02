"use client"

// Buscador + orden + filtro por encabezado (tipo Excel) para tablas chicas que
// ya están cargadas en memoria (las de /tablas: marcas, zonas, bancos…).
// Mismo comportamiento que Clientes y Artículos (pedido de Juan, 02/11/2026):
//   - Buscador de texto: busca en todas las columnas (sin acentos, en cualquier orden).
//   - Click en el título de la columna: A→Z, Z→A, sin orden (números de menor a mayor).
//   - Embudo de cada columna: ordenar, buscar y tildar valores, o desde/hasta en números.
// La lógica de filtros es la de lib/search/facetas.ts.
//
// Uso:
//   const cols: ColumnaTabla<Marca>[] = [{ id: "codigo", titulo: "Código", valor: m => m.codigo }, …]
//   const t = useTablaFiltrable(marcas, cols)
//   <BuscadorTabla tabla={t} placeholder="Buscar marca…" />
//   <TableHead><CabeceraFiltrable tabla={t} id="codigo" /></TableHead>
//   {t.filas.map(…)}

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Search, X } from "lucide-react"
import { FiltroColumnaMenu, ChipsFiltros, textoChip } from "@/components/search/filtro-columna"
import { aplicarFiltros, calcularFacetas, ordenarPor, filtroActivo, type DefColumna, type FiltroColumna, type Filtros } from "@/lib/search/facetas"
import { localMatch } from "@/lib/search/local-match"
import { entero, numero as fmtNumero } from "@/lib/formato"

export interface ColumnaTabla<T> {
  id: string
  titulo: string
  /** Texto de la celda (para buscar, ordenar y tildar valores) */
  valor?: (r: T) => string | null | undefined
  /** Número de la celda (ordena como número y filtra desde/hasta) */
  numero?: (r: T) => number | null | undefined
  /** Sin embudo de filtro (sigue ordenando con click en el título) */
  sinFiltro?: boolean
}

export interface TablaFiltrable<T> {
  filas: T[]
  total: number
  busqueda: string
  setBusqueda: (s: string) => void
  columnas: ColumnaTabla<T>[]
  filtros: Filtros
  setFiltro: (id: string, f: FiltroColumna | null) => void
  limpiar: () => void
  orden: { col: string; dir: "asc" | "desc" } | null
  setOrden: (o: { col: string; dir: "asc" | "desc" } | null) => void
  facetas: ReturnType<typeof calcularFacetas>
}

/** Los textos se ordenan "natural": 1, 2, 10, 100 (no 1, 10, 100, 2). `ordenInicial`: columna por la que arranca ordenada. */
export function useTablaFiltrable<T>(rows: T[], columnas: ColumnaTabla<T>[], ordenInicial?: string): TablaFiltrable<T> {
  const [busqueda, setBusqueda] = useState("")
  const [filtros, setFiltros] = useState<Filtros>({})
  const [orden, setOrden] = useState<{ col: string; dir: "asc" | "desc" } | null>(ordenInicial ? { col: ordenInicial, dir: "asc" } : null)

  const defs = useMemo<DefColumna<T>[]>(() => columnas.map((c) => ({
    id: c.id,
    valor: c.valor ?? (c.numero ? (r: T) => { const n = c.numero!(r); return n == null ? null : fmtNumero(n, 0, 2) } : undefined),
    numero: c.numero,
  })), [columnas])

  const universo = useMemo(() => {
    const q = busqueda.trim()
    if (!q) return rows
    return rows.filter((r) => localMatch(q, defs.map((d) => d.valor?.(r))))
  }, [rows, defs, busqueda])

  const conValores = useMemo(() => columnas.filter((c) => !c.sinFiltro && !c.numero).map((c) => c.id), [columnas])
  const facetas = useMemo(() => calcularFacetas(universo, defs, filtros, conValores), [universo, defs, filtros, conValores])

  const filas = useMemo(() => {
    const base = aplicarFiltros(universo, defs, filtros)
    const def = orden ? defs.find((d) => d.id === orden.col) : null
    return def ? ordenarPor(base, def, orden!.dir) : base
  }, [universo, defs, filtros, orden])

  const setFiltro = (id: string, f: FiltroColumna | null) =>
    setFiltros((p) => { const n = { ...p }; if (f) n[id] = f; else delete n[id]; return n })

  return {
    filas, total: rows.length, busqueda, setBusqueda, columnas, filtros, setFiltro,
    limpiar: () => { setFiltros({}); setBusqueda("") },
    orden, setOrden, facetas,
  }
}

/** Contenido de un TableHead: título que ordena + embudo de filtro. */
export function CabeceraFiltrable<T>({ tabla, id, alinear }: { tabla: TablaFiltrable<T>; id: string; alinear?: "derecha" }) {
  const col = tabla.columnas.find((c) => c.id === id)
  if (!col) return null
  const orden = tabla.orden?.col === id ? tabla.orden.dir : null
  const alternar = () =>
    tabla.setOrden(orden === "asc" ? { col: id, dir: "desc" } : orden === "desc" ? null : { col: id, dir: "asc" })
  return (
    <div className={`flex items-center gap-1 ${alinear === "derecha" ? "justify-end" : ""}`}>
      <button type="button" onClick={alternar} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground" title="Ordenar">
        {col.titulo}
        {orden === "asc" ? <ArrowUp className="h-3 w-3 text-indigo-600" /> : orden === "desc" ? <ArrowDown className="h-3 w-3 text-indigo-600" /> : null}
      </button>
      {!col.sinFiltro && (
        <FiltroColumnaMenu
          titulo={col.titulo}
          tipo={col.numero ? "numero" : "valores"}
          opciones={tabla.facetas[id]}
          filtro={tabla.filtros[id]}
          onFiltro={(f) => tabla.setFiltro(id, f)}
          orden={orden}
          onOrden={(dir) => tabla.setOrden({ col: id, dir })}
        />
      )}
    </div>
  )
}

/** Buscador de texto + cantidad + filtros activos (con ✕ y "Limpiar filtros"). */
export function BuscadorTabla<T>({ tabla, placeholder = "Buscar…" }: { tabla: TablaFiltrable<T>; placeholder?: string }) {
  const chips = Object.entries(tabla.filtros)
    .filter(([, f]) => filtroActivo(f))
    .map(([id, f]) => ({ id, texto: textoChip(tabla.columnas.find((c) => c.id === id)?.titulo || id, f, tabla.facetas[id]) }))
  const filtrando = tabla.busqueda.trim() !== "" || chips.length > 0
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={tabla.busqueda}
            onChange={(e) => tabla.setBusqueda(e.target.value)}
            placeholder={placeholder}
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-8 text-sm outline-none focus:border-indigo-400"
          />
          {tabla.busqueda && (
            <button type="button" onClick={() => tabla.setBusqueda("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Borrar búsqueda">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filtrando ? `${entero(tabla.filas.length)} de ${entero(tabla.total)}` : `${entero(tabla.total)} en total`}
        </span>
      </div>
      <ChipsFiltros chips={chips} onQuitar={(id) => tabla.setFiltro(id, null)} onLimpiar={tabla.limpiar} />
    </div>
  )
}
