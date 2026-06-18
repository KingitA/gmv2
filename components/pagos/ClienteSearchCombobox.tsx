"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Search, X } from "lucide-react"

interface Cliente {
  id: string
  nombre: string
  razon_social: string | null
  cuit: string | null
  codigo_cliente: string | null
}

interface Props {
  onSelect: (cliente: Cliente | null) => void
  value?: Cliente | null
}

export function ClienteSearchCombobox({ onSelect, value }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Cliente[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        // Motor unificado: búsqueda híbrida (léxica trigram + vector de fallback)
        const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal })
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
        setOpen(true)
      } catch (e: any) {
        if (e?.name !== "AbortError") setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query])

  if (value) {
    return (
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
        <div className="flex-1">
          <p className="font-semibold text-sm">{value.razon_social || value.nombre}</p>
          <p className="text-xs text-muted-foreground">CUIT: {value.cuit || "—"} {value.codigo_cliente ? `· Cód: ${value.codigo_cliente}` : ""}</p>
        </div>
        <button onClick={() => onSelect(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente por nombre, razón social o CUIT..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          onFocus={() => results.length > 0 && setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-sm text-muted-foreground">Buscando...</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">Sin resultados</div>
          ) : results.map((c) => (
            <button
              key={c.id}
              className="w-full text-left px-4 py-2.5 hover:bg-accent transition-colors border-b last:border-0"
              onClick={() => { onSelect(c); setQuery(""); setOpen(false) }}
            >
              <p className="font-medium text-sm">{c.razon_social || c.nombre}</p>
              <p className="text-xs text-muted-foreground">CUIT: {c.cuit || "—"} {c.codigo_cliente ? `· Cód: ${c.codigo_cliente}` : ""}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
