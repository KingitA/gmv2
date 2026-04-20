"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { agregarItemPedido, actualizarCantidadItem, eliminarItemPedido } from "@/lib/actions/pedidos"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Loader2, Plus, Trash2, Search, Package } from "lucide-react"
import Link from "next/link"

const ESTADO_COLORS: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  en_preparacion: "bg-blue-100 text-blue-800 border-blue-300",
  facturado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  entregado: "bg-green-100 text-green-800 border-green-300",
  en_viaje: "bg-purple-100 text-purple-800 border-purple-300",
}

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

  useEffect(() => { loadAll() }, [id])

  async function loadAll() {
    setLoading(true)
    const [pedRes, itemsRes] = await Promise.all([
      supabase.from("pedidos").select(`
        id, numero_pedido, fecha, estado, total, subtotal,
        clientes (nombre_razon_social, cuit, direccion),
        vendedores (nombre)
      `).eq("id", id).single(),
      supabase.from("pedidos_detalle").select(`
        id, cantidad, cantidad_preparada, estado_item, precio_base, precio_final, subtotal,
        articulos (id, sku, descripcion, proveedores:proveedor_id (nombre))
      `).eq("pedido_id", id),
    ])
    setPedido(pedRes.data)
    setItems(itemsRes.data || [])
    setLoading(false)
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Editar Pedido #{pedido?.numero_pedido}</h1>
              <p className="text-sm text-muted-foreground">
                {pedido?.clientes?.nombre_razon_social}
                {pedido?.vendedores?.nombre ? ` · ${pedido.vendedores.nombre}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${estadoColor}`}>
              {pedido?.estado}
            </span>
            <span className="text-lg font-bold text-slate-700">
              ${(pedido?.total || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="space-y-6">

          {/* Agregar artículo */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
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

          {/* Lista de artículos */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <Package className="h-4 w-4 text-slate-500" />
                Artículos del pedido
              </h2>
              <span className="text-sm text-slate-500">{items.length} artículo{items.length !== 1 ? "s" : ""}</span>
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

                  return (
                    <div key={item.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/50 transition-colors">
                      <div className={`w-1 h-10 rounded-full shrink-0 ${barColor}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 truncate">{item.articulos?.descripcion}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {item.articulos?.sku}
                          {item.articulos?.proveedores?.nombre ? ` · ${item.articulos.proveedores.nombre}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0 mr-2">
                        <p className="text-xs text-slate-400">Precio unit.</p>
                        <p className="text-sm font-semibold text-slate-700">
                          ${(item.precio_final || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Input
                          type="number" min={1}
                          className="h-9 w-20 text-center font-semibold text-base"
                          defaultValue={item.cantidad}
                          onBlur={(e) => {
                            const newQty = parseInt(e.target.value)
                            if (newQty !== item.cantidad && newQty > 0) actualizarCantidad(item.id, newQty)
                          }}
                        />
                        <span className="text-xs text-slate-400 w-6">u.</span>
                        {item.cantidad_preparada != null && item.cantidad_preparada > 0 && (
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            item.cantidad_preparada >= item.cantidad ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                          }`}>
                            {item.cantidad_preparada} prep.
                          </span>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300 hover:text-red-500 hover:bg-red-50"
                          onClick={() => eliminarItem(item.id, item.articulos?.descripcion || "artículo")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Totales */}
            {items.length > 0 && (
              <div className="px-5 py-4 border-t border-slate-200 bg-slate-800 text-white">
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Total del pedido</span>
                  <span className="text-2xl font-bold">
                    ${(pedido?.total || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}
