"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import * as XLSX from "xlsx"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Plus, X, Search, Check, FileText, MapPin, Sparkles } from "lucide-react"
import { searchClientes } from "@/lib/actions/clientes"
import { interpretClientFromText } from "@/lib/actions/interpret-client"
import { toast } from "sonner"
import type { PedidoOverrides } from "@/hooks/use-order-queue"

type Cliente = {
  id: string
  nombre_razon_social?: string
  razon_social?: string
  codigo_cliente?: string
  direccion?: string
  localidad?: string
  metodo_facturacion?: string | null
  lista_precio_id?: string | null
}

type LP = { id: string; nombre: string }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddToQueue: (clienteId: string, clienteNombre: string, files: File[], overrides?: PedidoOverrides) => void
}

const METODOS = [
  { value: "factura_a", label: "Factura A" },
  { value: "factura_b", label: "Factura B" },
  { value: "factura_c", label: "Factura C" },
  { value: "remito",    label: "Remito"    },
  { value: "presupuesto", label: "Presupuesto" },
]

/** Scan files for potential client name candidates */
/** Extracts readable raw text from files to send to Claude for interpretation */
async function extractRawText(files: File[]): Promise<string> {
  const parts: string[] = []

  for (const file of files) {
    // Filename without extension
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[_\-\.]+/g, " ").trim()
    parts.push(`archivo: ${base}`)

    // Excel/CSV: first 5 rows × first 5 cols
    if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
      try {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", range: { s: { r: 0, c: 0 }, e: { r: 5, c: 5 } } })
        for (const row of rows || []) {
          const cells = (row as any[]).map(c => String(c ?? "").trim()).filter(Boolean)
          if (cells.length) parts.push(cells.join(" | "))
        }
      } catch { /* ignore */ }
    }
  }

  return parts.join("\n").slice(0, 800)
}

export function NuevoPedidoDialog({ open, onOpenChange, onAddToQueue }: Props) {
  const sb = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [files, setFiles]           = useState<File[]>([])
  const [cliente, setCliente]       = useState<Cliente | null>(null)
  const [query, setQuery]           = useState("")
  const [results, setResults]       = useState<any[]>([])
  const [showDrop, setShowDrop]     = useState(false)
  const [suggestion, setSuggestion] = useState<any | null>(null)
  const [analyzing, setAnalyzing]   = useState(false)
  const [listas, setListas]         = useState<LP[]>([])
  const [metodo, setMetodo]         = useState("")
  const [listaId, setListaId]       = useState("")
  const [saveMode, setSaveMode]     = useState<"temp" | "permanent" | null>(null)

  // Load listas on open
  useEffect(() => {
    if (!open) return
    sb.from("listas_precio").select("id,nombre").eq("activo", true).order("nombre")
      .then(({ data }) => setListas(data || []))
  }, [open])

  // Init conditions when client selected
  useEffect(() => {
    if (cliente) {
      setMetodo(cliente.metodo_facturacion || "")
      setListaId(cliente.lista_precio_id || "")
      setSaveMode(null)
    }
  }, [cliente])

  const conditionsChanged = !!cliente && (
    metodo !== (cliente.metodo_facturacion || "") ||
    listaId !== (cliente.lista_precio_id || "")
  )

  const clienteNombre = cliente?.nombre_razon_social || cliente?.razon_social || ""

  const handleFiles = useCallback(async (selected: FileList | null) => {
    if (!selected) return
    const added = Array.from(selected)
    setFiles(prev => [...prev, ...added])

    if (!cliente) {
      setAnalyzing(true)
      try {
        const rawText = await extractRawText(added)
        if (rawText.trim()) {
          const result = await interpretClientFromText(rawText)
          if (result) setSuggestion(result)
        }
      } catch { /* ignore */ }
      setAnalyzing(false)
    }
  }, [cliente])

  const handleSearch = useCallback(async (term: string) => {
    setQuery(term)
    setSuggestion(null)
    if (term.length < 2) { setShowDrop(false); return }
    const res = await searchClientes(term)
    setResults(res)
    setShowDrop(true)
  }, [])

  const selectCliente = (c: any) => {
    setCliente(c)
    setQuery(c.nombre_razon_social || c.razon_social || "")
    setShowDrop(false)
    setSuggestion(null)
  }

  const clearCliente = () => {
    setCliente(null)
    setQuery("")
    setMetodo("")
    setListaId("")
    setSaveMode(null)
  }

  const reset = () => {
    setFiles([])
    setCliente(null)
    setQuery("")
    setResults([])
    setShowDrop(false)
    setSuggestion(null)
    setAnalyzing(false)
    setMetodo("")
    setListaId("")
    setSaveMode(null)
  }

  const handleSubmit = async () => {
    if (!cliente || files.length === 0) return

    if (conditionsChanged && !saveMode) {
      toast.error("Indicá si el cambio es permanente o solo para este pedido")
      return
    }

    let overrides: PedidoOverrides = {}
    if (conditionsChanged) {
      if (metodo !== (cliente.metodo_facturacion || ""))   overrides.metodo_facturacion_pedido = metodo
      if (listaId !== (cliente.lista_precio_id || ""))     overrides.lista_precio_pedido_id    = listaId

      if (saveMode === "permanent") {
        const upd: any = {}
        if (metodo  !== (cliente.metodo_facturacion || "")) upd.metodo_facturacion = metodo
        if (listaId !== (cliente.lista_precio_id    || "")) upd.lista_precio_id    = listaId
        if (Object.keys(upd).length > 0) {
          await sb.from("clientes").update(upd).eq("id", cliente.id)
        }
      }
    }

    onAddToQueue(cliente.id, clienteNombre, files, conditionsChanged ? overrides : undefined)
    toast.success(`${clienteNombre} agregado a la cola`)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Pedido</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">

          {/* ── Archivos ── */}
          <div>
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Archivos del pedido *
            </Label>
            <div
              className="mt-1.5 border-2 border-dashed rounded-lg p-4 flex flex-col items-center text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            >
              <Upload className="h-6 w-6 mb-1.5" />
              <p className="text-sm font-medium">Arrastrá o hacé clic para subir</p>
              <p className="text-xs mt-0.5">JPG, PNG, PDF, Excel — múltiples archivos</p>
              <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.xlsx,.xls,.csv,.txt" multiple
                onChange={e => handleFiles(e.target.files)} />
            </div>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/50 rounded px-3 py-1.5 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                    </div>
                    <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} className="ml-2 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Cliente ── */}
          <div>
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Cliente *
            </Label>

            {/* Analyzing spinner */}
            {analyzing && (
              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 py-1">
                <div className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                Buscando cliente en los archivos...
              </div>
            )}

            {/* Suggestion */}
            {suggestion && !cliente && (
              <div className="mt-1.5 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-indigo-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wide">Sugerido</p>
                  <p className="text-sm font-semibold truncate leading-tight">
                    {suggestion.nombre_razon_social}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {[suggestion.codigo_cliente, suggestion.direccion, suggestion.localidad].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" className="h-7 text-xs px-2.5" onClick={() => selectCliente(suggestion)}>
                    <Check className="h-3 w-3 mr-1" />Es este
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setSuggestion(null)}>
                    Buscar otro
                  </Button>
                </div>
              </div>
            )}

            {/* Selected client card */}
            {cliente && (
              <div className="mt-1.5 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{clienteNombre}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {[cliente.codigo_cliente, cliente.direccion, cliente.localidad].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button onClick={clearCliente} className="text-slate-400 hover:text-slate-600 shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Search input */}
            {!cliente && (
              <div className="mt-1.5 relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar por nombre, código, dirección..."
                  value={query}
                  onChange={e => handleSearch(e.target.value)}
                  onFocus={() => { if (results.length) setShowDrop(true) }}
                  onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                />
                {showDrop && results.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 border rounded-lg shadow-lg bg-background max-h-[220px] overflow-auto z-50">
                    {results.map(c => (
                      <div
                        key={c.id}
                        className="px-3 py-2.5 hover:bg-muted cursor-pointer border-b last:border-b-0"
                        onMouseDown={() => selectCliente(c)}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium leading-tight">{c.nombre_razon_social || c.razon_social}</span>
                          {c.codigo_cliente && (
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                              {c.codigo_cliente}
                            </span>
                          )}
                        </div>
                        {(c.direccion || c.localidad) && (
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{[c.direccion, c.localidad].filter(Boolean).join(", ")}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Condiciones (solo si hay cliente) ── */}
          {cliente && (
            <div>
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                Condiciones del pedido
              </Label>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-slate-600">Facturación</Label>
                  <Select value={metodo || "__none__"} onValueChange={v => setMetodo(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs mt-0.5">
                      <SelectValue placeholder="Sin definir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin definir</SelectItem>
                      {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-600">Lista de precio</Label>
                  <Select value={listaId || "__none__"} onValueChange={v => setListaId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs mt-0.5">
                      <SelectValue placeholder="Sin definir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin definir</SelectItem>
                      {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {conditionsChanged && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-amber-700 font-semibold mb-2">
                    Cambiaste las condiciones — ¿cómo aplicar?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSaveMode("temp")}
                      className={`flex-1 py-1.5 rounded border text-xs font-medium transition-all ${
                        saveMode === "temp"
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white border-amber-300 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      Solo este pedido
                    </button>
                    <button
                      onClick={() => setSaveMode("permanent")}
                      className={`flex-1 py-1.5 rounded border text-xs font-medium transition-all ${
                        saveMode === "permanent"
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white border-amber-300 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      Guardar al cliente
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-4">
          <Button variant="outline" className="flex-1" onClick={() => { reset(); onOpenChange(false) }}>
            Cancelar
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleSubmit}
            disabled={!cliente || files.length === 0 || (conditionsChanged && !saveMode)}
          >
            <Plus className="h-4 w-4" />
            Agregar a Cola
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
