"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { agregarItemPedido, agregarItemBonificado, actualizarCantidadItem, eliminarItemPedido } from "@/lib/actions/pedidos"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Loader2, Plus, Trash2, Search, Package, Save, ChevronDown, ChevronRight } from "lucide-react"
import Link from "next/link"

const ESTADO_COLORS: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  en_preparacion: "bg-blue-100 text-blue-800 border-blue-300",
  facturado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  entregado: "bg-green-100 text-green-800 border-green-300",
  en_viaje: "bg-purple-100 text-purple-800 border-purple-300",
}

const ESTADOS_PEDIDO = [
  { value: "pendiente", label: "Pendiente" },
  { value: "en_preparacion", label: "En Preparación" },
  { value: "pendiente_facturacion", label: "Pendiente Facturación" },
  { value: "facturado", label: "Facturado" },
  { value: "listo_para_retirar", label: "Listo para Retirar" },
  { value: "listo_para_enviar", label: "Listo para Enviar" },
  { value: "en_viaje", label: "En Viaje" },
  { value: "entregado", label: "Entregado" },
]

export default function PedidoEditPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [pedido, setPedido] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [found, setFound] = useState<any[]>([])
  const [qty, setQty] = useState(1)
  const [saving, setSaving] = useState(false)
  const [savingBonif, setSavingBonif] = useState(false)
  const [savingHeader, setSavingHeader] = useState(false)
  const [bonifMercaderia, setBonifMercaderia] = useState<any[]>([])
  const [queryBonif, setQueryBonif] = useState("")
  const [foundBonif, setFoundBonif] = useState<any[]>([])
  const [qtyBonif, setQtyBonif] = useState(1)
  const [headerOpen, setHeaderOpen] = useState(true)
  const [listasPrecio, setListasPrecio] = useState<any[]>([])
  const [vendedores, setVendedores] = useState<any[]>([])
  const [headerForm, setHeaderForm] = useState({
    estado: "",
    metodo_facturacion_pedido: "",
    condicion_entrega: "",
    vendedor_id: "",
    lista_precio_pedido_id: "",
    lista_limpieza_pedido_id: "",
    metodo_limpieza_pedido: "",
    lista_perf0_pedido_id: "",
    metodo_perf0_pedido: "",
    lista_perf_plus_pedido_id: "",
    metodo_perf_plus_pedido: "",
    observaciones: "",
  })

  useEffect(() => { loadAll() }, [id])

  async function loadAll() {
    setLoading(true)
    const [pedRes, itemsRes, listasRes, vendRes] = await Promise.all([
      supabase.from("pedidos").select(`
        id, numero_pedido, fecha, estado, total, subtotal,
        metodo_facturacion_pedido, condicion_entrega, observaciones,
        lista_precio_pedido_id, lista_limpieza_pedido_id, metodo_limpieza_pedido,
        lista_perf0_pedido_id, metodo_perf0_pedido,
        lista_perf_plus_pedido_id, metodo_perf_plus_pedido,
        vendedor_id,
        clientes (nombre_razon_social, cuit, direccion, metodo_facturacion, lista_precio_id, condicion_entrega, vendedor_id, lista_limpieza_id, lista_perf0_id, lista_perf_plus_id),
        vendedores (nombre)
      `).eq("id", id).single(),
      supabase.from("pedidos_detalle").select(`
        id, cantidad, cantidad_preparada, estado_item, precio_base, precio_final, subtotal, es_bonificado,
        articulos (id, sku, descripcion, proveedores:proveedor_id (nombre))
      `).eq("pedido_id", id).order("created_at" as any),
      supabase.from("listas_precio").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre"),
    ])
    const p = pedRes.data as any
    setPedido(p)
    setItems(itemsRes.data || [])
    setListasPrecio(listasRes.data || [])
    setVendedores(vendRes.data || [])
    if (p?.cliente_id) {
      const { data: bonif } = await supabase
        .from("bonificaciones")
        .select("id, porcentaje, segmento")
        .eq("cliente_id", p.cliente_id)
        .eq("tipo", "mercaderia")
        .eq("activo", true)
      setBonifMercaderia(bonif || [])
    }
    if (p) {
      setHeaderForm({
        estado: p.estado || "pendiente",
        metodo_facturacion_pedido: p.metodo_facturacion_pedido || "",
        condicion_entrega: p.condicion_entrega || "",
        vendedor_id: p.vendedor_id || "",
        lista_precio_pedido_id: p.lista_precio_pedido_id || "",
        lista_limpieza_pedido_id: p.lista_limpieza_pedido_id || "",
        metodo_limpieza_pedido: p.metodo_limpieza_pedido || "",
        lista_perf0_pedido_id: p.lista_perf0_pedido_id || "",
        metodo_perf0_pedido: p.metodo_perf0_pedido || "",
        lista_perf_plus_pedido_id: p.lista_perf_plus_pedido_id || "",
        metodo_perf_plus_pedido: p.metodo_perf_plus_pedido || "",
        observaciones: p.observaciones || "",
      })
    }
    setLoading(false)
  }

  async function saveHeader() {
    setSavingHeader(true)
    try {
      const update: any = {
        estado: headerForm.estado,
        metodo_facturacion_pedido: headerForm.metodo_facturacion_pedido || null,
        condicion_entrega: headerForm.condicion_entrega || null,
        vendedor_id: headerForm.vendedor_id || null,
        lista_precio_pedido_id: headerForm.lista_precio_pedido_id || null,
        lista_limpieza_pedido_id: headerForm.lista_limpieza_pedido_id || null,
        metodo_limpieza_pedido: headerForm.metodo_limpieza_pedido || null,
        lista_perf0_pedido_id: headerForm.lista_perf0_pedido_id || null,
        metodo_perf0_pedido: headerForm.metodo_perf0_pedido || null,
        lista_perf_plus_pedido_id: headerForm.lista_perf_plus_pedido_id || null,
        metodo_perf_plus_pedido: headerForm.metodo_perf_plus_pedido || null,
        observaciones: headerForm.observaciones || null,
      }
      const { error } = await supabase.from("pedidos").update(update).eq("id", id)
      if (error) throw error
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al guardar encabezado")
    } finally {
      setSavingHeader(false)
    }
  }

  async function buscarProductos(q: string) {
    setQuery(q)
    if (q.length < 2) { setFound([]); return }
    const { searchProductos } = await import("@/lib/actions/productos")
    const res = await searchProductos(q)
    setFound(res || [])
  }

  async function agregarItem(producto: any) {
    setSaving(true)
    try {
      await agregarItemPedido(id, producto.id, qty)
      setQuery("")
      setFound([])
      setQty(1)
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al agregar artículo")
    } finally {
      setSaving(false)
    }
  }

  async function buscarProductosBonif(q: string) {
    setQueryBonif(q)
    if (q.length < 2) { setFoundBonif([]); return }
    const { searchProductos } = await import("@/lib/actions/productos")
    const res = await searchProductos(q)
    setFoundBonif(res || [])
  }

  async function agregarItemBonif(producto: any) {
    setSavingBonif(true)
    try {
      await agregarItemBonificado(id, producto.id, qtyBonif)
      setQueryBonif("")
      setFoundBonif([])
      setQtyBonif(1)
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al agregar artículo bonificado")
    } finally {
      setSavingBonif(false)
    }
  }

  async function actualizarCantidad(itemId: string, cantidad: number) {
    try {
      await actualizarCantidadItem(itemId, id, cantidad)
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, cantidad } : i))
    } catch (err: any) {
      alert(err.message || "Error al actualizar")
    }
  }

  async function eliminarItem(itemId: string, descripcion: string) {
    if (!confirm(`¿Quitar "${descripcion}" del pedido?`)) return
    try {
      await eliminarItemPedido(itemId, id)
      setItems(prev => prev.filter(i => i.id !== itemId))
    } catch (err: any) {
      alert(err.message || "Error al eliminar")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const estadoColor = ESTADO_COLORS[pedido?.estado] || "bg-slate-100 text-slate-700 border-slate-300"
  const totalItems = items.reduce((sum, i) => sum + (i.subtotal || 0), 0)

  const c = pedido?.clientes as any
  const listaName = (listId: string | null | undefined) => listasPrecio.find(lp => lp.id === listId)?.nombre || null
  const entregaLabel = (v: string | null | undefined) =>
    v === "retira_mostrador" ? "Retira en Mostrador" :
    v === "transporte" ? "Transporte" :
    v === "entregamos_nosotros" ? "Entregamos Nosotros" : null

  const defaultMetodo   = c?.metodo_facturacion || "—"
  const defaultLista    = listaName(c?.lista_precio_id) || "Sin lista"
  const defaultEntrega  = entregaLabel(c?.condicion_entrega) || "—"
  const defaultVendedor = vendedores.find(v => v.id === c?.vendedor_id)?.nombre || "Sin vendedor"
  const defaultLimpiezaLista = listaName(c?.lista_limpieza_id) || defaultLista
  const defaultPerf0Lista    = listaName(c?.lista_perf0_id)    || defaultLista
  const defaultPerfPlusLista = listaName(c?.lista_perf_plus_id) || defaultLista

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Pedido #{pedido?.numero_pedido}</h1>
              <p className="text-sm text-slate-500">
                {pedido?.clientes?.nombre_razon_social}
                {pedido?.vendedores?.nombre ? ` · ${pedido.vendedores.nombre}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${estadoColor}`}>
              {pedido?.estado}
            </span>
            <span className="text-xl font-bold text-slate-800">
              ${(pedido?.total || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* ─── Encabezado del pedido ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors"
            onClick={() => setHeaderOpen(o => !o)}
          >
            <h2 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Encabezado del pedido</h2>
            {headerOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          </button>

          {headerOpen && (
            <div className="border-t border-slate-100 px-5 py-5 space-y-5">

              {/* Row 1: Estado, Facturación, Entrega, Vendedor */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Estado</Label>
                  <Select value={headerForm.estado} onValueChange={(v) => setHeaderForm({ ...headerForm, estado: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ESTADOS_PEDIDO.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Facturación</Label>
                  <Select
                    value={headerForm.metodo_facturacion_pedido || "__heredar__"}
                    onValueChange={(v) => setHeaderForm({ ...headerForm, metodo_facturacion_pedido: v === "__heredar__" ? "" : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__heredar__">{defaultMetodo} (del cliente)</SelectItem>
                      <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                      <SelectItem value="Final">Final (Mixto)</SelectItem>
                      <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Condición de Entrega</Label>
                  <Select value={headerForm.condicion_entrega || "__heredar__"} onValueChange={(v) => setHeaderForm({ ...headerForm, condicion_entrega: v === "__heredar__" ? "" : v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__heredar__">{defaultEntrega} (del cliente)</SelectItem>
                      <SelectItem value="retira_mostrador">Retira en Mostrador</SelectItem>
                      <SelectItem value="transporte">Envío por Transporte</SelectItem>
                      <SelectItem value="entregamos_nosotros">Entregamos Nosotros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Vendedor</Label>
                  <Select value={headerForm.vendedor_id || "__none__"} onValueChange={(v) => setHeaderForm({ ...headerForm, vendedor_id: v === "__none__" ? "" : v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{defaultVendedor} (del cliente)</SelectItem>
                      {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2: Lista general */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <Label className="text-xs text-slate-500 mb-1 block">Lista de Precio General</Label>
                  <Select
                    value={headerForm.lista_precio_pedido_id || "__heredar__"}
                    onValueChange={(v) => setHeaderForm({ ...headerForm, lista_precio_pedido_id: v === "__heredar__" ? "" : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__heredar__">{defaultLista} (del cliente)</SelectItem>
                      {listasPrecio.map(lp => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs text-slate-500 mb-1 block">Observaciones</Label>
                  <Input
                    className="h-9"
                    value={headerForm.observaciones}
                    onChange={(e) => setHeaderForm({ ...headerForm, observaciones: e.target.value })}
                    placeholder="Notas internas del pedido..."
                  />
                </div>
              </div>

              {/* Row 3: Segmentos */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Condiciones por Segmento</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: "Limpieza / Bazar", listaKey: "lista_limpieza_pedido_id", metodoKey: "metodo_limpieza_pedido", defLista: defaultLimpiezaLista },
                    { label: "Perfumería Perf0",  listaKey: "lista_perf0_pedido_id",    metodoKey: "metodo_perf0_pedido",    defLista: defaultPerf0Lista },
                    { label: "Perfumería Plus",   listaKey: "lista_perf_plus_pedido_id", metodoKey: "metodo_perf_plus_pedido", defLista: defaultPerfPlusLista },
                  ].map(({ label, listaKey, metodoKey, defLista }) => (
                    <div key={listaKey} className="border rounded-lg p-3 bg-slate-50 space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{label}</p>
                      <Select
                        value={(headerForm as any)[metodoKey] || "__heredar__"}
                        onValueChange={(v) => setHeaderForm({ ...headerForm, [metodoKey]: v === "__heredar__" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__heredar__">{defaultMetodo} (general)</SelectItem>
                          <SelectItem value="Factura">Factura</SelectItem>
                          <SelectItem value="Final">Final</SelectItem>
                          <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={(headerForm as any)[listaKey] || "__heredar__"}
                        onValueChange={(v) => setHeaderForm({ ...headerForm, [listaKey]: v === "__heredar__" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__heredar__">{defLista} (general)</SelectItem>
                          {listasPrecio.map(lp => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button onClick={saveHeader} disabled={savingHeader} className="gap-2">
                  {savingHeader ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar encabezado
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Banner + sección artículos bonificados ─── */}
        {bonifMercaderia.length > 0 && (
          <>
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <Package className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Este cliente tiene mercadería bonificada</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Los artículos bonificados se agregan al precio de lista pero con descuento 100% — el cliente ve el precio real y la bonificación en el comprobante.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm">
              <h2 className="font-semibold text-amber-700 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                <Plus className="h-4 w-4 text-amber-600" />
                Artículos bonificados (mercadería)
              </h2>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Buscar artículo a bonificar..."
                    className="pl-9 h-10"
                    value={queryBonif}
                    onChange={(e) => buscarProductosBonif(e.target.value)}
                  />
                  {foundBonif.length > 0 && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[260px] overflow-auto">
                      {foundBonif.map((p: any) => (
                        <div key={p.id}
                          className="px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                          onClick={() => agregarItemBonif(p)}>
                          <div className="font-medium text-slate-800">{p.descripcion}</div>
                          <div className="text-xs text-slate-400 mt-0.5 font-mono">{p.sku}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={1} className="h-10 w-24 text-center font-semibold"
                    value={qtyBonif} onChange={(e) => setQtyBonif(parseInt(e.target.value) || 1)}
                  />
                  <span className="text-sm text-slate-400">uds.</span>
                </div>
                {savingBonif && <Loader2 className="h-5 w-5 animate-spin text-amber-600 self-center" />}
              </div>
            </div>
          </>
        )}

        {/* ─── Agregar artículo ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
            <Plus className="h-4 w-4 text-indigo-600" />
            Agregar artículo
          </h2>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por SKU, descripción..."
                className="pl-9 h-10"
                value={query}
                onChange={(e) => buscarProductos(e.target.value)}
              />
              {found.length > 0 && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[260px] overflow-auto">
                  {found.map((p: any) => (
                    <div key={p.id}
                      className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                      onClick={() => agregarItem(p)}>
                      <div className="font-medium text-slate-800">{p.descripcion}</div>
                      <div className="text-xs text-slate-400 mt-0.5 font-mono">{p.sku}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number" min={1} className="h-10 w-24 text-center font-semibold"
                value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)}
              />
              <span className="text-sm text-slate-400">uds.</span>
            </div>
            {saving && <Loader2 className="h-5 w-5 animate-spin text-indigo-600 self-center" />}
          </div>
        </div>

        {/* ─── Lista de artículos ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            <div className="col-span-5">Artículo</div>
            <div className="col-span-2 text-right">Precio Unit.</div>
            <div className="col-span-2 text-center">Cantidad</div>
            <div className="col-span-2 text-right">Subtotal</div>
            <div className="col-span-1"></div>
          </div>

          {items.length === 0 ? (
            <div className="py-16 text-center">
              <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">Sin artículos</p>
              <p className="text-slate-400 text-sm mt-1">Usá el buscador de arriba para agregar artículos</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const estadoItem = item.estado_item
                const barColor = estadoItem === "COMPLETO" ? "bg-green-500" :
                  estadoItem === "FALTANTE" ? "bg-red-500" :
                  estadoItem === "PARCIAL" ? "bg-orange-500" : "bg-yellow-400"
                const subtotalItem = (item.precio_final || 0) * (item.cantidad || 0)

                return (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center px-5 py-3 hover:bg-slate-50/50 transition-colors">
                    <div className="col-span-5 flex items-center gap-3 min-w-0">
                      <div className={`w-1 h-9 rounded-full shrink-0 ${barColor}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 text-sm leading-tight truncate">{item.articulos?.descripcion}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {item.articulos?.sku}
                          {item.articulos?.proveedores?.nombre ? ` · ${item.articulos.proveedores.nombre}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="col-span-2 text-right">
                      <p className="text-sm font-semibold text-slate-700">
                        ${(item.precio_final || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      {item.es_bonificado && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">BONIF</span>
                      )}
                    </div>

                    <div className="col-span-2 flex items-center justify-center gap-1">
                      <Input
                        type="number" min={1}
                        className="h-8 w-20 text-center font-semibold text-sm"
                        defaultValue={item.cantidad}
                        onBlur={(e) => {
                          const newQty = parseInt(e.target.value)
                          if (newQty !== item.cantidad && newQty > 0) actualizarCantidad(item.id, newQty)
                        }}
                      />
                      <span className="text-xs text-slate-400">u.</span>
                    </div>

                    <div className="col-span-2 text-right">
                      <p className="text-sm font-bold text-slate-800">
                        ${subtotalItem.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      {item.cantidad_preparada != null && item.cantidad_preparada > 0 && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          item.cantidad_preparada >= item.cantidad ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                        }`}>
                          {item.cantidad_preparada} prep.
                        </span>
                      )}
                    </div>

                    <div className="col-span-1 flex justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-300 hover:text-red-500 hover:bg-red-50"
                        onClick={() => eliminarItem(item.id, item.articulos?.descripcion || "artículo")}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Totales */}
          {items.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-800 text-white px-5 py-4">
              <div className="flex justify-between items-center">
                <div className="text-white/60 text-sm">
                  {items.length} artículo{items.length !== 1 ? "s" : ""}
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-xs">Total del pedido</p>
                  <p className="text-2xl font-bold">
                    ${(pedido?.total || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
