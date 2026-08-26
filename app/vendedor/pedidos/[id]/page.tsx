"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { actualizarCantidadItem, eliminarItemPedido, softDeletePedido } from "@/lib/actions/pedidos"
import { esPedidoEditable, puedeEliminarPedido } from "@/lib/pedidos/estados"

interface DetalleItem {
  id: string
  articulo_id: string
  cantidad: number
  precio_final: number
  subtotal: number
  es_bonificado: boolean | null
  precio_lista?: number | null
  descuento_propio_pct?: number | null
  bonif_general_pct?: number | null
  bonif_viajante_pct?: number | null
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

// Cabecera de descuentos con datos reales (la arma /api/vendedor/pedidos/[id])
interface DescuentosPedido {
  segmentos: Array<{
    segmento: "limpieza_bazar" | "perf0" | "perf_plus"
    general: { pct: number; origen: string }
    viajante: { pct: number; origen: string }
    mercaderia: { pct: number; origen: string }
  }>
  condiciones: Array<{
    ambito: "marca" | "proveedor"
    origen: "pedido" | "ficha"
    nombre: string
    dto_general_pct: number
    dto_viajante_pct: number
    dto_mercaderia_pct: number
    metodo_facturacion: string | null
  }>
  solo_este_pedido: boolean
}

const SEG_LABEL: Record<string, string> = {
  limpieza_bazar: "Limpieza / Bazar",
  perf0: "Perfumería 0",
  perf_plus: "Perfumería plus",
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
function PedidoDetalleInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const pedidoId = params.id

  const [pedido, setPedido] = useState<PedidoDetalle | null>(null)
  const [comprobantes, setComprobantes] = useState<Array<{ id: string; tipo_comprobante: string; numero_comprobante: string; estado_pdf: string }>>([])
  const [remitos, setRemitos] = useState<Array<{ id: string; tipo_remito: string; numero_remito: string; estado_pdf: string }>>([])
  const [descuentos, setDescuentos] = useState<DescuentosPedido | null>(null)
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
      setComprobantes(d.comprobantes || [])
      setRemitos(d.remitos || [])
      setDescuentos(d.descuentos || null)
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

  // Misma regla que el ERP (lib/pedidos/estados.ts): en_venta / pendiente / impreso / en_preparacion
  const editable = !!pedido && esPedidoEditable(pedido.estado)
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

        {/* Descuentos aplicados: lo que REALMENTE tiene cada renglón, no lo que dice la ficha */}
        {descuentos && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Descuentos de este pedido</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${descuentos.solo_este_pedido ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                {descuentos.solo_este_pedido ? "solo este pedido" : "ficha del cliente"}
              </span>
            </div>
            <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              <span>Segmento</span>
              <span className="text-center">Gral.</span>
              <span className="text-center text-orange-600">Viaj.</span>
              <span className="text-center text-green-700">Merc.</span>
            </div>
            {descuentos.segmentos.map((s) => (
              <div key={s.segmento} className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 text-sm items-center">
                <span className="text-gray-700">{SEG_LABEL[s.segmento] || s.segmento}</span>
                <span className="text-center tabular-nums text-gray-600">{s.general.pct}%</span>
                <span className={`text-center tabular-nums font-bold ${s.viajante.origen === "pedido" ? "text-amber-700" : "text-orange-600"}`}>{s.viajante.pct}%</span>
                <span className={`text-center tabular-nums font-bold ${s.mercaderia.origen === "pedido" ? "text-amber-700" : "text-green-700"}`}>{s.mercaderia.pct}%</span>
              </div>
            ))}
            {descuentos.condiciones.length > 0 && (
              <div className="pt-2 border-t border-gray-100 space-y-1">
                {descuentos.condiciones.map((c) => (
                  <p key={`${c.ambito}:${c.nombre}`} className="text-xs text-gray-600">
                    <span className="font-bold">{c.nombre}</span>
                    <span className="text-gray-400"> ({c.ambito}{c.origen === "pedido" ? ", solo este pedido" : ""})</span>
                    {" · "}gral. {c.dto_general_pct}% · viaj. {c.dto_viajante_pct}% · merc. {c.dto_mercaderia_pct}%
                  </p>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-400">Viajante y general ya están dentro del precio de cada artículo. Mercadería se entrega sin cargo.</p>
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
                  {(Number(i.descuento_propio_pct) > 0 || Number(i.bonif_general_pct) > 0 || Number(i.bonif_viajante_pct) > 0) && (
                    <p className="text-[11px] mt-0.5 text-gray-500">
                      {i.precio_lista ? `Lista ${formatCurrency(i.precio_lista)}` : ""}
                      {Number(i.descuento_propio_pct) > 0 ? ` · oferta −${Number(i.descuento_propio_pct)}%` : ""}
                      {Number(i.bonif_general_pct) > 0 ? ` · gral. −${Number(i.bonif_general_pct)}%` : ""}
                      {Number(i.bonif_viajante_pct) > 0 ? <span className="text-orange-600 font-bold"> · viajante −{Number(i.bonif_viajante_pct)}%</span> : ""}
                    </p>
                  )}
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

        {/* Comprobantes y remitos: PDFs congelados del pedido facturado */}
        {(comprobantes.length > 0 || remitos.length > 0) && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 px-1">
              Comprobantes y remitos
            </p>
            <div className="grid grid-cols-2 gap-2">
              {comprobantes.map((c) => (
                <button
                  key={c.id}
                  disabled={c.estado_pdf !== "generado"}
                  onClick={() => window.open(`/api/comprobantes-venta/${c.id}/pdf`, "_blank")}
                  className="bg-white rounded-xl border border-emerald-200 py-3 px-2 text-center active:scale-[0.97] disabled:opacity-50"
                >
                  <p className="text-xl">🧾</p>
                  <p className="text-xs font-bold text-emerald-700 mt-1">
                    {c.tipo_comprobante} {c.numero_comprobante}
                  </p>
                </button>
              ))}
              {remitos.map((r) => (
                <button
                  key={r.id}
                  disabled={r.estado_pdf !== "generado"}
                  onClick={() => window.open(`/api/remitos/${r.id}/pdf`, "_blank")}
                  className="bg-white rounded-xl border border-sky-200 py-3 px-2 text-center active:scale-[0.97] disabled:opacity-50"
                >
                  <p className="text-xl">📄</p>
                  <p className="text-xs font-bold text-sky-700 mt-1">
                    Remito {r.tipo_remito === "REM" ? "R" : "X"} {r.numero_remito}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Observaciones */}
        {pedido.observaciones && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wide mb-1">Observaciones</p>
            <p className="text-gray-800 text-sm whitespace-pre-wrap">{pedido.observaciones}</p>
          </div>
        )}

        {/* Eliminar */}
        {puedeEliminarPedido(pedido.estado) && (
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
