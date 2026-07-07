"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { actualizarCantidadItem, eliminarItemPedido, softDeletePedido } from "@/lib/actions/pedidos"

interface DetalleItem {
  id: string
  articulo_id: string
  cantidad: number
  precio_final: number
  subtotal: number
  es_bonificado: boolean | null
  articulos?: {
    id: string
    sku: string | null
    descripcion: string
    unidades_por_bulto: number | null
    imagen_url: string | null
  } | null
}

interface PedidoDetalle {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number | null
  observaciones: string | null
  metodo_facturacion_pedido: string | null
  cliente_id: string
  clientes?: { id: string; nombre: string; localidad: string | null; metodo_facturacion: string | null } | null
  pedidos_detalle: DetalleItem[]
}

const ESTADO_BADGE: Record<string, string> = {
  en_venta: "bg-amber-100 text-amber-700",
  pendiente: "bg-yellow-100 text-yellow-700",
  impreso: "bg-green-100 text-green-700",
  en_preparacion: "bg-blue-100 text-blue-700",
  en_viaje: "bg-purple-100 text-purple-700",
  facturado: "bg-emerald-100 text-emerald-700",
  entregado: "bg-emerald-100 text-emerald-700",
}

const ESTADO_LABEL: Record<string, string> = {
  en_venta: "EN VENTA",
  pendiente: "PENDIENTE",
  impreso: "IMPRESO",
  en_preparacion: "EN PREPARACIÓN",
  en_viaje: "EN VIAJE",
}

// El vendedor puede modificar el pedido mientras no entró al circuito de depósito
const ESTADOS_EDITABLES = new Set(["en_venta", "pendiente", "impreso"])

function PedidoDetalleInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const pedidoId = params.id

  const [pedido, setPedido] = useState<PedidoDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sync, setSync] = useState<"idle" | "saving" | "error">("idle")
  const [eliminando, setEliminando] = useState(false)
  const cantTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/vendedor/pedidos/${pedidoId}`)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setPedido(d.pedido)
      setError(null)
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el pedido")
    } finally {
      setLoading(false)
    }
  }, [pedidoId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const editable = !!pedido && ESTADOS_EDITABLES.has(pedido.estado)
  const items = pedido?.pedidos_detalle || []
  const itemsVenta = items.filter((i) => !i.es_bonificado)
  const itemsBonif = items.filter((i) => i.es_bonificado)
  const total = itemsVenta.reduce((s, i) => s + (i.precio_final || 0) * i.cantidad, 0)

  const setCantidad = (item: DetalleItem, cantidad: number) => {
    if (cantidad < 1 || !pedido) return
    setPedido((prev) =>
      prev
        ? {
            ...prev,
            pedidos_detalle: prev.pedidos_detalle.map((i) =>
              i.id === item.id ? { ...i, cantidad, subtotal: (i.precio_final || 0) * cantidad } : i
            ),
          }
        : prev
    )
    const t = cantTimers.current.get(item.id)
    if (t) clearTimeout(t)
    cantTimers.current.set(
      item.id,
      setTimeout(async () => {
        cantTimers.current.delete(item.id)
        setSync("saving")
        try {
          await actualizarCantidadItem(item.id, pedido.id, cantidad)
          setSync("idle")
        } catch (e) {
          console.error("Error actualizando cantidad:", e)
          setSync("error")
          cargar()
        }
      }, 600)
    )
  }

  const quitar = async (item: DetalleItem) => {
    if (!pedido) return
    if (!confirm(`¿Quitar "${item.articulos?.descripcion || "el artículo"}" del pedido?`)) return
    setPedido((prev) =>
      prev ? { ...prev, pedidos_detalle: prev.pedidos_detalle.filter((i) => i.id !== item.id) } : prev
    )
    setSync("saving")
    try {
      await eliminarItemPedido(item.id, pedido.id)
      setSync("idle")
    } catch (e) {
      console.error("Error quitando ítem:", e)
      setSync("error")
      cargar()
    }
  }

  const eliminarPedido = async () => {
    if (!pedido || eliminando) return
    if (!confirm(`¿Eliminar el pedido ${pedido.numero_pedido ? `Nº ${pedido.numero_pedido}` : ""} completo?`)) return
    setEliminando(true)
    try {
      await softDeletePedido(pedido.id)
      router.push("/vendedor/pedidos")
    } catch (e: any) {
      alert(`No se pudo eliminar: ${e?.message || e}`)
      setEliminando(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !pedido) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center max-w-md w-full space-y-3">
          <p className="text-4xl">😕</p>
          <p className="text-gray-600">{error || "Pedido no encontrado"}</p>
          <button
            onClick={() => router.push("/vendedor/pedidos")}
            className="bg-emerald-600 text-white rounded-xl px-6 py-3 font-bold"
          >
            Volver a mis pedidos
          </button>
        </div>
      </div>
    )
  }

  const cliente = pedido.clientes

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/vendedor/pedidos")} className="text-2xl leading-none px-1">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{cliente?.nombre || "Pedido"}</h1>
            <p className="text-emerald-200 text-xs truncate">
              {pedido.numero_pedido ? `Pedido Nº ${pedido.numero_pedido} · ` : ""}
              {new Date(pedido.fecha + "T00:00:00").toLocaleDateString("es-AR", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          {sync !== "idle" ? (
            <span
              className={`text-[10px] px-2.5 py-1 rounded-full font-bold shrink-0 ${
                sync === "saving" ? "bg-emerald-600 text-emerald-100" : "bg-red-500 text-white"
              }`}
            >
              {sync === "saving" ? "Guardando…" : "⚠ Sin guardar"}
            </span>
          ) : (
            <span
              className={`text-[10px] px-2.5 py-1 rounded-full font-bold shrink-0 ${
                ESTADO_BADGE[pedido.estado] || "bg-gray-100 text-gray-600"
              }`}
            >
              {ESTADO_LABEL[pedido.estado] || pedido.estado.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Accesos al cliente */}
        {cliente && (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => router.push(`/vendedor/clientes/${cliente.id}`)}
              className="bg-white rounded-xl border border-gray-200 py-3 text-center active:scale-[0.97]"
            >
              <p className="text-xl">👤</p>
              <p className="text-xs font-bold text-gray-700 mt-1">Ficha</p>
            </button>
            <button
              onClick={() => router.push(`/vendedor/clientes/${cliente.id}/cobrar`)}
              className="bg-white rounded-xl border border-gray-200 py-3 text-center active:scale-[0.97]"
            >
              <p className="text-xl">💵</p>
              <p className="text-xs font-bold text-gray-700 mt-1">Cobrar</p>
            </button>
            <button
              onClick={() => router.push(`/vendedor/clientes/${cliente.id}/devolucion?pedido=${pedido.id}`)}
              className="bg-white rounded-xl border border-gray-200 py-3 text-center active:scale-[0.97]"
            >
              <p className="text-xl">↩️</p>
              <p className="text-xs font-bold text-gray-700 mt-1">Devolución</p>
            </button>
          </div>
        )}

        {!editable && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">
            Este pedido ya está {ESTADO_LABEL[pedido.estado]?.toLowerCase() || pedido.estado} y no se puede modificar
            desde acá.
          </div>
        )}

        {/* Items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Artículos ({itemsVenta.length})
            </p>
            {editable && cliente && (
              <button
                onClick={() => router.push(`/vendedor/pedido/nuevo?cliente=${cliente.id}&pedido=${pedido.id}`)}
                className="text-emerald-700 text-sm font-bold"
              >
                ＋ Agregar artículos
              </button>
            )}
          </div>

          {itemsVenta.map((i) => (
            <div key={i.id} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 text-sm leading-snug">
                    {i.articulos?.descripcion || "Artículo"}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {i.articulos?.sku ? `SKU ${i.articulos.sku}` : ""}
                    {i.articulos?.unidades_por_bulto ? ` · ${i.articulos.unidades_por_bulto} u/bulto` : ""}
                  </p>
                </div>
                {editable && (
                  <button onClick={() => quitar(i)} className="text-red-500 text-xl leading-none px-1">
                    ✕
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                {editable ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCantidad(i, Math.max(1, i.cantidad - 1))}
                      className="w-10 h-10 rounded-lg bg-gray-100 text-xl font-bold text-gray-700"
                    >
                      −
                    </button>
                    <span className="w-10 text-center font-bold text-lg">{i.cantidad}</span>
                    <button
                      onClick={() => setCantidad(i, i.cantidad + 1)}
                      className="w-10 h-10 rounded-lg bg-gray-100 text-xl font-bold text-gray-700"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <p className="text-gray-600 font-bold">× {i.cantidad}</p>
                )}
                <div className="text-right">
                  <p className="text-gray-400 text-xs">{formatCurrency(i.precio_final || 0)} c/u</p>
                  <p className="font-bold text-gray-900">{formatCurrency((i.precio_final || 0) * i.cantidad)}</p>
                </div>
              </div>
            </div>
          ))}

          {itemsBonif.length > 0 && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 px-1 pt-2">
                Mercadería bonificada
              </p>
              {itemsBonif.map((i) => (
                <div key={i.id} className="bg-amber-50 rounded-xl border border-amber-200 p-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 text-sm leading-snug">
                      {i.articulos?.descripcion || "Artículo"}
                    </p>
                    <p className="text-amber-700 text-xs font-bold mt-0.5">BONIF · sin cargo</p>
                  </div>
                  <p className="text-gray-700 font-bold shrink-0 ml-3">× {i.cantidad}</p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Observaciones */}
        {pedido.observaciones && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wide mb-1">Observaciones</p>
            <p className="text-gray-800 text-sm whitespace-pre-wrap">{pedido.observaciones}</p>
          </div>
        )}

        {/* Eliminar */}
        {(pedido.estado === "pendiente" || pedido.estado === "en_venta") && (
          <button
            onClick={eliminarPedido}
            disabled={eliminando}
            className="w-full bg-white border border-red-200 text-red-600 rounded-xl py-3 font-bold disabled:opacity-50"
          >
            {eliminando ? "Eliminando..." : "Eliminar pedido"}
          </button>
        )}
      </div>

      {/* Total fijo */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-gray-500 text-lg">Total</span>
          <span className="font-bold text-2xl text-gray-900">{formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  )
}

export default function VendedorPedidoDetallePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PedidoDetalleInner />
    </Suspense>
  )
}
