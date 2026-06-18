"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Search, X, Loader2 } from "lucide-react"

export type SearchEntity = "articulos" | "clientes" | "proveedores"

interface Props<T extends { id: string }> {
    entity: SearchEntity
    value?: T | null
    onSelect: (item: T | null) => void
    placeholder?: string
    /** Fila del desplegable. Si no se pasa, usa un render por defecto según entity. */
    renderItem?: (item: T) => ReactNode
    /** Chip del valor seleccionado. Si no se pasa, usa un render por defecto. */
    renderValue?: (item: T) => ReactNode
    minChars?: number
    autoFocus?: boolean
    className?: string
    inputClassName?: string
    disabled?: boolean
    /** Permite limpiar la selección (default true). */
    allowClear?: boolean
    /** Modo compacto para barras de filtro (input bajito + chip chico). */
    compact?: boolean
}

const DEFAULT_PLACEHOLDER: Record<SearchEntity, string> = {
    articulos: "Buscar artículo por descripción, SKU o EAN...",
    clientes: "Buscar cliente por nombre, razón social o CUIT...",
    proveedores: "Buscar proveedor por nombre o CUIT...",
}

function defaultRenderItem(entity: SearchEntity, item: any): ReactNode {
    if (entity === "articulos") {
        return (
            <>
                <p className="font-medium text-sm">{item.descripcion}</p>
                <p className="text-xs text-muted-foreground">
                    {item.sku ? `SKU: ${item.sku}` : ""}
                    {item.marca?.descripcion ? ` · ${item.marca.descripcion}` : ""}
                    {item.proveedor?.nombre ? ` · ${item.proveedor.nombre}` : ""}
                </p>
            </>
        )
    }
    if (entity === "proveedores") {
        return (
            <>
                <p className="font-medium text-sm">{item.nombre}</p>
                <p className="text-xs text-muted-foreground">CUIT: {item.cuit || "—"}</p>
            </>
        )
    }
    // clientes
    return (
        <>
            <p className="font-medium text-sm">{item.razon_social || item.nombre}</p>
            <p className="text-xs text-muted-foreground">
                CUIT: {item.cuit || "—"}{item.codigo_cliente ? ` · Cód: ${item.codigo_cliente}` : ""}
                {item.localidad ? ` · ${item.localidad}` : ""}
            </p>
        </>
    )
}

function defaultLabel(entity: SearchEntity, item: any): string {
    if (entity === "articulos") return item.descripcion || ""
    return item.razon_social || item.nombre || ""
}

/**
 * Buscador de texto unificado para artículos / clientes / proveedores.
 * Llama a /api/{entity}/buscar (motor híbrido: léxico trigram + vector de fallback).
 * Reemplaza tanto cuadros de búsqueda como dropdowns/selectores.
 */
export function EntitySearchSelect<T extends { id: string }>(props: Props<T>) {
    const {
        entity, value, onSelect,
        placeholder = DEFAULT_PLACEHOLDER[entity],
        renderItem, renderValue,
        minChars = 2, autoFocus, className = "", inputClassName = "",
        disabled, allowClear = true, compact = false,
    } = props
    const inputCls = compact ? `h-7 text-xs ${inputClassName}` : inputClassName

    const [query, setQuery] = useState("")
    const [results, setResults] = useState<T[]>([])
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [highlight, setHighlight] = useState(0)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [])

    useEffect(() => {
        if (query.trim().length < minChars) { setResults([]); return }
        const ctrl = new AbortController()
        const timer = setTimeout(async () => {
            setLoading(true)
            try {
                const res = await fetch(`/api/${entity}/buscar?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal })
                const data = await res.json()
                const list = Array.isArray(data) ? data : []
                setResults(list)
                setHighlight(0)
                setOpen(true)
            } catch (e: any) {
                if (e?.name !== "AbortError") setResults([])
            } finally {
                setLoading(false)
            }
        }, 250)
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [query, entity, minChars])

    const choose = (item: T) => { onSelect(item); setQuery(""); setResults([]); setOpen(false) }

    if (value) {
        return (
            <div className={`flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg ${compact ? "px-2 py-1" : "px-3 py-2"} ${className}`}>
                <div className="flex-1 min-w-0">
                    {renderValue ? renderValue(value) : (
                        <p className={`font-semibold truncate ${compact ? "text-xs" : "text-sm"}`}>{defaultLabel(entity, value)}</p>
                    )}
                </div>
                {allowClear && !disabled && (
                    <button type="button" onClick={() => onSelect(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                        <X className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
                    </button>
                )}
            </div>
        )
    }

    return (
        <div ref={ref} className={`relative ${className}`}>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                    autoFocus={autoFocus}
                    disabled={disabled}
                    placeholder={placeholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => results.length > 0 && setOpen(true)}
                    onKeyDown={(e) => {
                        if (!open || results.length === 0) return
                        if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)) }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
                        else if (e.key === "Enter") { e.preventDefault(); const it = results[highlight]; if (it) choose(it) }
                        else if (e.key === "Escape") { setOpen(false) }
                    }}
                    className={`pl-9 ${inputCls}`}
                />
                {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {open && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                    {loading ? (
                        <div className="p-3 text-sm text-muted-foreground">Buscando...</div>
                    ) : results.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">Sin resultados</div>
                    ) : results.map((item, i) => (
                        <button
                            type="button"
                            key={item.id}
                            onMouseEnter={() => setHighlight(i)}
                            className={`w-full text-left px-4 py-2.5 transition-colors border-b last:border-0 ${i === highlight ? "bg-accent" : "hover:bg-accent"}`}
                            onClick={() => choose(item)}
                        >
                            {renderItem ? renderItem(item) : defaultRenderItem(entity, item)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
