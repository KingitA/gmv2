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
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"

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

type LP = { id: string; nombre: string; codigo?: string }

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

  // Toggles independientes de segmentación (lista ya está en listaPorSegmento)
  const [segMetodo, setSegMetodo]         = useState(false)
  const [segDescuentos, setSegDescuentos] = useState(false)
  // Lista especial por proveedor (este pedido)
  const [specialProveedores, setSpecialProveedores] = useState<{ id: string; nombre: string }[]>([])
  const [condProvIds, setCondProvIds]     = useState<string[]>([])
  const [specialSearch, setSpecialSearch] = useState("")

  // Mercadería bonificada: artículos a regalar elegidos para este pedido
  const [mercArticulos, setMercArticulos] = useState<Array<{ id: string; descripcion: string; sku: string }>>([])
  const [mercQuery, setMercQuery]   = useState("")
  const [mercResults, setMercResults] = useState<any[]>([])

  // % de mercadería bonificada cargado en la grilla (cualquier segmento)
  const mercPct = Math.max(0, ...Object.entries(bonifGrid)
    .filter(([k]) => k.endsWith("__mercaderia"))
    .map(([, v]) => Number(v) || 0))

  const buscarMercArticulo = useCallback(async (term: string) => {
    setMercQuery(term)
    if (term.trim().length < 2) { setMercResults([]); return }
    const { searchProductos } = await import("@/lib/actions/productos")
    setMercResults((await searchProductos(term)) || [])
  }, [])

  const addMercArticulo = (p: any) => {
    setMercArticulos(prev => prev.some(a => a.id === p.id) ? prev : [...prev, { id: p.id, descripcion: p.descripcion || "", sku: p.sku || "" }])
    setMercQuery(""); setMercResults([])
  }
  const removeMercArticulo = (id: string) => setMercArticulos(prev => prev.filter(a => a.id !== id))

  const metodoPorSegmento = segMetodo
  const mostrarSegmentos  = segMetodo || listaPorSegmento || segDescuentos
  const especialLista = listas.find(l => l.codigo === "especial")

  // Cargar listas + proveedores con lista especial al abrir
  useEffect(() => {
    if (!open) return
    sb.from("listas_precio").select("id,nombre,codigo").eq("activo", true).order("nombre")
      .then(({ data }) => setListas(data || []))
    sb.from("articulos").select("proveedor_id, proveedores:proveedor_id(nombre)").not("precio_lista_especial", "is", null)
      .then(({ data }: any) => {
        const map = new Map<string, string>()
        for (const a of (data || [])) if (a.proveedor_id && a.proveedores?.nombre) map.set(a.proveedor_id, a.proveedores.nombre)
        setSpecialProveedores(Array.from(map, ([id, nombre]) => ({ id, nombre })).sort((x, y) => x.nombre.localeCompare(y.nombre)))
      })
  }, [open])

  // Inicializar condiciones cuando se selecciona cliente
  useEffect(() => {
    if (!cliente) { setBonifMercaderia([]); return }

    const c = cliente as any
    const ES_CENTINELA = (v?: string) => !!v && ["PorSegmento", "__por_segmento__", "porsegmento"].includes(v)
    setMetodo(c.metodo_facturacion && !ES_CENTINELA(c.metodo_facturacion) ? c.metodo_facturacion : "")
    setListaId(c.lista_precio_id || "")
    setSegMetodo(!!(c.metodo_limpieza || c.metodo_perf0 || c.metodo_perf_plus) || ES_CENTINELA(c.metodo_facturacion))
    setListaPorSegmento(!!(c.lista_limpieza_id || c.lista_perf0_id || c.lista_perf_plus_id))
    setListaLimpieza(c.lista_limpieza_id || "")
    setMetodoLimpieza(c.metodo_limpieza || "")
    setListaPerf0(c.lista_perf0_id || "")
    setMetodoPerf0(c.metodo_perf0 || "")
    setListaPerfPlus(c.lista_perf_plus_id || "")
    setMetodoPerfPlus(c.metodo_perf_plus || "")
    setSaveMode(null)

    // Listas especiales ya asignadas al cliente
    sb.from("cliente_proveedor_condicion").select("proveedor_id").eq("cliente_id", cliente.id)
      .then(({ data }: any) => setCondProvIds((data || []).map((r: any) => r.proveedor_id)))

    // Cargar bonificaciones del cliente
    sb.from("bonificaciones")
      .select("tipo, porcentaje, segmento")
      .eq("cliente_id", cliente.id)
      .eq("activo", true)
      .in("tipo", ["general", "mercaderia", "viajante"])
      .then(({ data }) => {
        const grid: Record<string, number> = {}
        let haySeg = false
        for (const b of (data || [])) {
          const segKey = b.segmento || "todos"
          grid[`${segKey}__${b.tipo}`] = b.porcentaje
          if (b.segmento) haySeg = true
        }
        setBonifGrid(grid)
        setBonifGridOriginal(grid)
        setSegDescuentos(haySeg)
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
    metodoPerfPlus !== (c?.metodo_perf_plus    || "") ||
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
    setMercArticulos([]); setMercQuery(""); setMercResults([])
    setSegMetodo(false); setSegDescuentos(false)
    setCondProvIds([]); setSpecialSearch("")
  }

  const handleSubmit = async () => {
    if (!cliente || files.length === 0) return
    if (conditionsChanged && !saveMode) return

    const SEGS = ["limpieza_bazar", "perf0", "perf_plus"]
    let overrides: PedidoOverrides = {}
    if (conditionsChanged) {
      // General: solo si la dimensión NO está segmentada
      if (!segMetodo && metodo) overrides.metodo_facturacion_pedido = metodo
      if (!listaPorSegmento && listaId) overrides.lista_precio_pedido_id = listaId
      // Por segmento: solo de la dimensión segmentada; vacío = heredar (no se manda)
      if (segMetodo) {
        if (metodoLimpieza) overrides.metodo_limpieza_pedido   = metodoLimpieza
        if (metodoPerf0)    overrides.metodo_perf0_pedido       = metodoPerf0
        if (metodoPerfPlus) overrides.metodo_perf_plus_pedido   = metodoPerfPlus
      }
      if (listaPorSegmento) {
        if (listaLimpieza)  overrides.lista_limpieza_pedido_id  = listaLimpieza
        if (listaPerf0)     overrides.lista_perf0_pedido_id     = listaPerf0
        if (listaPerfPlus)  overrides.lista_perf_plus_pedido_id = listaPerfPlus
      }

      // Descuentos: general (segmento null) o por segmento — aplican a este pedido
      {
        const bonifs: Array<{ tipo: string; segmento: string | null; porcentaje: number }> = []
        if (segDescuentos) {
          for (const seg of SEGS) for (const tipo of BONIF_TIPOS) {
            const pct = bonifGrid[`${seg}__${tipo.key}`] || 0
            if (pct > 0) bonifs.push({ tipo: tipo.key, segmento: seg, porcentaje: pct })
          }
        } else {
          for (const tipo of BONIF_TIPOS) {
            const pct = bonifGrid[`todos__${tipo.key}`] || 0
            if (pct > 0) bonifs.push({ tipo: tipo.key, segmento: null, porcentaje: pct })
          }
        }
        if (bonifs.length > 0) overrides.bonificaciones_pedido = bonifs
      }

      // Guardar al cliente (permanente): cada dimensión escribe solo lo que corresponde
      if (saveMode === "permanent") {
        const upd: any = {
          metodo_facturacion: !segMetodo ? (metodo || null) : null,
          lista_precio_id:    !listaPorSegmento ? (listaId || null) : null,
          metodo_limpieza:    segMetodo ? (metodoLimpieza || null) : null,
          metodo_perf0:       segMetodo ? (metodoPerf0 || null) : null,
          metodo_perf_plus:   segMetodo ? (metodoPerfPlus || null) : null,
          lista_limpieza_id:  listaPorSegmento ? (listaLimpieza || null) : null,
          lista_perf0_id:     listaPorSegmento ? (listaPerf0 || null) : null,
          lista_perf_plus_id: listaPorSegmento ? (listaPerfPlus || null) : null,
        }
        await sb.from("clientes").update(upd).eq("id", cliente.id)

        if (bonifChanged) {
          await sb.from("bonificaciones").delete()
            .eq("cliente_id", cliente.id).in("tipo", ["general", "mercaderia", "viajante"])
          const toInsert: any[] = []
          if (segDescuentos) {
            for (const seg of SEGS) for (const tipo of BONIF_TIPOS) {
              const pct = bonifGrid[`${seg}__${tipo.key}`] || 0
              if (pct > 0) toInsert.push({ cliente_id: cliente.id, tipo: tipo.key, porcentaje: pct, activo: true, segmento: seg })
            }
          } else {
            for (const tipo of BONIF_TIPOS) {
              const pct = bonifGrid[`todos__${tipo.key}`] || 0
              if (pct > 0) toInsert.push({ cliente_id: cliente.id, tipo: tipo.key, porcentaje: pct, activo: true, segmento: null })
            }
          }
          if (toInsert.length > 0) await sb.from("bonificaciones").insert(toInsert)
        }
      }
    }

    // Listas especiales por proveedor (este pedido)
    if (condProvIds.length > 0 && especialLista) {
      overrides.condiciones_proveedor = condProvIds.map(pid => ({
        proveedor_id: pid, lista_precio_id: especialLista.id, metodo_facturacion: "Factura",
        dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: null,
      }))
    }

    // Mercadería bonificada (artículos elegidos) — se pasa siempre que haya % y artículos,
    // independientemente de si cambiaron las condiciones.
    if (mercArticulos.length > 0 && mercPct > 0) {
      overrides.mercaderia_bonificada = { pct: mercPct, articulo_ids: mercArticulos.map(a => a.id) }
    }

    const hayOverrides = conditionsChanged || !!overrides.mercaderia_bonificada || !!overrides.condiciones_proveedor
    onAddToQueue(cliente.id, clienteNombre, files, hayOverrides ? overrides : undefined)
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
    <>
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
                      {[cliente.codigo_cliente, cliente.direccion, (cliente as any).localidad].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <button onClick={clearCliente} className="text-slate-400 hover:text-slate-600 shrink-0">
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

              {/* Toggles independientes: cada dimensión General o Por segmento */}
              {(() => {
                const metodoGeneralVal = metodo || (cliente as any)?.metodo_facturacion || "Final"
                const METODO_CORTO: Record<string, string> = { "Factura": "Factura", "Final": "Mixto", "Presupuesto": "Presupuesto" }
                const metodoHeredarLabel = `Del cliente (${METODO_CORTO[metodoGeneralVal] ?? metodoGeneralVal})`
                const listaGeneralNombre = listas.find(l => l.id === (listaId || (cliente as any)?.lista_precio_id))?.nombre ?? ""
                const listaHeredarLabel = listaGeneralNombre ? `Del cliente (${listaGeneralNombre})` : "Del cliente (sin lista asignada)"
                const SegToggle = ({ on, set }: { on: boolean; set: (b: boolean) => void }) => (
                  <div className="flex rounded-md border border-slate-300 overflow-hidden shrink-0 text-[11px]">
                    <button type="button" onClick={() => set(false)} className={`px-2 py-1.5 font-medium ${!on ? "bg-indigo-600 text-white" : "bg-white text-slate-500"}`}>General</button>
                    <button type="button" onClick={() => set(true)}  className={`px-2 py-1.5 font-medium ${on ? "bg-indigo-600 text-white" : "bg-white text-slate-500"}`}>Por segmento</button>
                  </div>
                )
                return (
                <div className="space-y-2.5">
                  {/* LISTA */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-600 w-20 shrink-0">Lista</Label>
                    {!listaPorSegmento ? (
                      <Select value={listaId || "__none__"} onValueChange={v => setListaId(v === "__none__" ? "" : v)}>
                        <SelectTrigger className="h-9 text-sm flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{listaHeredarLabel}</SelectItem>
                          {listas.filter(l => l.codigo !== "especial").map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <span className="flex-1 text-xs text-indigo-600 font-medium pl-1">Definida por segmento ↓</span>}
                    <SegToggle on={listaPorSegmento} set={setListaPorSegmento} />
                  </div>
                  {/* FACTURACIÓN */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-600 w-20 shrink-0">Facturación</Label>
                    {!segMetodo ? (
                      <Select value={metodo || "__none__"} onValueChange={v => setMetodo(v === "__none__" ? "" : v)}>
                        <SelectTrigger className="h-9 text-sm flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{metodoHeredarLabel}</SelectItem>
                          {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <span className="flex-1 text-xs text-indigo-600 font-medium pl-1">Definida por segmento ↓</span>}
                    <SegToggle on={segMetodo} set={setSegMetodo} />
                  </div>
                  {/* DESCUENTOS */}
                  <div className="flex items-start gap-2">
                    <Label className="text-xs text-slate-600 w-20 shrink-0 pt-2">Descuentos</Label>
                    {!segDescuentos ? (
                      <div className="flex-1 flex flex-wrap gap-2 items-center">
                        {BONIF_TIPOS.map(tipo => (
                          <div key={tipo.key} className="flex items-center gap-1">
                            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${tipo.cls}`}>{tipo.label}</span>
                            <Input type="number" step="0.01" min="0" max="100" className="h-6 w-14 text-center text-xs font-bold px-1"
                              value={bonifGrid[`todos__${tipo.key}`] || 0}
                              onChange={e => setBonifGrid(prev => ({ ...prev, [`todos__${tipo.key}`]: parseFloat(e.target.value) || 0 }))} />
                            <span className="text-[10px] text-slate-400">%</span>
                          </div>
                        ))}
                      </div>
                    ) : <span className="flex-1 text-xs text-indigo-600 font-medium pl-1 pt-2">Definidos por segmento ↓</span>}
                    <SegToggle on={segDescuentos} set={setSegDescuentos} />
                  </div>

                  {/* Grid por segmento — solo las dimensiones marcadas "Por segmento" */}
                  {mostrarSegmentos && (
                    <div className="border border-indigo-200 rounded-lg overflow-hidden bg-indigo-50/30">
                      <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest px-3 pt-2.5 pb-1">Condiciones por segmento</p>
                      <div className="divide-y divide-slate-200">
                        {SEGMENTOS.map(seg => (
                          <div key={seg.key} className="px-3 py-2.5 bg-white">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">{seg.label}</p>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              {segMetodo && (
                                <div>
                                  <Label className="text-[11px] text-slate-500 mb-1 block">Facturación</Label>
                                  <Select value={getSegValue(seg.metodoState) || "__heredar__"} onValueChange={v => setSegValue(seg.metodoState, v === "__heredar__" ? "" : v)}>
                                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__heredar__">{metodoHeredarLabel}</SelectItem>
                                      {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              {listaPorSegmento && (
                                <div>
                                  <Label className="text-[11px] text-slate-500 mb-1 block">Lista de precio</Label>
                                  <Select value={getSegValue(seg.listaState) || "__heredar__"} onValueChange={v => setSegValue(seg.listaState, v === "__heredar__" ? "" : v)}>
                                    <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__heredar__">{listaHeredarLabel}</SelectItem>
                                      {listas.filter(l => l.codigo !== "especial").map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                            {segDescuentos && (
                              <div className="border-t border-slate-100 pt-2 space-y-1">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Descuentos</p>
                                {BONIF_TIPOS.map(tipo => {
                                  const k = `${seg.key}__${tipo.key}`
                                  return (
                                    <div key={tipo.key} className="flex items-center justify-between">
                                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${tipo.cls}`}>{tipo.label}</span>
                                      <div className="flex items-center gap-1">
                                        <Input type="number" step="0.01" min="0" max="100" className="h-6 w-16 text-center text-xs font-bold px-1"
                                          value={bonifGrid[k] || 0}
                                          onChange={e => setBonifGrid(prev => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }))} />
                                        <span className="text-[10px] text-slate-400">%</span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                )
              })()}

              {/* Listas especiales por proveedor (este pedido) */}
              {specialProveedores.length > 0 && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/40 px-3 py-3 space-y-2">
                  <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">Listas especiales</p>
                  <p className="text-[11px] text-slate-500">La mercadería de estos proveedores se factura aparte (en factura) con su precio especial. El resto sigue la lista/segmento de arriba.</p>
                  {condProvIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {condProvIds.map(pid => (
                        <span key={pid} className="inline-flex items-center gap-1 text-[11px] bg-white border border-teal-300 text-teal-700 rounded-full pl-2.5 pr-1.5 py-0.5 font-semibold">
                          Especial {specialProveedores.find(p => p.id === pid)?.nombre ?? "—"}
                          <button type="button" onClick={() => setCondProvIds(prev => prev.filter(x => x !== pid))} className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <Input className="h-8 text-xs" placeholder="Buscar proveedor con lista especial (Colgate, Kenvue...)" value={specialSearch} onChange={e => setSpecialSearch(e.target.value)} />
                  <div className="max-h-36 overflow-auto space-y-1">
                    {specialProveedores
                      .filter(p => !condProvIds.includes(p.id))
                      .filter(p => !specialSearch || p.nombre.toLowerCase().includes(specialSearch.toLowerCase()))
                      .map(p => (
                        <button key={p.id} type="button" onClick={() => { setCondProvIds(prev => prev.includes(p.id) ? prev : [...prev, p.id]); setSpecialSearch("") }}
                          className="w-full text-left px-3 py-1.5 rounded hover:bg-teal-50 text-xs font-medium text-slate-700 flex items-center justify-between">
                          <span>Especial {p.nombre}</span><Plus className="h-3.5 w-3.5 text-teal-600" />
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Mercadería bonificada: elegir artículos a regalar (aparece si hay % de mercadería) */}
              {mercPct > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-3 space-y-2">
                  <p className="text-sm font-semibold text-green-800">
                    Mercadería bonificada ({mercPct}%)
                  </p>
                  <p className="text-[11px] text-green-700">
                    Elegí qué artículos regalar. Las cantidades se calculan por monto (% × neto del pedido,
                    repartido parejo) y se reajustan al preparar en depósito.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-500" />
                    <Input
                      placeholder="Buscar artículo a bonificar..."
                      className="pl-8 h-9 text-sm"
                      value={mercQuery}
                      onChange={e => buscarMercArticulo(e.target.value)}
                    />
                    {mercResults.length > 0 && (
                      <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 z-50 max-h-52 overflow-auto">
                        {mercResults.map((p: any) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => addMercArticulo(p)}
                            className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-slate-100 last:border-0"
                          >
                            <ArticuloResultRow articulo={p} size="sm" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {mercArticulos.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {mercArticulos.map(a => (
                        <span key={a.id} className="inline-flex items-center gap-1 text-[11px] bg-white border border-green-300 text-green-800 rounded px-2 py-0.5">
                          {a.descripcion}
                          <button type="button" onClick={() => removeMercArticulo(a.id)} className="text-green-500 hover:text-green-700">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5">
                      <span className="text-amber-600 text-sm leading-none">⚠</span>
                      <p className="text-[11px] font-medium text-amber-800">
                        Sin mercadería bonificada asignada — completá desde edición de pedido.
                      </p>
                    </div>
                  )}
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

        {/* ── Footer fijo ── */}
        <div className="px-6 pb-5 pt-3 shrink-0 border-t flex gap-2">
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

    </>
  )
}
