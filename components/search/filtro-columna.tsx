"use client"

// Menú de filtro por encabezado, al estilo Excel:
//   - Ordenar A→Z / Z→A (o menor/mayor en columnas numéricas)
//   - Buscar dentro de los valores de la columna; con texto escrito quedan
//     tildados solo los que coinciden y Enter/Aceptar filtra por esos.
//     "Agregar a la selección actual" suma lo buscado a lo que ya estaba tildado.
//   - Tildar / destildar valores (con cantidad de filas de cada uno)
//   - Columnas numéricas: desde / hasta
// La lógica de filtrado vive en lib/search/facetas.ts; este componente solo
// edita un FiltroColumna y lo devuelve con onFiltro.

import { useEffect, useMemo, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ArrowDownAZ, ArrowUpAZ, ArrowDown01, ArrowUp10, ListFilter, X } from "lucide-react"
import { localMatch } from "@/lib/search/local-match"
import { filtroActivo, type FiltroColumna, type OpcionFiltro } from "@/lib/search/facetas"
import { cn } from "@/lib/utils"
import { numero, parseMonto } from "@/lib/formato"

interface Props {
  titulo: string
  /** "valores" = tildar valores; "numero" = desde/hasta */
  tipo?: "valores" | "numero"
  opciones?: OpcionFiltro[]
  cargando?: boolean
  filtro?: FiltroColumna | null
  onFiltro: (f: FiltroColumna | null) => void
  orden?: "asc" | "desc" | null
  onOrden?: (dir: "asc" | "desc") => void
  /** Se llama al abrir (para pedir las opciones si se cargan a demanda). */
  onAbrir?: () => void
  /** Si se indica, el disparador es un botón con este texto (para filtros que no son columnas). */
  boton?: string
  className?: string
}

export function FiltroColumnaMenu({
  titulo, tipo = "valores", opciones = [], cargando, filtro, onFiltro, orden, onOrden, onAbrir, boton, className,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  // Selección en edición: null = todos tildados
  const [sel, setSel] = useState<Set<string> | null>(null)
  const [selBusqueda, setSelBusqueda] = useState<Set<string>>(new Set())
  const [agregar, setAgregar] = useState(false)
  const [min, setMin] = useState("")
  const [max, setMax] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const activo = filtroActivo(filtro)

  // Al abrir: copiar el filtro actual al borrador
  useEffect(() => {
    if (!abierto) return
    onAbrir?.()
    setBusqueda("")
    setAgregar(false)
    setSel(filtro?.valores ? new Set(filtro.valores) : null)
    setMin(filtro?.min != null ? numero(filtro.min, 0, 4) : "")
    setMax(filtro?.max != null ? numero(filtro.max, 0, 4) : "")
    setTimeout(() => inputRef.current?.focus(), 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const visibles = useMemo(
    () => (busqueda.trim() ? opciones.filter((o) => localMatch(busqueda, o.etiqueta)) : opciones),
    [opciones, busqueda],
  )

  // Con texto escrito, quedan tildados todos los que coinciden (como Excel)
  useEffect(() => {
    if (busqueda.trim()) setSelBusqueda(new Set(visibles.map((o) => o.valor)))
  }, [busqueda, visibles])

  const enBusqueda = busqueda.trim() !== ""
  const estaTildado = (v: string) => (enBusqueda ? selBusqueda.has(v) : sel === null || sel.has(v))
  const todosVisiblesTildados = visibles.length > 0 && visibles.every((o) => estaTildado(o.valor))

  const alternar = (v: string) => {
    if (enBusqueda) {
      setSelBusqueda((p) => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n })
      return
    }
    setSel((p) => {
      const n = new Set(p ?? opciones.map((o) => o.valor))
      n.has(v) ? n.delete(v) : n.add(v)
      return n
    })
  }

  const alternarTodos = () => {
    if (enBusqueda) {
      setSelBusqueda(todosVisiblesTildados ? new Set() : new Set(visibles.map((o) => o.valor)))
      return
    }
    setSel(todosVisiblesTildados ? new Set() : null)
  }

  const aceptar = () => {
    if (tipo === "numero") {
      const nMin = min.trim() === "" ? null : parseMonto(min) ?? NaN
      const nMax = max.trim() === "" ? null : parseMonto(max) ?? NaN
      const f: FiltroColumna = {
        min: nMin != null && !Number.isNaN(nMin) ? nMin : null,
        max: nMax != null && !Number.isNaN(nMax) ? nMax : null,
      }
      onFiltro(f.min == null && f.max == null ? null : f)
      setAbierto(false)
      return
    }
    let valores: string[] | null
    if (enBusqueda) {
      const base = agregar && filtro?.valores ? new Set(filtro.valores) : new Set<string>()
      for (const v of selBusqueda) base.add(v)
      valores = [...base]
    } else if (sel === null) {
      valores = null
    } else {
      valores = [...sel]
      // Todos tildados = sin filtro
      if (opciones.length > 0 && opciones.every((o) => sel.has(o.valor))) valores = null
    }
    onFiltro(valores === null ? null : { valores })
    setAbierto(false)
  }

  const borrar = () => { onFiltro(null); setAbierto(false) }

  const esNumero = tipo === "numero"

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        {boton ? (
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
              activo ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              className,
            )}
          >
            <ListFilter className="h-3.5 w-3.5" />
            {boton}
            {activo && filtro?.valores && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold leading-4 text-white">{filtro.valores.length}</span>}
          </button>
        ) : (
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title={activo ? `Filtrando ${titulo}` : `Filtrar ${titulo}`}
          aria-label={`Filtrar ${titulo}`}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors",
            activo ? "bg-indigo-600 text-white" : "text-slate-400 opacity-60 hover:bg-slate-200 hover:text-slate-700 hover:opacity-100",
            className,
          )}
        >
          <ListFilter className="h-3 w-3" />
        </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0 text-xs normal-case tracking-normal"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-3 py-2 text-[11px] font-semibold text-slate-500">{titulo}</div>

        {onOrden && (
          <div className="border-b py-1">
            <button type="button" onClick={() => { onOrden("asc"); setAbierto(false) }}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50", orden === "asc" && "font-semibold text-indigo-700")}>
              {esNumero ? <ArrowDown01 className="h-3.5 w-3.5" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
              {esNumero ? "Ordenar de menor a mayor" : "Ordenar de A a Z"}
            </button>
            <button type="button" onClick={() => { onOrden("desc"); setAbierto(false) }}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50", orden === "desc" && "font-semibold text-indigo-700")}>
              {esNumero ? <ArrowUp10 className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
              {esNumero ? "Ordenar de mayor a menor" : "Ordenar de Z a A"}
            </button>
          </div>
        )}

        {esNumero ? (
          <div className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <label className="w-12 text-slate-500">Desde</label>
              <input ref={inputRef} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") aceptar() }}
                className="h-7 flex-1 rounded-md border border-slate-200 px-2 tabular-nums outline-none focus:border-indigo-400" />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-12 text-slate-500">Hasta</label>
              <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") aceptar() }}
                className="h-7 flex-1 rounded-md border border-slate-200 px-2 tabular-nums outline-none focus:border-indigo-400" />
            </div>
          </div>
        ) : (
          <div className="p-2">
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aceptar() } }}
              placeholder="Buscar…"
              className="mb-1.5 h-7 w-full rounded-md border border-slate-200 px-2 outline-none focus:border-indigo-400"
            />
            <div className="max-h-64 overflow-y-auto rounded-md border border-slate-100">
              {cargando && opciones.length === 0 ? (
                <div className="px-2 py-3 text-center text-slate-400">Cargando…</div>
              ) : visibles.length === 0 ? (
                <div className="px-2 py-3 text-center text-slate-400">Sin coincidencias</div>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1.5 hover:bg-slate-50">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={todosVisiblesTildados} onChange={alternarTodos} />
                    <span className="font-medium">{enBusqueda ? "(Seleccionar todos los resultados)" : "(Seleccionar todo)"}</span>
                  </label>
                  {visibles.map((o) => (
                    <label key={o.valor} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-slate-50">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={estaTildado(o.valor)} onChange={() => alternar(o.valor)} />
                      <span className={cn("flex-1 truncate", o.cantidad === 0 && "text-slate-400")}>{o.etiqueta}</span>
                      <span className="tabular-nums text-[10px] text-slate-400">{o.cantidad}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
            {enBusqueda && filtro?.valores && (
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 px-1 text-slate-600">
                <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={agregar} onChange={(e) => setAgregar(e.target.checked)} />
                Agregar a la selección actual
              </label>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <button type="button" onClick={borrar} disabled={!activo}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 disabled:invisible">
            <X className="h-3 w-3" />Borrar filtro
          </button>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setAbierto(false)} className="h-7 rounded-md border border-slate-200 px-2.5 hover:bg-slate-50">Cancelar</button>
            <button type="button" onClick={aceptar} className="h-7 rounded-md bg-indigo-600 px-3 font-semibold text-white hover:bg-indigo-700">Aceptar</button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Etiquetas de los filtros activos, con ✕ para quitar cada uno y "Limpiar filtros". */
export function ChipsFiltros({
  chips, onQuitar, onLimpiar,
}: {
  chips: { id: string; texto: string }[]
  onQuitar: (id: string) => void
  onLimpiar: () => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.id} className="inline-flex max-w-[360px] items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 py-0.5 pl-2.5 pr-1 text-[11px] text-indigo-800">
          <span className="truncate">{c.texto}</span>
          <button type="button" onClick={() => onQuitar(c.id)} className="rounded-full p-0.5 hover:bg-indigo-200" aria-label="Quitar filtro">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onLimpiar} className="text-[11px] font-semibold text-slate-500 hover:text-red-600">Limpiar filtros</button>
    </div>
  )
}

/** Texto de un chip: "Marca: Virulana, Make (+2)" o "P. Base: 100 a 500". */
export function textoChip(titulo: string, f: FiltroColumna, opciones?: OpcionFiltro[]): string {
  if (f.valores) {
    const et = f.valores.map((v) => opciones?.find((o) => o.valor === v)?.etiqueta ?? (v === "__vacio__" ? "(vacío)" : v))
    if (et.length === 0) return `${titulo}: ninguno`
    return `${titulo}: ${et.slice(0, 2).join(", ")}${et.length > 2 ? ` (+${et.length - 2})` : ""}`
  }
  if (f.min != null && f.max != null) return `${titulo}: ${numero(f.min, 0, 2)} a ${numero(f.max, 0, 2)}`
  if (f.min != null) return `${titulo}: desde ${numero(f.min, 0, 2)}`
  return `${titulo}: hasta ${numero(f.max!, 0, 2)}`
}
