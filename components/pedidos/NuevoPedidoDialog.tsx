"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Plus, X, Search, Check, FileText, MapPin, ChevronDown, ChevronUp } from "lucide-react"
import { searchClientes } from "@/lib/actions/clientes"
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
  { value: "Factura (21% IVA)", label: "Factura (21% IVA)" },
  { value: "Final (Mixto)",     label: "Final (Mixto)"     },
  { value: "Presupuesto",       label: "Presupuesto"       },
]

type SegmentoRowProps = {
  label: string
  lista: string
  onLista: (v: string) => void
  metodoSeg: string
  onMetodo: (v: string) => void
  listas: LP[]
}

function SegmentoRow({ label, lista, onLista, metodoSeg, onMetodo, listas }: SegmentoRowProps) {
  return (
    <div className="px-3 py-2.5 bg-white">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Label className="text-[11px] text-slate-500 mb-1 block">Facturación</Label>
          <Select value={metodoSeg || "__none__"} onValueChange={v => onMetodo(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="Heredar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Heredar</SelectItem>
              {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <Label className="text-[11px] text-slate-500 mb-1 block">Lista de precio</Label>
          <Select value={lista || "__none__"} onValueChange={v => onLista(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="Heredar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Heredar</SelectItem>
              {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

export function NuevoPedidoDialog({ open, onOpenChange, onAddToQueue }: Props) {
  const sb = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [files, setFiles]             = useState<File[]>([])
  const [cliente, setCliente]         = useState<Cliente | null>(null)
  const [query, setQuery]             = useState("")
  const [results, setResults]         = useState<any[]>([])
  const [showDrop, setShowDrop]       = useState(false)
  const [listas, setListas]           = useState<LP[]>([])
  // Condición general
  const [metodo, setMetodo]           = useState("")
  const [listaId, setListaId]         = useState("")
  // Condiciones por segmento
  const [showSegmentos, setShowSegmentos] = useState(false)
  const [listaLimpieza, setListaLimpieza] = useState("")
  const [metodoLimpieza, setMetodoLimpieza] = useState("")
  const [listaPerf0, setListaPerf0]   = useState("")
  const [metodoPerf0, setMetodoPerf0] = useState("")
  const [listaPerfPlus, setListaPerfPlus] = useState("")
  const [metodoPerfPlus, setMetodoPerfPlus] = useState("")
  const [saveMode, setSaveMode]       = useState<"temp" | "permanent" | null>(null)

  // Cargar listas al abrir
  useEffect(() => {
    if (!open) return
    sb.from("listas_precio").select("id,nombre").eq("activo", true).order("nombre")
      .then(({ data }) => setListas(data || []))
  }, [open])

  // Inicializar condiciones cuando se selecciona cliente
  useEffect(() => {
    if (cliente) {
      setMetodo(cliente.metodo_facturacion || "")
      setListaId(cliente.lista_precio_id || "")
      // Segmentos: cargar defaults del cliente si los tiene
      const c = cliente as any
      setListaLimpieza(c.lista_limpieza_id || "")
      setMetodoLimpieza(c.metodo_limpieza || "")
      setListaPerf0(c.lista_perf0_id || "")
      setMetodoPerf0(c.metodo_perf0 || "")
      setListaPerfPlus(c.lista_perf_plus_id || "")
      setMetodoPerfPlus(c.metodo_perf_plus || "")
      // Expandir automáticamente si el cliente ya tiene algún segmento configurado
      if (c.lista_limpieza_id || c.lista_perf0_id || c.lista_perf_plus_id) {
        setShowSegmentos(true)
      }
      setSaveMode(null)
    }
  }, [cliente])

  const c = cliente as any
  const conditionsChanged = !!cliente && (
    metodo !== (cliente.metodo_facturacion || "") ||
    listaId !== (cliente.lista_precio_id || "") ||
    listaLimpieza !== (c?.lista_limpieza_id || "") ||
    metodoLimpieza !== (c?.metodo_limpieza || "") ||
    listaPerf0 !== (c?.lista_perf0_id || "") ||
    metodoPerf0 !== (c?.metodo_perf0 || "") ||
    listaPerfPlus !== (c?.lista_perf_plus_id || "") ||
    metodoPerfPlus !== (c?.metodo_perf_plus || "")
  )

  const clienteNombre = cliente?.nombre_razon_social || cliente?.razon_social || ""

  const handleFiles = useCallback((selected: FileList | null) => {
    if (!selected) return
    setFiles(prev => [...prev, ...Array.from(selected)])
  }, [])

  const handleSearch = useCallback(async (term: string) => {
    setQuery(term)
    if (term.length < 2) { setShowDrop(false); return }
    const res = await searchClientes(term)
    setResults(res)
    setShowDrop(true)
  }, [])

  const selectCliente = (c: any) => {
    setCliente(c)
    setQuery(c.nombre_razon_social || c.razon_social || "")
    setShowDrop(false)
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
    setMetodo("")
    setListaId("")
    setShowSegmentos(false)
    setListaLimpieza("")
    setMetodoLimpieza("")
    setListaPerf0("")
    setMetodoPerf0("")
    setListaPerfPlus("")
    setMetodoPerfPlus("")
    setSaveMode(null)
  }

  const handleSubmit = async () => {
    if (!cliente || files.length === 0) return

    if (conditionsChanged && !saveMode) return  // botón ya está disabled

    let overrides: PedidoOverrides = {}
    if (conditionsChanged) {
      const cc = cliente as any
      if (metodo !== (cliente.metodo_facturacion || ""))       overrides.metodo_facturacion_pedido  = metodo
      if (listaId !== (cliente.lista_precio_id || ""))         overrides.lista_precio_pedido_id     = listaId
      if (listaLimpieza !== (cc?.lista_limpieza_id || ""))     overrides.lista_limpieza_pedido_id   = listaLimpieza || undefined
      if (metodoLimpieza !== (cc?.metodo_limpieza || ""))      overrides.metodo_limpieza_pedido     = metodoLimpieza || undefined
      if (listaPerf0 !== (cc?.lista_perf0_id || ""))           overrides.lista_perf0_pedido_id      = listaPerf0 || undefined
      if (metodoPerf0 !== (cc?.metodo_perf0 || ""))            overrides.metodo_perf0_pedido        = metodoPerf0 || undefined
      if (listaPerfPlus !== (cc?.lista_perf_plus_id || ""))    overrides.lista_perf_plus_pedido_id  = listaPerfPlus || undefined
      if (metodoPerfPlus !== (cc?.metodo_perf_plus || ""))     overrides.metodo_perf_plus_pedido    = metodoPerfPlus || undefined

      if (saveMode === "permanent") {
        const upd: any = {}
        if (metodo !== (cliente.metodo_facturacion || ""))       upd.metodo_facturacion  = metodo
        if (listaId !== (cliente.lista_precio_id || ""))         upd.lista_precio_id     = listaId || null
        if (listaLimpieza !== (cc?.lista_limpieza_id || ""))     upd.lista_limpieza_id   = listaLimpieza || null
        if (metodoLimpieza !== (cc?.metodo_limpieza || ""))      upd.metodo_limpieza     = metodoLimpieza || null
        if (listaPerf0 !== (cc?.lista_perf0_id || ""))           upd.lista_perf0_id      = listaPerf0 || null
        if (metodoPerf0 !== (cc?.metodo_perf0 || ""))            upd.metodo_perf0        = metodoPerf0 || null
        if (listaPerfPlus !== (cc?.lista_perf_plus_id || ""))    upd.lista_perf_plus_id  = listaPerfPlus || null
        if (metodoPerfPlus !== (cc?.metodo_perf_plus || ""))     upd.metodo_perf_plus    = metodoPerfPlus || null
        if (Object.keys(upd).length > 0) {
          await sb.from("clientes").update(upd).eq("id", cliente.id)
        }
      }
    }

    onAddToQueue(cliente.id, clienteNombre, files, conditionsChanged ? overrides : undefined)
    reset()
    onOpenChange(false)
  }

  const canSubmit = !!cliente && files.length > 0 && (!conditionsChanged || !!saveMode)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Nuevo Pedido</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">

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
                    <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      onClick={() => setFiles(p => p.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500 shrink-0 ml-1"
                    >
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

            {/* Cliente seleccionado */}
            {cliente ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
                <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 leading-snug">{clienteNombre}</p>
                  {(cliente.codigo_cliente || cliente.direccion || cliente.localidad) && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                      {[cliente.codigo_cliente, cliente.direccion, cliente.localidad].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <button onClick={clearCliente} className="text-slate-400 hover:text-slate-600 shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
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
                {showDrop && results.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 border rounded-lg shadow-lg bg-background max-h-56 overflow-auto z-50">
                    {results.map(c => (
                      <div
                        key={c.id}
                        className="px-3 py-2.5 hover:bg-muted cursor-pointer border-b last:border-b-0"
                        onMouseDown={() => selectCliente(c)}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-sm font-medium leading-tight truncate">
                            {c.nombre_razon_social || c.razon_social}
                          </span>
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

          {/* ── Condiciones (solo si hay cliente) ─────────────────────────── */}
          {cliente && (
            <div>
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
                Condiciones del pedido
              </Label>

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <Label className="text-xs text-slate-600 mb-1 block">Facturación</Label>
                  <Select value={metodo || "__none__"} onValueChange={v => setMetodo(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-9 text-sm w-full">
                      <SelectValue placeholder="Sin definir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin definir</SelectItem>
                      {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0">
                  <Label className="text-xs text-slate-600 mb-1 block">Lista de precio</Label>
                  <Select value={listaId || "__none__"} onValueChange={v => setListaId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-9 text-sm w-full">
                      <SelectValue placeholder="Sin definir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin definir</SelectItem>
                      {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ── Listas por tipo de proveedor ──────────────────────────── */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowSegmentos(v => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {showSegmentos ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  LISTA SEGÚN TIPO DE PROVEEDOR
                </button>

                {showSegmentos && (
                  <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-200">
                    {/* LIMPIEZA / BAZAR */}
                    <SegmentoRow
                      label="LIMPIEZA / BAZAR"
                      lista={listaLimpieza} onLista={setListaLimpieza}
                      metodoSeg={metodoLimpieza} onMetodo={setMetodoLimpieza}
                      listas={listas}
                    />
                    {/* PERFUMERÍA 0 */}
                    <SegmentoRow
                      label="PERFUMERÍA 0"
                      lista={listaPerf0} onLista={setListaPerf0}
                      metodoSeg={metodoPerf0} onMetodo={setMetodoPerf0}
                      listas={listas}
                    />
                    {/* PERFUMERÍA + */}
                    <SegmentoRow
                      label="PERFUMERÍA +"
                      lista={listaPerfPlus} onLista={setListaPerfPlus}
                      metodoSeg={metodoPerfPlus} onMetodo={setMetodoPerfPlus}
                      listas={listas}
                    />
                  </div>
                )}
              </div>

              {conditionsChanged && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
                  <p className="text-xs text-amber-700 font-semibold mb-2">
                    Cambiaste las condiciones — ¿cómo aplicar?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSaveMode("temp")}
                      className={`flex-1 py-2 rounded border text-xs font-medium transition-all ${
                        saveMode === "temp"
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                      }`}
                    >
                      Solo este pedido
                    </button>
                    <button
                      onClick={() => setSaveMode("permanent")}
                      className={`flex-1 py-2 rounded border text-xs font-medium transition-all ${
                        saveMode === "permanent"
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
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

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="flex gap-2 pt-5 border-t mt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { reset(); onOpenChange(false) }}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            <Plus className="h-4 w-4" />
            Agregar a Cola
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
