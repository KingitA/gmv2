"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, Plus, X, Search, Check, FileText, MapPin } from "lucide-react"
import type { PedidoOverrides } from "@/hooks/use-order-queue"
import { CondicionesPedidoPanel, useCondicionesPedido } from "@/components/pedidos/CondicionesPedidoPanel"

type Cliente = {
  id: string
  nombre_razon_social?: string
  razon_social?: string
  codigo_cliente?: string
  direccion?: string
  localidad?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddToQueue: (clienteId: string, clienteNombre: string, files: File[], overrides?: PedidoOverrides) => void
}

// Importación de pedidos (xlsx / imagen / pdf / eml): archivos + cliente +
// condiciones del pedido (panel compartido con el alta manual y el mostrador).
export function NuevoPedidoDialog({ open, onOpenChange, onAddToQueue }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [files, setFiles]       = useState<File[]>([])
  const [cliente, setCliente]   = useState<Cliente | null>(null)
  const [query, setQuery]       = useState("")
  const [results, setResults]   = useState<any[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const cond = useCondicionesPedido(cliente?.id)
  const clienteNombre = cliente?.nombre_razon_social || cliente?.razon_social || ""

  const handleFiles = useCallback((selected: FileList | null) => {
    if (!selected) return
    // Mismo archivo adjuntado dos veces (click + arrastrar, o re-selección) =
    // pedido con todos los renglones duplicados. Se descarta el repetido.
    setFiles(prev => {
      const nuevos = Array.from(selected).filter(
        f => !prev.some(p => p.name === f.name && p.size === f.size)
      )
      return [...prev, ...nuevos]
    })
  }, [])

  const handleSearch = useCallback(async (term: string) => {
    setQuery(term)
    if (term.length < 2) { setShowDrop(false); return }
    const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(term)}`).then(r => r.json())
    setResults(res)
    setShowDrop(true)
  }, [])

  const selectCliente = (c: any) => {
    setCliente(c)
    setQuery(c.nombre_razon_social || c.razon_social || "")
    setShowDrop(false)
  }

  const reset = () => {
    setFiles([])
    setCliente(null)
    setQuery("")
    setResults([])
    setShowDrop(false)
    setError(null)
  }

  const handleSubmit = async () => {
    if (!cliente || files.length === 0 || cond.bloqueo) return
    setEnviando(true)
    setError(null)
    try {
      // "Guardar en la ficha": se guarda antes de encolar (el pedido congela la ficha nueva)
      await cond.guardarFichaSiCorresponde()
      onAddToQueue(cliente.id, clienteNombre, files, cond.condiciones() as PedidoOverrides)
      reset()
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || "No se pudieron guardar las condiciones en la ficha")
    } finally {
      setEnviando(false)
    }
  }

  const canSubmit = !!cliente && files.length > 0 && !cond.bloqueo && !enviando

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[800px] w-[95vw] max-h-[90vh] flex flex-col overflow-hidden p-0">
        {/* ── Título fijo ── */}
        <div className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="text-base font-semibold">Nuevo Pedido</DialogTitle>
        </div>

        {/* ── Cuerpo scrollable ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Archivos ───────────────────────────────────────────────────── */}
          <div>
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
              Archivos del pedido *
            </Label>
            <div
              className="border-2 border-dashed rounded-lg p-5 flex flex-col items-center text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            >
              <Upload className="h-7 w-7 mb-2 text-slate-400" />
              <p className="text-sm font-medium text-slate-600">Arrastrá o hacé clic para subir</p>
              <p className="text-xs text-slate-400 mt-0.5">JPG, PNG, PDF, Excel, EML — múltiples archivos</p>
              <input
                ref={fileRef} type="file" className="hidden"
                accept="image/*,.pdf,.xlsx,.xls,.csv,.txt,.eml,message/rfc822"
                multiple onChange={e => handleFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 truncate text-slate-700" title={f.name}>{f.name}</span>
                    <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500 shrink-0 ml-1">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Cliente ────────────────────────────────────────────────────── */}
          <div>
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
              Cliente *
            </Label>
            {cliente ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
                <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 leading-snug">{clienteNombre}</p>
                  {(cliente.codigo_cliente || cliente.direccion) && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                      {[cliente.codigo_cliente, cliente.direccion, cliente.localidad].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <button onClick={() => { setCliente(null); setQuery("") }} className="text-slate-400 hover:text-slate-600 shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-9 h-10"
                    placeholder="Buscar por nombre, código o dirección..."
                    value={query}
                    onChange={e => handleSearch(e.target.value)}
                    onFocus={() => { if (results.length) setShowDrop(true) }}
                    onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                  />
                </div>
                {showDrop && results.length > 0 && (
                  <div className="mt-1 border rounded-lg bg-background max-h-[240px] overflow-y-auto shadow-md">
                    {results.map(c => (
                      <div
                        key={c.id}
                        className="px-3 py-2.5 hover:bg-muted cursor-pointer border-b last:border-b-0"
                        onMouseDown={() => selectCliente(c)}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-sm font-medium leading-tight truncate">{c.nombre_razon_social || c.razon_social}</span>
                          {c.codigo_cliente && <span className="text-[10px] text-muted-foreground font-mono shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">{c.codigo_cliente}</span>}
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

          {/* ── Condiciones del pedido ─────────────────────────────────────── */}
          {cliente && (
            <div className="space-y-2">
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide block">
                Condiciones del pedido
              </Label>
              <CondicionesPedidoPanel estado={cond} />
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* ── Footer fijo ── */}
        <div className="px-6 pb-5 pt-3 shrink-0 border-t flex gap-2 items-center">
          {cliente && cond.bloqueo && <p className="text-[11px] text-amber-700 flex-1">{cond.bloqueo}</p>}
          <Button variant="outline" className="flex-1" onClick={() => { reset(); onOpenChange(false) }}>
            Cancelar
          </Button>
          <Button className="flex-1 gap-2" onClick={handleSubmit} disabled={!canSubmit}>
            <Plus className="h-4 w-4" />
            Agregar a Cola
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
