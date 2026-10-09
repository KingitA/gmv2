"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { previewPrecioArticulo, previewPreciosArticulos, createPedido, actualizarEncabezadoPedido } from "@/lib/actions/pedidos"
import { searchProductos } from "@/lib/actions/productos"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"
import { CondicionesPedidoPanel, useCondicionesPedido } from "@/components/pedidos/CondicionesPedidoPanel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowLeft, Search, Plus, Trash2, Loader2, ShoppingCart,
  ChevronDown, ChevronRight, User, Save, X,
} from "lucide-react"
import Link from "next/link"
import { moneda, formatCuit } from "@/lib/formato"
import { InputMonto } from "@/components/ui/input-monto"

type CartItem = {
  articuloId: string
  descripcion: string
  sku: string
  unidades_por_bulto: number
  cantidad: number
  precio: number
}

const ENTREGAS = [
  { value: "retira_mostrador",    label: "Retira en Mostrador"  },
  { value: "transporte",          label: "Envío por Transporte" },
  { value: "entregamos_nosotros", label: "Entregamos Nosotros"  },
]

// Alta manual de un pedido en el ERP. Las condiciones (lista, método, descuentos,
// contado, proveedor/marca, mercadería a regalar, "solo este pedido" o "a la
// ficha") salen del panel compartido con la importación y el mostrador.
export default function NuevoPedidoPage() {
  const router = useRouter()

  // ── Cliente ──────────────────────────────────────────────────────────────────
  const [clienteQ, setClienteQ]             = useState("")
  const [clienteResults, setClienteResults] = useState<any[]>([])
  const [cliente, setCliente]               = useState<any>(null)
  const [clienteOpen, setClienteOpen]       = useState(false)

  const cond = useCondicionesPedido(cliente?.id)
  const [condOpen, setCondOpen]   = useState(true)
  const [entrega, setEntrega]     = useState("")
  const [observaciones, setObservaciones] = useState("")

  // ── Artículos ────────────────────────────────────────────────────────────────
  const [artQ, setArtQ]                 = useState("")
  const [artFound, setArtFound]         = useState<any[]>([])
  const [selectedArt, setSelectedArt]   = useState<any>(null)
  const [selectedPreview, setSelectedPreview] = useState<{ precio: number; descripcion: string; sku: string; unidades_por_bulto: number } | null>(null)
  const [qty, setQty]                   = useState(1)
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [cart, setCart]                 = useState<CartItem[]>([])
  const [creating, setCreating]         = useState(false)

  // Búsquedas con debounce de 300 ms; el número de secuencia descarta respuestas viejas
  const cliTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cliSeq = useRef(0)
  const cancelarBusquedaCliente = () => { clearTimeout(cliTimer.current); cliSeq.current++ }

  const searchClientes = useCallback((q: string) => {
    setClienteQ(q)
    clearTimeout(cliTimer.current)
    const seq = ++cliSeq.current
    if (q.length < 2) { setClienteResults([]); setClienteOpen(false); return }
    cliTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => [])
      if (seq !== cliSeq.current) return
      setClienteResults(res || [])
      setClienteOpen(true)
    }, 300)
  }, [])

  const selectCliente = (c: any) => {
    cancelarBusquedaCliente()
    setCliente(c)
    setClienteQ(c.nombre_razon_social || c.razon_social || "")
    setClienteOpen(false)
    setEntrega(c.condicion_entrega || "")
    setCart([])
  }

  const clearCliente = () => {
    cancelarBusquedaCliente()
    setCliente(null)
    setClienteQ("")
    setCart([])
    setSelectedArt(null)
  }

  // Condiciones del pedido para el motor (precio mostrado = precio grabado)
  const overridesPrecio = () => cond.condiciones() as any

  // Re-cotizar el carrito cuando cambian las condiciones
  const firmaCond = JSON.stringify(cond.form ? cond.condiciones() : null)
  useEffect(() => {
    if (!cliente || !cart.length || cond.errorLista) return
    let vivo = true
    previewPreciosArticulos(cliente.id, cart.map(i => i.articuloId), overridesPrecio())
      .then(precios => {
        if (!vivo) return
        const m = new Map(precios.map(p => [p.articulo_id, p.precio]))
        setCart(prev => prev.map(i => (m.has(i.articuloId) ? { ...i, precio: m.get(i.articuloId)! } : i)))
      })
      .catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaCond, cliente?.id])

  const artTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const artSeq = useRef(0)
  const cancelarBusquedaArt = () => { clearTimeout(artTimer.current); artSeq.current++ }

  const buscarArticulos = useCallback((q: string) => {
    setArtQ(q)
    setSelectedArt(null)
    clearTimeout(artTimer.current)
    const seq = ++artSeq.current
    if (q.length < 2) { setArtFound([]); return }
    artTimer.current = setTimeout(async () => {
      const res = await searchProductos(q)
      if (seq !== artSeq.current) return
      setArtFound(res || [])
    }, 300)
  }, [])

  const seleccionarArticulo = async (art: any) => {
    cancelarBusquedaArt()
    setSelectedArt(art)
    setSelectedPreview(null)
    setArtFound([])
    setArtQ(art.descripcion)
    setQty(1)
    if (cond.errorLista) return
    setLoadingPrice(true)
    try {
      setSelectedPreview(await previewPrecioArticulo(cliente!.id, art.id, overridesPrecio()))
    } catch {
      // sin precio: se informa al agregar
    } finally {
      setLoadingPrice(false)
    }
  }

  const agregarAlCarrito = async () => {
    if (!selectedArt || !cliente) return
    if (cond.errorLista) { alert(cond.errorLista); return }
    let preview = selectedPreview
    if (!preview) {
      setLoadingPrice(true)
      try {
        preview = await previewPrecioArticulo(cliente.id, selectedArt.id, overridesPrecio())
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
    cancelarBusquedaArt()
    setArtFound([])
    setQty(1)
  }

  const quitarDelCarrito = (articuloId: string) => setCart(prev => prev.filter(i => i.articuloId !== articuloId))
  const cambiarCantidad = (articuloId: string, n: number) => {
    if (n <= 0) { quitarDelCarrito(articuloId); return }
    setCart(prev => prev.map(i => i.articuloId === articuloId ? { ...i, cantidad: n } : i))
  }

  const crearPedido = async () => {
    if (!cliente || cart.length === 0) return
    if (cond.bloqueo) { alert(cond.bloqueo); setCondOpen(true); return }
    setCreating(true)
    try {
      await cond.guardarFichaSiCorresponde()
      const pedido = await createPedido({
        cliente_id: cliente.id,
        items: cart.map(i => ({ producto_id: i.articuloId, cantidad: i.cantidad, precio_unitario: i.precio, descuento: 0 })),
        observaciones: observaciones || undefined,
        ...cond.condiciones(),
      })
      if (entrega && entrega !== cliente.condicion_entrega) {
        try { await actualizarEncabezadoPedido(pedido.id, { condicion_entrega: entrega }) } catch { /* se corrige en la ficha del pedido */ }
      }
      router.push(`/clientes-pedidos/${pedido.id}`)
    } catch (err: any) {
      alert(err.message || "Error al crear el pedido")
      setCreating(false)
    }
  }

  const subtotal = cart.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const nombreCliente = cliente?.nombre_razon_social || cliente?.razon_social || ""
  const conContado = !!cond.form && Object.values(cond.form.contado).some(Boolean)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/clientes-pedidos">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Nuevo Pedido</h1>
              {cliente && <p className="text-sm text-slate-500">{nombreCliente}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cart.length > 0 && <span className="text-2xl font-bold text-slate-800">{moneda(subtotal)}</span>}
            <Button onClick={crearPedido} disabled={!cliente || cart.length === 0 || creating || !!cond.bloqueo} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Crear pedido
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {/* ── Cliente ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 mb-4">
            <User className="h-4 w-4 text-indigo-600" />
            Cliente
          </h2>
          {cliente ? (
            <div className="flex items-start gap-3">
              <div className="flex-1 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
                <p className="font-semibold text-slate-800">{nombreCliente}</p>
                <p className="text-sm text-slate-500 mt-0.5">{[cliente.cuit && formatCuit(cliente.cuit), cliente.direccion, cliente.localidad].filter(Boolean).join(" · ")}</p>
                {cliente.condicion_iva && (
                  <span className="mt-2 inline-block px-2 py-0.5 bg-white border border-slate-200 rounded-full text-xs text-slate-600">{cliente.condicion_iva}</span>
                )}
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
                <div onMouseDown={e => e.preventDefault()} className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[280px] overflow-auto">
                  {clienteResults.map((c: any) => (
                    <div key={c.id} className="px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-0" onMouseDown={() => selectCliente(c)}>
                      <div className="font-medium text-slate-800">{c.nombre_razon_social || c.razon_social}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{[c.cuit && formatCuit(c.cuit), c.direccion, c.localidad].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Condiciones del pedido ── */}
        {cliente && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors" onClick={() => setCondOpen(o => !o)}>
              <span className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Condiciones del pedido</span>
              {condOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>
            {condOpen && (
              <div className="border-t border-slate-100 px-5 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Entrega</Label>
                    <Select value={entrega || "__none__"} onValueChange={v => setEntrega(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Del cliente" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Del cliente</SelectItem>
                        {ENTREGAS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Observaciones</Label>
                    <Input className="h-9" value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Notas internas del pedido..." />
                  </div>
                </div>
                <CondicionesPedidoPanel estado={cond} />
              </div>
            )}
          </div>
        )}

        {/* ── Artículos ── */}
        {cliente && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 mb-3">
                <ShoppingCart className="h-4 w-4 text-indigo-600" />
                Agregar artículos
              </h2>
              {cond.errorLista ? (
                <p className="text-sm text-red-700">{cond.errorLista}</p>
              ) : !selectedArt ? (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input className="pl-9 h-10" placeholder="Buscar artículo por SKU o descripción..." value={artQ} onChange={e => buscarArticulos(e.target.value)} />
                  {artFound.length > 0 && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[260px] overflow-auto">
                      {artFound.map((p: any) => (
                        <div key={p.id} className="px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors" onMouseDown={() => seleccionarArticulo(p)}>
                          <ArticuloResultRow articulo={p} size="sm" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5 flex items-center gap-4">
                    <div className="min-w-0 flex-1"><ArticuloResultRow articulo={selectedArt} size="sm" /></div>
                    <div className="shrink-0 text-right">
                      {loadingPrice ? (
                        <div className="flex items-center gap-1.5 text-indigo-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="text-xs">Calculando...</span></div>
                      ) : selectedPreview ? (
                        <div>
                          <p className="text-[11px] text-slate-400 leading-none mb-0.5">Precio unitario</p>
                          <p className="text-xl font-bold text-indigo-700 leading-none">{moneda(selectedPreview.precio)}</p>
                          {qty > 1 && <p className="text-xs text-slate-500 mt-0.5">= {moneda(selectedPreview.precio * qty)} × {qty} u.</p>}
                        </div>
                      ) : <p className="text-xs text-red-600">Sin precio</p>}
                    </div>
                  </div>
                  <button className="text-xs text-slate-400 hover:text-slate-600 shrink-0 underline" onClick={() => { setSelectedArt(null); setSelectedPreview(null); setArtQ(""); setQty(1) }}>Cambiar</button>
                  <InputMonto decimales={0} soloPositivos className="h-10 w-24 text-center font-bold text-lg shrink-0" value={qty}
                    onChange={n => setQty(Math.trunc(n ?? 0) || 1)} onKeyDown={e => { if (e.key === "Enter") agregarAlCarrito() }} autoFocus />
                  <span className="text-sm text-slate-500 shrink-0">uds.</span>
                  <Button size="sm" className="shrink-0 gap-1.5 bg-indigo-600 hover:bg-indigo-700" disabled={loadingPrice} onClick={agregarAlCarrito}>
                    <Plus className="h-4 w-4" />Agregar
                  </Button>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <>
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
                      <div className="col-span-2 text-right"><span className="text-sm font-semibold text-slate-700">{moneda(item.precio)}</span></div>
                      <div className="col-span-2 flex justify-center">
                        <InputMonto decimales={0} soloPositivos className="h-8 w-20 text-center font-semibold text-sm" value={item.cantidad}
                          onChange={n => cambiarCantidad(item.articuloId, Math.trunc(n ?? 0) || 1)}
                          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }} />
                      </div>
                      <div className="col-span-2 text-right"><span className="text-sm font-bold text-slate-800">{moneda(item.precio * item.cantidad)}</span></div>
                      <div className="col-span-1 flex justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-300 hover:text-red-500 hover:bg-red-50" onClick={() => quitarDelCarrito(item.articuloId)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 bg-slate-800 text-white px-5 py-5">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-white/60 text-sm">
                      <span>{cart.length} artículo{cart.length !== 1 ? "s" : ""} · {cart.reduce((s, i) => s + i.cantidad, 0)} unidades</span>
                      <span>{moneda(subtotal)}</span>
                    </div>
                    {conContado && (
                      <p className="text-xs text-emerald-300">
                        Sale de contado: el 10% no va en la factura, se emite una NC/REV aparte al facturar.
                      </p>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-white/10">
                      <span className="text-white/80 text-sm font-medium">Total</span>
                      <span className="text-2xl font-bold">{moneda(subtotal)}</span>
                    </div>
                  </div>
                  {cond.bloqueo && <p className="text-xs text-amber-300 mt-3">{cond.bloqueo}</p>}
                  <Button onClick={crearPedido} disabled={creating || !!cond.bloqueo} className="w-full mt-4 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold h-11 text-base gap-2">
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
