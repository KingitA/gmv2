"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { previewPrecioArticulo, createPedido } from "@/lib/actions/pedidos"
import { searchProductos } from "@/lib/actions/productos"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowLeft, Search, Plus, Trash2, Loader2, ShoppingCart,
  ChevronDown, ChevronRight, User, Save, X,
} from "lucide-react"
import Link from "next/link"

type CartItem = {
  articuloId: string
  descripcion: string
  sku: string
  unidades_por_bulto: number
  cantidad: number
  precio: number
}

type Conditions = {
  metodo_facturacion_pedido: string
  lista_precio_pedido_id: string
  lista_limpieza_pedido_id: string
  metodo_limpieza_pedido: string
  lista_perf0_pedido_id: string
  metodo_perf0_pedido: string
  lista_perf_plus_pedido_id: string
  metodo_perf_plus_pedido: string
  condicion_entrega: string
  vendedor_id: string
  observaciones: string
}

const BLANK_COND: Conditions = {
  metodo_facturacion_pedido: "",
  lista_precio_pedido_id: "",
  lista_limpieza_pedido_id: "",
  metodo_limpieza_pedido: "",
  lista_perf0_pedido_id: "",
  metodo_perf0_pedido: "",
  lista_perf_plus_pedido_id: "",
  metodo_perf_plus_pedido: "",
  condicion_entrega: "",
  vendedor_id: "",
  observaciones: "",
}

type ProvCond = {
  proveedor_id: string
  lista_precio_id: string
  metodo_facturacion: string
  dto_general_pct: number
  dto_viajante_pct: number
  dto_mercaderia_pct: number
}
const BLANK_PROVCOND: ProvCond = {
  proveedor_id: "", lista_precio_id: "", metodo_facturacion: "",
  dto_general_pct: 0, dto_viajante_pct: 0, dto_mercaderia_pct: 0,
}

const METODOS = [
  { value: "Factura",      label: "Factura (21% IVA)" },
  { value: "Final",        label: "Final (Mixto)"      },
  { value: "Presupuesto",  label: "Presupuesto"        },
]

const ENTREGAS = [
  { value: "retira_mostrador",    label: "Retira en Mostrador"  },
  { value: "transporte",          label: "Envío por Transporte" },
  { value: "entregamos_nosotros", label: "Entregamos Nosotros"  },
]

const SEGMENTOS = [
  { label: "Limpieza / Bazar",  listaKey: "lista_limpieza_pedido_id", metodoKey: "metodo_limpieza_pedido" },
  { label: "Perfumería Perf0",  listaKey: "lista_perf0_pedido_id",    metodoKey: "metodo_perf0_pedido"    },
  { label: "Perfumería Plus",   listaKey: "lista_perf_plus_pedido_id", metodoKey: "metodo_perf_plus_pedido" },
]

export default function NuevoPedidoPage() {
  const router = useRouter()
  const sb = createClient()

  // ── Client search ────────────────────────────────────────────────────────────
  const [clienteQ, setClienteQ]         = useState("")
  const [clienteResults, setClienteResults] = useState<any[]>([])
  const [cliente, setCliente]           = useState<any>(null)
  const [clienteOpen, setClienteOpen]   = useState(false)

  // ── Billing conditions ───────────────────────────────────────────────────────
  const [cond, setCond]                 = useState<Conditions>({ ...BLANK_COND })
  const [condOpen, setCondOpen]         = useState(false)
  const [listas, setListas]             = useState<any[]>([])
  const [vendedores, setVendedores]     = useState<any[]>([])
  // Condiciones por proveedor (Feature 1) — para este pedido
  const [proveedores, setProveedores]   = useState<any[]>([])
  const [condProv, setCondProv]         = useState<ProvCond[]>([])
  const [newProvCond, setNewProvCond]   = useState<ProvCond>({ ...BLANK_PROVCOND })

  // ── Article search / add ─────────────────────────────────────────────────────
  const [artQ, setArtQ]                 = useState("")
  const [artFound, setArtFound]         = useState<any[]>([])
  const [selectedArt, setSelectedArt]   = useState<any>(null)
  const [selectedPreview, setSelectedPreview] = useState<{ precio: number; descripcion: string; sku: string; unidades_por_bulto: number } | null>(null)
  const [qty, setQty]                   = useState(1)
  const [loadingPrice, setLoadingPrice] = useState(false)

  // ── Cart ────────────────────────────────────────────────────────────────────
  const [cart, setCart]                 = useState<CartItem[]>([])
  const [condicionPago, setCondicionPago] = useState<"cuenta_corriente" | "contado">("cuenta_corriente")

  // ── Create ───────────────────────────────────────────────────────────────────
  const [creating, setCreating]         = useState(false)

  // ── Load listas + vendedores ─────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      sb.from("listas_precio").select("id,nombre").eq("activo", true).order("nombre"),
      sb.from("vendedores").select("id,nombre").eq("activo", true).order("nombre"),
      sb.from("proveedores").select("id,nombre").eq("activo", true).order("nombre"),
    ]).then(([{ data: l }, { data: v }, { data: p }]: any) => {
      if (l) setListas(l)
      if (v) setVendedores(v)
      if (p) setProveedores(p)
    })
  }, [])

  // ── Client search ────────────────────────────────────────────────────────────
  const searchClientes = useCallback(async (q: string) => {
    setClienteQ(q)
    if (q.length < 2) { setClienteResults([]); setClienteOpen(false); return }
    const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(q)}`).then(r => r.json())
    setClienteResults(res || [])
    setClienteOpen(true)
  }, [])

  const selectCliente = (c: any) => {
    setCliente(c)
    setClienteQ(c.nombre_razon_social || c.razon_social || "")
    setClienteOpen(false)
    setCond({
      ...BLANK_COND,
      metodo_facturacion_pedido: c.metodo_facturacion || "",
      lista_precio_pedido_id:    c.lista_precio_id    || "",
      lista_limpieza_pedido_id:  c.lista_limpieza_id  || "",
      metodo_limpieza_pedido:    c.metodo_limpieza     || "",
      lista_perf0_pedido_id:     c.lista_perf0_id     || "",
      metodo_perf0_pedido:       c.metodo_perf0       || "",
      lista_perf_plus_pedido_id: c.lista_perf_plus_id || "",
      metodo_perf_plus_pedido:   c.metodo_perf_plus   || "",
      condicion_entrega:         c.condicion_entrega   || "",
      vendedor_id:               c.vendedor_id         || "",
      observaciones: "",
    })
    setCart([])
    // Precargar condiciones por proveedor del cliente (Feature 1)
    sb.from("cliente_proveedor_condicion")
      .select("proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct")
      .eq("cliente_id", c.id)
      .then(({ data }: any) => setCondProv((data || []).map((r: any) => ({
        proveedor_id: r.proveedor_id,
        lista_precio_id: r.lista_precio_id || "",
        metodo_facturacion: r.metodo_facturacion || "",
        dto_general_pct: r.dto_general_pct || 0,
        dto_viajante_pct: r.dto_viajante_pct || 0,
        dto_mercaderia_pct: r.dto_mercaderia_pct || 0,
      }))))
  }

  const clearCliente = () => {
    setCliente(null)
    setClienteQ("")
    setCond({ ...BLANK_COND })
    setCondProv([])
    setCart([])
    setSelectedArt(null)
  }

  // ── Article search ────────────────────────────────────────────────────────────
  const buscarArticulos = useCallback(async (q: string) => {
    setArtQ(q)
    setSelectedArt(null)
    if (q.length < 2) { setArtFound([]); return }
    const res = await searchProductos(q)
    setArtFound(res || [])
  }, [])

  const seleccionarArticulo = async (art: any) => {
    setSelectedArt(art)
    setSelectedPreview(null)
    setArtFound([])
    setArtQ(art.descripcion)
    setQty(1)
    // Calcular precio inmediatamente al seleccionar
    setLoadingPrice(true)
    try {
      const preview = await previewPrecioArticulo(cliente!.id, art.id, buildOverrides())
      setSelectedPreview(preview)
    } catch {
      // si falla, se reintenta al agregar
    } finally {
      setLoadingPrice(false)
    }
  }

  const agregarAlCarrito = async () => {
    if (!selectedArt || !cliente) return
    let preview = selectedPreview
    if (!preview) {
      setLoadingPrice(true)
      try {
        preview = await previewPrecioArticulo(cliente.id, selectedArt.id, buildOverrides())
      } catch (err: any) {
        alert(err.message || "Error al calcular precio")
        setLoadingPrice(false)
        return
      } finally {
        setLoadingPrice(false)
      }
    }
    setCart(prev => {
      const idx = prev.findIndex(i => i.articuloId === selectedArt.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + qty }
        return updated
      }
      return [...prev, {
        articuloId: selectedArt.id,
        descripcion: preview!.descripcion || selectedArt.descripcion,
        sku: preview!.sku || selectedArt.sku,
        unidades_por_bulto: preview!.unidades_por_bulto,
        cantidad: qty,
        precio: preview!.precio,
      }]
    })
    setSelectedArt(null)
    setSelectedPreview(null)
    setArtQ("")
    setArtFound([])
    setQty(1)
  }

  const quitarDelCarrito = (articuloId: string) => {
    setCart(prev => prev.filter(i => i.articuloId !== articuloId))
  }

  const cambiarCantidad = (articuloId: string, nuevaCantidad: number) => {
    if (nuevaCantidad <= 0) { quitarDelCarrito(articuloId); return }
    setCart(prev => prev.map(i => i.articuloId === articuloId ? { ...i, cantidad: nuevaCantidad } : i))
  }

  function buildOverrides() {
    return {
      metodo_facturacion_pedido:    cond.metodo_facturacion_pedido    || undefined,
      lista_precio_pedido_id:       cond.lista_precio_pedido_id       || undefined,
      lista_limpieza_pedido_id:     cond.lista_limpieza_pedido_id     || undefined,
      metodo_limpieza_pedido:       cond.metodo_limpieza_pedido       || undefined,
      lista_perf0_pedido_id:        cond.lista_perf0_pedido_id        || undefined,
      metodo_perf0_pedido:          cond.metodo_perf0_pedido          || undefined,
      lista_perf_plus_pedido_id:    cond.lista_perf_plus_pedido_id    || undefined,
      metodo_perf_plus_pedido:      cond.metodo_perf_plus_pedido      || undefined,
      // Condiciones por proveedor (este pedido)
      condiciones_proveedor:        condProv.length ? condProv : undefined,
    }
  }

  const addProvCond = () => {
    if (!newProvCond.proveedor_id) { alert("Elegí un proveedor"); return }
    setCondProv(prev => {
      const idx = prev.findIndex(c => c.proveedor_id === newProvCond.proveedor_id)
      if (idx >= 0) { const u = [...prev]; u[idx] = { ...newProvCond }; return u }
      return [...prev, { ...newProvCond }]
    })
    setNewProvCond({ ...BLANK_PROVCOND })
  }
  const removeProvCond = (proveedorId: string) =>
    setCondProv(prev => prev.filter(c => c.proveedor_id !== proveedorId))
  const provNombre = (pid: string) => proveedores.find(p => p.id === pid)?.nombre || "—"

  const crearPedido = async () => {
    if (!cliente || cart.length === 0) return
    setCreating(true)
    try {
      const obs = [
        condicionPago === "contado" ? "PAGO CONTADO" : "",
        cond.observaciones,
      ].filter(Boolean).join(" · ")

      const pedido = await createPedido({
        cliente_id: cliente.id,
        items: cart.map(i => ({
          producto_id: i.articuloId,
          cantidad: i.cantidad,
          precio_unitario: i.precio,
          descuento: 0,
        })),
        observaciones: obs || undefined,
        condicion_entrega: cond.condicion_entrega || undefined,
        ...buildOverrides(),
      } as any)

      router.push(`/clientes-pedidos/${pedido.id}`)
    } catch (err: any) {
      alert(err.message || "Error al crear el pedido")
      setCreating(false)
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const dtoContado = condicionPago === "contado" ? subtotal * 0.10 : 0
  const total = subtotal - dtoContado

  const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const nombreCliente = cliente?.nombre_razon_social || cliente?.razon_social || ""

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/clientes-pedidos">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Nuevo Pedido — Mostrador</h1>
              {cliente && <p className="text-sm text-slate-500">{nombreCliente}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cart.length > 0 && (
              <span className="text-2xl font-bold text-slate-800">${fmt(total)}</span>
            )}
            <Button
              onClick={crearPedido}
              disabled={!cliente || cart.length === 0 || creating}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Crear pedido
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {/* ── Cliente ──────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 mb-4">
            <User className="h-4 w-4 text-indigo-600" />
            Cliente
          </h2>
          {cliente ? (
            <div className="flex items-start gap-3">
              <div className="flex-1 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
                <p className="font-semibold text-slate-800">{nombreCliente}</p>
                <p className="text-sm text-slate-500 mt-0.5">
                  {[cliente.cuit, cliente.direccion, cliente.localidad].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {cliente.metodo_facturacion && (
                    <span className="px-2 py-0.5 bg-white border border-indigo-200 rounded-full text-indigo-700 font-medium">
                      {cliente.metodo_facturacion}
                    </span>
                  )}
                  {cliente.condicion_iva && (
                    <span className="px-2 py-0.5 bg-white border border-slate-200 rounded-full text-slate-600">
                      {cliente.condicion_iva}
                    </span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={clearCliente} className="text-slate-400 hover:text-red-500">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9 h-10"
                placeholder="Buscar cliente por nombre, CUIT o código..."
                value={clienteQ}
                onChange={e => searchClientes(e.target.value)}
                onBlur={() => setTimeout(() => setClienteOpen(false), 150)}
                onFocus={() => { if (clienteResults.length) setClienteOpen(true) }}
              />
              {clienteOpen && clienteResults.length > 0 && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[280px] overflow-auto">
                  {clienteResults.map((c: any) => (
                    <div key={c.id}
                      className="px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-0"
                      onMouseDown={() => selectCliente(c)}>
                      <div className="font-medium text-slate-800">{c.nombre_razon_social || c.razon_social}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{[c.cuit, c.direccion, c.localidad].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Condiciones del pedido (expandible) ──────────────────────────────── */}
        {cliente && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors"
              onClick={() => setCondOpen(o => !o)}
            >
              <span className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Condiciones del pedido</span>
              {condOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>

            {condOpen && (
              <div className="border-t border-slate-100 px-5 py-5 space-y-4">
                {/* Fila 1: Facturación + Lista general + Entrega + Vendedor */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Facturación</Label>
                    <Select value={cond.metodo_facturacion_pedido || "__none__"}
                      onValueChange={v => setCond(p => ({ ...p, metodo_facturacion_pedido: v === "__none__" ? "" : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Del cliente" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Del cliente</SelectItem>
                        {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Lista de precio</Label>
                    <Select value={cond.lista_precio_pedido_id || "__none__"}
                      onValueChange={v => setCond(p => ({ ...p, lista_precio_pedido_id: v === "__none__" ? "" : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Del cliente" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Del cliente</SelectItem>
                        {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Entrega</Label>
                    <Select value={cond.condicion_entrega || "__none__"}
                      onValueChange={v => setCond(p => ({ ...p, condicion_entrega: v === "__none__" ? "" : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin definir" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sin definir</SelectItem>
                        {ENTREGAS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Vendedor</Label>
                    <Select value={cond.vendedor_id || "__none__"}
                      onValueChange={v => setCond(p => ({ ...p, vendedor_id: v === "__none__" ? "" : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Del cliente" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Del cliente</SelectItem>
                        {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Condiciones por segmento */}
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Condiciones por segmento</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {SEGMENTOS.map(seg => (
                      <div key={seg.listaKey} className="border rounded-lg p-3 bg-slate-50 space-y-2">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{seg.label}</p>
                        <Select value={(cond as any)[seg.metodoKey] || "__none__"}
                          onValueChange={v => setCond(p => ({ ...p, [seg.metodoKey]: v === "__none__" ? "" : v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="General" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">General</SelectItem>
                            {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={(cond as any)[seg.listaKey] || "__none__"}
                          onValueChange={v => setCond(p => ({ ...p, [seg.listaKey]: v === "__none__" ? "" : v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="General" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">General</SelectItem>
                            {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Condiciones por proveedor (este pedido) */}
                <div>
                  <p className="text-xs font-bold text-teal-600 uppercase tracking-wide mb-1">Condiciones por proveedor</p>
                  <p className="text-[11px] text-slate-500 mb-3">La mercadería de estos proveedores se factura aparte. Elegí la lista <b>Especial</b> para el precio especial del artículo.</p>
                  {condProv.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {condProv.map(c => (
                        <div key={c.proveedor_id} className="flex items-center justify-between gap-2 border border-teal-200 rounded-lg p-2 bg-teal-50/40 text-xs">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-700 truncate">{provNombre(c.proveedor_id)}</p>
                            <p className="text-slate-500">
                              {listas.find(l => l.id === c.lista_precio_id)?.nombre || "Lista del cliente"} · {c.metodo_facturacion || "Método del cliente"}
                              {c.dto_general_pct ? ` · Gral ${c.dto_general_pct}%` : ""}
                              {c.dto_viajante_pct ? ` · Viaj ${c.dto_viajante_pct}%` : ""}
                              {c.dto_mercaderia_pct ? ` · Merc ${c.dto_mercaderia_pct}%` : ""}
                            </p>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => removeProvCond(c.proveedor_id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Select value={newProvCond.proveedor_id || ""} onValueChange={v => setNewProvCond(p => ({ ...p, proveedor_id: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                        <SelectContent>
                          {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={newProvCond.lista_precio_id || "__none__"} onValueChange={v => setNewProvCond(p => ({ ...p, lista_precio_id: v === "__none__" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lista del cliente" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Lista del cliente</SelectItem>
                          {listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={newProvCond.metodo_facturacion || "__none__"} onValueChange={v => setNewProvCond(p => ({ ...p, metodo_facturacion: v === "__none__" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Método del cliente" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Método del cliente</SelectItem>
                          {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { key: "dto_general_pct",    label: "Gral %" },
                        { key: "dto_mercaderia_pct", label: "Merc %" },
                        { key: "dto_viajante_pct",   label: "Viaj %" },
                      ] as const).map(({ key, label }) => (
                        <div key={key}>
                          <Label className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</Label>
                          <Input type="number" step="0.01" min="0" max="100" className="h-8 text-xs text-center"
                            value={(newProvCond as any)[key]}
                            onChange={e => setNewProvCond(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))} />
                        </div>
                      ))}
                    </div>
                    <Button type="button" size="sm" className="w-full h-8 bg-teal-600 hover:bg-teal-700 text-white" onClick={addProvCond}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar condición de proveedor
                    </Button>
                  </div>
                </div>

                {/* Observaciones */}
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Observaciones</Label>
                  <Input className="h-9" value={cond.observaciones}
                    onChange={e => setCond(p => ({ ...p, observaciones: e.target.value }))}
                    placeholder="Notas internas del pedido..." />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Artículos ─────────────────────────────────────────────────────────── */}
        {cliente && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Buscador */}
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 mb-3">
                <ShoppingCart className="h-4 w-4 text-indigo-600" />
                Agregar artículos
              </h2>

              {!selectedArt ? (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    className="pl-9 h-10"
                    placeholder="Buscar artículo por SKU o descripción..."
                    value={artQ}
                    onChange={e => buscarArticulos(e.target.value)}
                    autoFocus={false}
                  />
                  {artFound.length > 0 && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[260px] overflow-auto">
                      {artFound.map((p: any) => (
                        <div key={p.id}
                          className="px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                          onMouseDown={() => seleccionarArticulo(p)}>
                          <div className="font-medium text-slate-800">{p.descripcion}</div>
                          <div className="text-xs text-slate-400 mt-0.5 font-mono">{p.sku}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {/* Info artículo + precio */}
                  <div className="flex-1 min-w-0 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-slate-800 leading-tight truncate">{selectedArt.descripcion}</p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedArt.sku}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {loadingPrice ? (
                        <div className="flex items-center gap-1.5 text-indigo-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span className="text-xs">Calculando...</span>
                        </div>
                      ) : selectedPreview ? (
                        <div>
                          <p className="text-[11px] text-slate-400 leading-none mb-0.5">Precio unitario</p>
                          <p className="text-xl font-bold text-indigo-700 leading-none">${fmt(selectedPreview.precio)}</p>
                          {qty > 1 && (
                            <p className="text-xs text-slate-500 mt-0.5">= ${fmt(selectedPreview.precio * qty)} × {qty} u.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <button className="text-xs text-slate-400 hover:text-slate-600 shrink-0 underline"
                    onClick={() => { setSelectedArt(null); setSelectedPreview(null); setArtQ(""); setQty(1) }}>
                    Cambiar
                  </button>
                  <Input
                    type="number" min={1}
                    className="h-10 w-24 text-center font-bold text-lg shrink-0"
                    value={qty}
                    onChange={e => setQty(parseInt(e.target.value) || 1)}
                    onKeyDown={e => { if (e.key === "Enter") agregarAlCarrito() }}
                    autoFocus
                  />
                  <span className="text-sm text-slate-500 shrink-0">uds.</span>
                  <Button size="sm" className="shrink-0 gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                    disabled={loadingPrice}
                    onClick={agregarAlCarrito}>
                    <Plus className="h-4 w-4" />
                    Agregar
                  </Button>
                </div>
              )}
            </div>

            {/* Tabla de items */}
            {cart.length > 0 && (
              <>
                {/* Header tabla */}
                <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  <div className="col-span-5">Artículo</div>
                  <div className="col-span-2 text-right">Precio unit.</div>
                  <div className="col-span-2 text-center">Cantidad</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                  <div className="col-span-1"></div>
                </div>

                <div className="divide-y divide-slate-100">
                  {cart.map(item => (
                    <div key={item.articuloId} className="grid grid-cols-12 gap-2 items-center px-5 py-3 hover:bg-slate-50/50">
                      <div className="col-span-5 min-w-0">
                        <p className="font-medium text-sm text-slate-800 leading-tight truncate">{item.descripcion}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{item.sku}</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-sm font-semibold text-slate-700">${fmt(item.precio)}</span>
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <Input
                          type="number" min={1}
                          className="h-8 w-20 text-center font-semibold text-sm"
                          value={item.cantidad}
                          onChange={e => cambiarCantidad(item.articuloId, parseInt(e.target.value) || 1)}
                          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }}
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-sm font-bold text-slate-800">${fmt(item.precio * item.cantidad)}</span>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-300 hover:text-red-500 hover:bg-red-50"
                          onClick={() => quitarDelCarrito(item.articuloId)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Panel de totales */}
                <div className="border-t border-slate-200 bg-slate-800 text-white px-5 py-5">
                  {/* Condición de pago */}
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
                    <span className="text-sm text-white/60">Condición de pago:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCondicionPago("cuenta_corriente")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          condicionPago === "cuenta_corriente"
                            ? "bg-white text-slate-800"
                            : "bg-white/10 text-white/60 hover:bg-white/20"
                        }`}
                      >
                        Cuenta corriente
                      </button>
                      <button
                        onClick={() => setCondicionPago("contado")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          condicionPago === "contado"
                            ? "bg-emerald-400 text-slate-900"
                            : "bg-white/10 text-white/60 hover:bg-white/20"
                        }`}
                      >
                        Contado (−10%)
                      </button>
                    </div>
                  </div>

                  {/* Resumen numérico */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-white/60 text-sm">
                      <span>{cart.length} artículo{cart.length !== 1 ? "s" : ""} · {cart.reduce((s, i) => s + i.cantidad, 0)} unidades</span>
                      <span>${fmt(subtotal)}</span>
                    </div>
                    {condicionPago === "contado" && (
                      <div className="flex justify-between items-center text-emerald-400 text-sm">
                        <span>Descuento contado (10%)</span>
                        <span>−${fmt(dtoContado)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-white/10">
                      <span className="text-white/80 text-sm font-medium">Total</span>
                      <span className="text-2xl font-bold">${fmt(total)}</span>
                    </div>
                  </div>

                  <Button
                    onClick={crearPedido}
                    disabled={creating}
                    className="w-full mt-4 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold h-11 text-base gap-2"
                  >
                    {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                    Crear pedido
                  </Button>
                </div>
              </>
            )}

            {cart.length === 0 && (
              <div className="py-16 text-center">
                <ShoppingCart className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Sin artículos</p>
                <p className="text-slate-400 text-sm mt-1">Buscá artículos arriba para agregarlos al pedido</p>
              </div>
            )}
          </div>
        )}

        {/* Placeholder antes de seleccionar cliente */}
        {!cliente && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm py-20 text-center">
            <User className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 font-medium text-lg">Seleccioná un cliente para comenzar</p>
            <p className="text-slate-400 text-sm mt-2">Buscá por nombre, CUIT o código en el campo de arriba</p>
          </div>
        )}

      </main>
    </div>
  )
}
