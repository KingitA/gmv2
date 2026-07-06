"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { ShoppingCart, PackageCheck, Undo2, Trash2, Search, Loader2, Printer } from "lucide-react"
import { searchProductos } from "@/lib/actions/productos"
import { previewPrecioArticulo } from "@/lib/actions/pedidos"
import { createClient as createSupabase } from "@/lib/supabase/client"

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })

interface ItemVenta {
  producto_id: string
  descripcion: string
  sku: string
  cantidad: number
  precio_unitario: number // preview del motor (el definitivo lo fija createPedido)
}

interface Metodo {
  tipo: "efectivo" | "transferencia" | "cheque"
  monto: number
}

export default function MostradorPage() {
  const { toast } = useToast()

  // ── Cliente ──
  const [clienteQuery, setClienteQuery] = useState("")
  const [clientes, setClientes] = useState<any[]>([])
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null)
  const clienteTimer = useRef<any>(null)

  // ── Venta ──
  const [prodQuery, setProdQuery] = useState("")
  const [productos, setProductos] = useState<any[]>([])
  const [buscandoProd, setBuscandoProd] = useState(false)
  const [items, setItems] = useState<ItemVenta[]>([])
  const [metodoTipo, setMetodoTipo] = useState<Metodo["tipo"]>("efectivo")
  const [vendiendo, setVendiendo] = useState(false)
  const [ultimaVenta, setUltimaVenta] = useState<any>(null)
  const prodTimer = useRef<any>(null)

  // ── Para retirar ──
  const [paraRetirar, setParaRetirar] = useState<any[]>([])
  const [cobrando, setCobrando] = useState<string | null>(null)

  // ── Devolución ──
  const [devItems, setDevItems] = useState<any[]>([])
  const [devQuery, setDevQuery] = useState("")
  const [devProductos, setDevProductos] = useState<any[]>([])
  const [devObs, setDevObs] = useState("")
  const [devolviendo, setDevolviendo] = useState(false)
  const devTimer = useRef<any>(null)

  const total = items.reduce((s, i) => s + i.precio_unitario * i.cantidad, 0)

  // ── Búsquedas ──
  useEffect(() => {
    if (clienteQuery.length < 2) { setClientes([]); return }
    clearTimeout(clienteTimer.current)
    clienteTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(clienteQuery)}`)
        const d = await res.json()
        setClientes(d.clientes || d || [])
      } catch { /* noop */ }
    }, 300)
  }, [clienteQuery])

  const buscarProductos = (q: string, setter: (r: any[]) => void, timer: any) => {
    clearTimeout(timer.current)
    if (q.length < 2) { setter([]); return }
    timer.current = setTimeout(async () => {
      setBuscandoProd(true)
      try {
        const r = await searchProductos(q)
        setter(r || [])
      } catch { /* noop */ } finally { setBuscandoProd(false) }
    }, 300)
  }

  useEffect(() => { buscarProductos(prodQuery, setProductos, prodTimer) }, [prodQuery])
  useEffect(() => { buscarProductos(devQuery, setDevProductos, devTimer) }, [devQuery])

  const cargarParaRetirar = useCallback(async () => {
    try {
      const res = await fetch("/api/mostrador/para-retirar")
      const d = await res.json()
      setParaRetirar(d.pedidos || [])
    } catch { /* noop */ }
  }, [])
  useEffect(() => { cargarParaRetirar() }, [cargarParaRetirar])

  // ── Agregar artículo con precio en vivo ──
  const agregarItem = async (prod: any) => {
    if (!cliente) {
      toast({ variant: "destructive", title: "Elegí el cliente primero" })
      return
    }
    setProdQuery("")
    setProductos([])
    if (items.some((i) => i.producto_id === prod.id)) {
      setItems((prev) => prev.map((i) => i.producto_id === prod.id ? { ...i, cantidad: i.cantidad + 1 } : i))
      return
    }
    let precio = Number(prod.precio_base || 0)
    try {
      const preview = await previewPrecioArticulo(cliente.id, prod.id)
      if (preview?.precio != null) precio = Number(preview.precio)
    } catch { /* usa precio_base */ }
    setItems((prev) => [...prev, {
      producto_id: prod.id,
      descripcion: prod.descripcion,
      sku: prod.sku,
      cantidad: 1,
      precio_unitario: precio,
    }])
  }

  // ── Facturar y cobrar ──
  const facturarYCobrar = async () => {
    if (!cliente || !items.length) return
    setVendiendo(true)
    setUltimaVenta(null)
    try {
      const res = await fetch("/api/mostrador/venta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: cliente.id,
          items: items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
          metodos: [{ tipo: metodoTipo, monto: total }],
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setUltimaVenta(d)
      setItems([])
      toast({ title: d.mensaje })
      cargarParaRetirar()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setVendiendo(false)
    }
  }

  // ── Cobrar pedido para retirar (efectivo) ──
  const cobrarPedido = async (pedido: any) => {
    setCobrando(pedido.id)
    try {
      const res = await fetch("/api/pagos-clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: pedido.cliente_id,
          metodos: [{ tipo: "efectivo", monto: pedido.saldo_total }],
          imputaciones: pedido.comprobantes
            .filter((c: any) => c.saldo > 0)
            .map((c: any) => ({ comprobante_id: c.id, monto_imputado: c.saldo })),
          observaciones: `Retiro mostrador ${pedido.numero_pedido}`,
          confirmar: true,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      // entregar el pedido
      const sb = createSupabase()
      await sb.from("pedidos").update({ estado: "entregado" }).eq("id", pedido.id)
      toast({ title: `Cobrado y entregado ${pedido.numero_pedido}`, description: d.numero_recibo ?? undefined })
      cargarParaRetirar()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setCobrando(null)
    }
  }

  // ── Devolución ──
  const registrarDevolucion = async () => {
    if (!cliente || !devItems.length) return
    setDevolviendo(true)
    try {
      const res = await fetch("/api/mostrador/devolucion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: cliente.id,
          items: devItems.map((i) => ({
            articulo_id: i.producto_id,
            cantidad: i.cantidad,
            precio_venta_original: i.precio_unitario,
            condicion: i.condicion,
          })),
          observaciones: devObs,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast({ title: d.numero_devolucion, description: d.mensaje })
      setDevItems([])
      setDevObs("")
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setDevolviendo(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Mostrador</h1>
            <p className="text-sm text-muted-foreground">Venta, retiro y devoluciones en mostrador</p>
          </div>
          {/* Cliente activo */}
          <div className="w-96 relative">
            {cliente ? (
              <div className="flex items-center justify-between border-2 border-primary/40 rounded-lg px-3 py-2 bg-primary/5">
                <span className="font-semibold truncate">{cliente.nombre}</span>
                <Button variant="ghost" size="sm" onClick={() => setCliente(null)}>Cambiar</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar cliente por nombre o CUIT..."
                    value={clienteQuery}
                    onChange={(e) => setClienteQuery(e.target.value)}
                  />
                </div>
                {clientes.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-background border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {clientes.map((c: any) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                        onClick={() => { setCliente({ id: c.id, nombre: c.nombre }); setClienteQuery(""); setClientes([]) }}
                      >
                        {c.nombre} {c.cuit ? <span className="text-muted-foreground">· {c.cuit}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6">
        <Tabs defaultValue="venta">
          <TabsList>
            <TabsTrigger value="venta"><ShoppingCart className="h-4 w-4 mr-2" /> Venta</TabsTrigger>
            <TabsTrigger value="retirar">
              <PackageCheck className="h-4 w-4 mr-2" /> Para retirar ({paraRetirar.length})
            </TabsTrigger>
            <TabsTrigger value="devolucion"><Undo2 className="h-4 w-4 mr-2" /> Devolución</TabsTrigger>
          </TabsList>

          {/* ══ VENTA ══ */}
          <TabsContent value="venta" className="mt-4 space-y-4">
            <div className="relative max-w-xl">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={cliente ? "Buscar artículo (SKU, descripción, EAN)..." : "Elegí el cliente primero"}
                value={prodQuery}
                disabled={!cliente}
                onChange={(e) => setProdQuery(e.target.value)}
              />
              {buscandoProd && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
              {productos.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-background border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {productos.slice(0, 12).map((p: any) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between"
                      onClick={() => agregarItem(p)}
                    >
                      <span className="truncate">{p.descripcion}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                Sin artículos. Buscá y agregá productos para la venta.
              </CardContent></Card>
            ) : (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  {items.map((i) => (
                    <div key={i.producto_id} className="flex items-center gap-3 border-b pb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{i.descripcion}</p>
                        <p className="text-xs text-muted-foreground">{i.sku} · {fmt(i.precio_unitario)} c/u</p>
                      </div>
                      <Input
                        type="number" min="1" className="w-20"
                        value={i.cantidad}
                        onChange={(e) => setItems((prev) => prev.map((x) =>
                          x.producto_id === i.producto_id ? { ...x, cantidad: Math.max(1, Number(e.target.value)) } : x))}
                      />
                      <span className="font-semibold w-28 text-right">{fmt(i.precio_unitario * i.cantidad)}</span>
                      <Button variant="ghost" size="icon" onClick={() => setItems((prev) => prev.filter((x) => x.producto_id !== i.producto_id))}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3">
                    <div className="flex items-center gap-3">
                      <Label>Método</Label>
                      <Select value={metodoTipo} onValueChange={(v) => setMetodoTipo(v as any)}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="efectivo">Efectivo (confirma ya)</SelectItem>
                          <SelectItem value="transferencia">Transferencia</SelectItem>
                          <SelectItem value="cheque">Cheque</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total estimado (el motor fija el final)</p>
                        <p className="text-2xl font-bold">{fmt(total)}</p>
                      </div>
                      <Button size="lg" onClick={facturarYCobrar} disabled={vendiendo}>
                        {vendiendo ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Facturar y cobrar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {ultimaVenta && (
              <Card className="border-green-300 bg-green-50/50">
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-green-800">
                      ✓ {ultimaVenta.mensaje} {ultimaVenta.numero_recibo && `· Recibo ${ultimaVenta.numero_recibo}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {ultimaVenta.comprobantes?.map((c: any) => `${c.tipo} ${c.numero}`).join(", ")} — {fmt(ultimaVenta.total_facturado)}
                    </p>
                  </div>
                  {ultimaVenta.comprobantes?.[0]?.pdf_url && (
                    <a href={ultimaVenta.comprobantes[0].pdf_url} target="_blank" rel="noreferrer">
                      <Button variant="outline"><Printer className="h-4 w-4 mr-2" /> Imprimir</Button>
                    </a>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ══ PARA RETIRAR ══ */}
          <TabsContent value="retirar" className="mt-4">
            {paraRetirar.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                No hay pedidos listos para retirar.
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {paraRetirar.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                    <div>
                      <p className="font-medium">
                        {p.numero_pedido} — {p.cliente}
                        {p.anticipado && <Badge variant="secondary" className="ml-2">Anticipado</Badge>}
                        {p.estado === "facturado" && <Badge variant="outline" className="ml-2">Facturado</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.comprobantes.map((c: any) => `${c.tipo} ${c.numero} (saldo ${fmt(c.saldo)})`).join(" · ") || "Sin comprobantes"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold">{fmt(p.saldo_total)}</span>
                      <Button
                        size="sm"
                        disabled={cobrando === p.id || p.saldo_total <= 0}
                        onClick={() => cobrarPedido(p)}
                      >
                        {cobrando === p.id ? "..." : p.saldo_total > 0 ? "Cobrar efectivo y entregar" : "Sin saldo"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ══ DEVOLUCIÓN ══ */}
          <TabsContent value="devolucion" className="mt-4 space-y-4">
            <div className="relative max-w-xl">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={cliente ? "Buscar artículo devuelto..." : "Elegí el cliente primero"}
                value={devQuery}
                disabled={!cliente}
                onChange={(e) => setDevQuery(e.target.value)}
              />
              {devProductos.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-background border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {devProductos.slice(0, 12).map((p: any) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between"
                      onClick={() => {
                        setDevQuery(""); setDevProductos([])
                        setDevItems((prev) => prev.some((x) => x.producto_id === p.id) ? prev : [...prev, {
                          producto_id: p.id, descripcion: p.descripcion, sku: p.sku,
                          cantidad: 1, precio_unitario: Number(p.precio_base || 0), condicion: "vendible",
                        }])
                      }}
                    >
                      <span className="truncate">{p.descripcion}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {devItems.length > 0 && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  {devItems.map((i) => (
                    <div key={i.producto_id} className="flex items-center gap-3 border-b pb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{i.descripcion}</p>
                        <p className="text-xs text-muted-foreground">{i.sku}</p>
                      </div>
                      <Input
                        type="number" min="1" className="w-20"
                        value={i.cantidad}
                        onChange={(e) => setDevItems((prev) => prev.map((x) =>
                          x.producto_id === i.producto_id ? { ...x, cantidad: Math.max(1, Number(e.target.value)) } : x))}
                      />
                      <Input
                        type="number" min="0" className="w-28" title="Precio venta original"
                        value={i.precio_unitario}
                        onChange={(e) => setDevItems((prev) => prev.map((x) =>
                          x.producto_id === i.producto_id ? { ...x, precio_unitario: Number(e.target.value) } : x))}
                      />
                      <Select
                        value={i.condicion}
                        onValueChange={(v) => setDevItems((prev) => prev.map((x) =>
                          x.producto_id === i.producto_id ? { ...x, condicion: v } : x))}
                      >
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vendible">Vendible</SelectItem>
                          <SelectItem value="dañado">Dañado</SelectItem>
                          <SelectItem value="vencido">Vencido</SelectItem>
                          <SelectItem value="cambio">Cambio</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setDevItems((prev) => prev.filter((x) => x.producto_id !== i.producto_id))}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 gap-4">
                    <Input
                      placeholder="Observaciones (opcional)"
                      value={devObs}
                      onChange={(e) => setDevObs(e.target.value)}
                    />
                    <Button onClick={registrarDevolucion} disabled={devolviendo}>
                      {devolviendo ? "Registrando..." : "Registrar devolución"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    La devolución queda pendiente: depósito confirma la mercadería y la NC se genera
                    desde Revisión de Devoluciones (se imputa sola contra la factura de origen).
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
