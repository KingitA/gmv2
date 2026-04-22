"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Plus, X, Search, Check, FileText, MapPin } from "lucide-react"
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
  { value: "Factura", label: "Factura (21% IVA)" },
  { value: "Final",   label: "Final (Mixto)"     },
  { value: "Presupuesto", label: "Presupuesto"   },
]

const BONIF_TIPOS = [
  { key: "general",    label: "General",    cls: "text-blue-700 bg-blue-50 border-blue-200" },
  { key: "mercaderia", label: "Mercadería", cls: "text-green-700 bg-green-50 border-green-200" },
  { key: "viajante",   label: "Viajante",   cls: "text-orange-700 bg-orange-50 border-orange-200" },
] as const

const SEGMENTOS = [
  { key: "limpieza_bazar", label: "LIMPIEZA / BAZAR",  listaState: "listaLimpieza",  metodoState: "metodoLimpieza"  },
  { key: "perf0",          label: "PERFUMERÍA PERF0",  listaState: "listaPerf0",     metodoState: "metodoPerf0"     },
  { key: "perf_plus",      label: "PERFUMERÍA PLUS",   listaState: "listaPerfPlus",  metodoState: "metodoPerfPlus"  },
] as const

export function NuevoPedidoDialog({ open, onOpenChange, onAddToQueue }: Props) {
  const sb = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [files, setFiles]           = useState<File[]>([])
  const [cliente, setCliente]       = useState<Cliente | null>(null)
  const [query, setQuery]           = useState("")
  const [results, setResults]       = useState<any[]>([])
  const [showDrop, setShowDrop]     = useState(false)
  const [listas, setListas]         = useState<LP[]>([])

  // Condición general
  const [metodo, setMetodo]         = useState("")
  const [listaId, setListaId]       = useState("")
  const [listaPorSegmento, setListaPorSegmento] = useState(false)

  // Condiciones por segmento
  const [listaLimpieza, setListaLimpieza]   = useState("")
  const [metodoLimpieza, setMetodoLimpieza] = useState("")
  const [listaPerf0, setListaPerf0]         = useState("")
  const [metodoPerf0, setMetodoPerf0]       = useState("")
  const [listaPerfPlus, setListaPerfPlus]   = useState("")
  const [metodoPerfPlus, setMetodoPerfPlus] = useState("")

  // Descuentos por segmento
  const [bonifGrid, setBonifGrid]               = useState<Record<string, number>>({})
  const [bonifGridOriginal, setBonifGridOriginal] = useState<Record<string, number>>({})

  const [saveMode, setSaveMode]     = useState<"temp" | "permanent" | null>(null)
  const [bonifMercaderia, setBonifMercaderia] = useState<any[]>([])

  const metodoPorSegmento = metodo === "PorSegmento"
  const mostrarSegmentos  = metodoPorSegmento || listaPorSegmento

  // Cargar listas al abrir
  useEffect(() => {
    if (!open) return
    sb.from("listas_precio").select("id,nombre").eq("activo", true).order("nombre")
      .then(({ data }) => setListas(data || []))
  }, [open])

  // Inicializar condiciones cuando se selecciona cliente
  useEffect(() => {
    if (!cliente) { setBonifMercaderia([]); return }

    const c = cliente as any
    setMetodo(c.metodo_facturacion || "")
    setListaId(c.lista_precio_id || "")
    setListaPorSegmento(!!(c.lista_limpieza_id || c.lista_perf0_id || c.lista_perf_plus_id))
    setListaLimpieza(c.lista_limpieza_id || "")
    setMetodoLimpieza(c.metodo_limpieza || "")
    setListaPerf0(c.lista_perf0_id || "")
    setMetodoPerf0(c.metodo_perf0 || "")
    setListaPerfPlus(c.lista_perf_plus_id || "")
    setMetodoPerfPlus(c.metodo_perf_plus || "")
    setSaveMode(null)

    // Cargar bonificaciones del cliente
    sb.from("bonificaciones")
      .select("tipo, porcentaje, segmento")
      .eq("cliente_id", cliente.id)
      .eq("activo", true)
      .in("tipo", ["general", "mercaderia", "viajante"])
      .then(({ data }) => {
        const grid: Record<string, number> = {}
        for (const b of (data || [])) {
          const segKey = b.segmento || "todos"
          grid[`${segKey}__${b.tipo}`] = b.porcentaje
        }
        setBonifGrid(grid)
        setBonifGridOriginal(grid)
      })

    // Alerta mercadería bonificada
    sb.from("bonificaciones")
      .select("porcentaje,segmento,observaciones")
      .eq("cliente_id", cliente.id)
      .eq("tipo", "mercaderia")
      .eq("activo", true)
      .then(({ data }) => setBonifMercaderia(data || []))
  }, [cliente])

  const c = cliente as any
  const bonifChanged = Object.keys({ ...bonifGrid, ...bonifGridOriginal }).some(
    k => (bonifGrid[k] || 0) !== (bonifGridOriginal[k] || 0)
  )
  const conditionsChanged = !!cliente && (
    metodo      !== (c?.metodo_facturacion  || "") ||
    (listaPorSegmento ? (c?.lista_precio_id || "") !== "" : listaId !== (c?.lista_precio_id || "")) ||
    listaLimpieza  !== (c?.lista_limpieza_id || "") ||
    metodoLimpieza !== (c?.metodo_limpieza   || "") ||
    listaPerf0     !== (c?.lista_perf0_id    || "") ||
    metodoPerf0    !== (c?.metodo_perf0      || "") ||
    listaPerfPlus  !== (c?.lista_perf_plus_id || "") ||
    metodoPerfPlus !== (c?.metodo_perf_plus  || "") ||
    bonifChanged
  )

  const clienteNombre = cliente?.nombre_razon_social || cliente?.razon_social || ""

  const handleFiles = useCallback((selected: FileList | null) => {
    if (!selected) return
    setFiles(prev => [...prev, ...Array.from(selected)])
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

  const clearCliente = () => {
    setCliente(null)
    setQuery("")
    setMetodo("")
    setListaId("")
    setListaPorSegmento(false)
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
    setListaPorSegmento(false)
    setListaLimpieza("")
    setMetodoLimpieza("")
    setListaPerf0("")
    setMetodoPerf0("")
    setListaPerfPlus("")
    setMetodoPerfPlus("")
    setBonifGrid({})
    setBonifGridOriginal({})
    setSaveMode(null)
    setBonifMercaderia([])
  }

  const handleSubmit = async () => {
    if (!cliente || files.length === 0) return
    if (conditionsChanged && !saveMode) return

    let overrides: PedidoOverrides = {}
    if (conditionsChanged) {
      if (metodo !== (c?.metodo_facturacion || ""))        overrides.metodo_facturacion_pedido = metodo || undefined
      if (!listaPorSegmento && listaId !== (c?.lista_precio_id || "")) overrides.lista_precio_pedido_id = listaId || undefined
      if (listaLimpieza  !== (c?.lista_limpieza_id || ""))  overrides.lista_limpieza_pedido_id  = listaLimpieza  || undefined
      if (metodoLimpieza !== (c?.metodo_limpieza   || ""))  overrides.metodo_limpieza_pedido    = metodoLimpieza || undefined
      if (listaPerf0     !== (c?.lista_perf0_id    || ""))  overrides.lista_perf0_pedido_id     = listaPerf0     || undefined
      if (metodoPerf0    !== (c?.metodo_perf0      || ""))  overrides.metodo_perf0_pedido       = metodoPerf0    || undefined
      if (listaPerfPlus  !== (c?.lista_perf_plus_id || "")) overrides.lista_perf_plus_pedido_id = listaPerfPlus  || undefined
      if (metodoPerfPlus !== (c?.metodo_perf_plus  || ""))  overrides.metodo_perf_plus_pedido   = metodoPerfPlus || undefined

      if (saveMode === "permanent") {
        const upd: any = {}
        if (metodo      !== (c?.metodo_facturacion  || ""))  upd.metodo_facturacion = metodo || null
        if (!listaPorSegmento && listaId !== (c?.lista_precio_id || ""))  upd.lista_precio_id = listaId || null
        if (listaLimpieza  !== (c?.lista_limpieza_id || "")) upd.lista_limpieza_id  = listaLimpieza  || null
        if (metodoLimpieza !== (c?.metodo_limpieza   || "")) upd.metodo_limpieza    = metodoLimpieza || null
        if (listaPerf0     !== (c?.lista_perf0_id    || "")) upd.lista_perf0_id     = listaPerf0     || null
        if (metodoPerf0    !== (c?.metodo_perf0      || "")) upd.metodo_perf0       = metodoPerf0    || null
        if (listaPerfPlus  !== (c?.lista_perf_plus_id || "")) upd.lista_perf_plus_id = listaPerfPlus || null
        if (metodoPerfPlus !== (c?.metodo_perf_plus  || "")) upd.metodo_perf_plus   = metodoPerfPlus || null
        if (Object.keys(upd).length > 0) await sb.from("clientes").update(upd).eq("id", cliente.id)

        // Guardar descuentos si cambiaron
        if (bonifChanged) {
          await sb.from("bonificaciones").delete()
            .eq("cliente_id", cliente.id).in("tipo", ["general", "mercaderia", "viajante"])
          const toInsert: any[] = []
          const segs = ["limpieza_bazar", "perf0", "perf_plus"]
          for (const seg of segs) {
            for (const tipo of BONIF_TIPOS) {
              const pct = bonifGrid[`${seg}__${tipo.key}`] || 0
              if (pct > 0) toInsert.push({ cliente_id: cliente.id, tipo: tipo.key, porcentaje: pct, activo: true, segmento: seg })
            }
          }
          if (toInsert.length > 0) await sb.from("bonificaciones").insert(toInsert)
        }
      }
    }

    onAddToQueue(cliente.id, clienteNombre, files, conditionsChanged ? overrides : undefined)
    reset()
    onOpenChange(false)
  }

  const canSubmit = !!cliente && files.length > 0 && (!conditionsChanged || !!saveMode)

  // Helpers para leer/escribir los estados de segmento por key
  const getSegValue = (stateKey: string): string => {
    if (stateKey === "listaLimpieza")  return listaLimpieza
    if (stateKey === "metodoLimpieza") return metodoLimpieza
    if (stateKey === "listaPerf0")     return listaPerf0
    if (stateKey === "metodoPerf0")    return metodoPerf0
    if (stateKey === "listaPerfPlus")  return listaPerfPlus
    if (stateKey === "metodoPerfPlus") return metodoPerfPlus
    return ""
  }
  const setSegValue = (stateKey: string, v: string) => {
    if (stateKey === "listaLimpieza")  setListaLimpieza(v)
    if (stateKey === "metodoLimpieza") setMetodoLimpieza(v)
    if (stateKey === "listaPerf0")     setListaPerf0(v)
    if (stateKey === "metodoPerf0")    setMetodoPerf0(v)
    if (stateKey === "listaPerfPlus")  setListaPerfPlus(v)
    if (stateKey === "metodoPerfPlus") setMetodoPerfPlus(v)
  }

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
                      {[cliente.codigo_cliente, cliente.direccion, (cliente as any).localidad].filter(Boolean).join(" · ")}
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
                  <div className="absolute top-full left-0 right-0 mt-1 border rounded-lg shadow-lg bg-background max-h-[420px] overflow-auto z-50">
                    {results.map(c => (
                      <div key={c.id} className="px-3 py-2.5 hover:bg-muted cursor-pointer border-b last:border-b-0" onMouseDown={() => selectCliente(c)}>
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

          {/* ── Alerta bonificación mercadería ────────────────────────────── */}
          {cliente && bonifMercaderia.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <span className="text-amber-600 text-base leading-none mt-0.5">⚠</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800">Este cliente tiene bonificación de mercadería activa</p>
                <ul className="mt-1 space-y-0.5">
                  {bonifMercaderia.map((b: any, i: number) => (
                    <li key={i} className="text-xs text-amber-700">
                      • {b.porcentaje}%{b.segmento ? ` (${b.segmento})` : ""}{b.observaciones ? ` — ${b.observaciones}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Condiciones (solo si hay cliente) ─────────────────────────── */}
          {cliente && (
            <div className="space-y-3">
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide block">
                Condiciones del pedido
              </Label>

              {/* Facturación + Lista */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">Facturación</Label>
                  <Select
                    value={metodo || "__none__"}
                    onValueChange={v => {
                      if (v === "PorSegmento") {
                        setMetodo("PorSegmento")
                      } else {
                        setMetodo(v === "__none__" ? "" : v)
                        setMetodoLimpieza("")
                        setMetodoPerf0("")
                        setMetodoPerfPlus("")
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="Sin definir" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin definir</SelectItem>
                      {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      <SelectItem value="PorSegmento">— Por Segmento —</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">Lista de precio</Label>
                  <Select
                    value={listaPorSegmento ? "__por_segmento__" : (listaId || "__none__")}
                    onValueChange={v => {
                      if (v === "__por_segmento__") {
                        setListaPorSegmento(true)
                        setListaId("")
                      } else {
                        setListaPorSegmento(false)
                        setListaId(v === "__none__" ? "" : v)
                        setListaLimpieza("")
                        setListaPerf0("")
                        setListaPerfPlus("")
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="Sin definir" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin definir</SelectItem>
                      {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                      <SelectItem value="__por_segmento__">— Por Segmento —</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Condiciones por segmento — aparece automáticamente */}
              {mostrarSegmentos && (
                <div className="border border-indigo-200 rounded-lg overflow-hidden bg-indigo-50/30">
                  <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest px-3 pt-2.5 pb-1">
                    Condiciones por segmento
                  </p>
                  <div className="divide-y divide-slate-200">
                    {SEGMENTOS.map(seg => (
                      <div key={seg.key} className="px-3 py-2.5 bg-white">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">{seg.label}</p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          {/* Método: solo si metodoPorSegmento */}
                          {metodoPorSegmento && (
                            <div>
                              <Label className="text-[11px] text-slate-500 mb-1 block">Facturación</Label>
                              <Select
                                value={getSegValue(seg.metodoState) || ""}
                                onValueChange={v => setSegValue(seg.metodoState, v)}
                              >
                                <SelectTrigger className="h-8 text-xs w-full">
                                  <SelectValue placeholder="Seleccionar *" />
                                </SelectTrigger>
                                <SelectContent>
                                  {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          {/* Lista: solo si listaPorSegmento */}
                          {listaPorSegmento && (
                            <div>
                              <Label className="text-[11px] text-slate-500 mb-1 block">Lista de precio</Label>
                              <Select
                                value={getSegValue(seg.listaState) || ""}
                                onValueChange={v => setSegValue(seg.listaState, v)}
                              >
                                <SelectTrigger className="h-8 text-xs w-full">
                                  <SelectValue placeholder="Seleccionar *" />
                                </SelectTrigger>
                                <SelectContent>
                                  {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>

                        {/* Descuentos del segmento */}
                        <div className="border-t border-slate-100 pt-2 space-y-1">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Descuentos</p>
                          {BONIF_TIPOS.map(tipo => {
                            const k = `${seg.key}__${tipo.key}`
                            return (
                              <div key={tipo.key} className="flex items-center justify-between">
                                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${tipo.cls}`}>{tipo.label}</span>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number" step="0.01" min="0" max="100"
                                    className="h-6 w-16 text-center text-xs font-bold px-1"
                                    value={bonifGrid[k] || 0}
                                    onChange={e => setBonifGrid(prev => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }))}
                                  />
                                  <span className="text-[10px] text-slate-400">%</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alerta de condiciones cambiadas */}
              {conditionsChanged && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
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
