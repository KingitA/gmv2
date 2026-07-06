"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { createPedido, previewPrecioArticulo } from "@/lib/actions/pedidos"

interface Articulo {
  id: string
  sku: string | null
  ean13: string | null
  descripcion: string
  unidades_por_bulto: number | null
  stock_disponible: number
  descuento_propio: number
  iva_ventas: string | null
  marca: string | null
  proveedor: string | null
  veces_pedido?: number
  cantidad_habitual?: number
}

interface ClienteSel {
  id: string
  nombre: string
  localidad: string | null
  metodo_facturacion: string | null
  saldo_actual?: number
}

interface CartItem {
  articulo: Articulo
  cantidad: number
  precio: number // al cliente
  precioNeto: number
}

const VISTAS = [
  { key: "habituales", label: "⭐ Habituales" },
  { key: "ofertas", label: "🏷️ Ofertas" },
  { key: "buscar", label: "🔍 Buscar" },
] as const

function NuevoPedidoInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clienteParam = searchParams.get("cliente")

  const [cliente, setCliente] = useState<ClienteSel | null>(null)
  const [clientes, setClientes] = useState<ClienteSel[]>([])
  const [qCliente, setQCliente] = useState("")

  const [vista, setVista] = useState<string>("habituales")
  const [q, setQ] = useState("")
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [cargandoArts, setCargandoArts] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [sel, setSel] = useState<Articulo | null>(null)
  const [selPrecio, setSelPrecio] = useState<{ precio: number; precioNeto: number } | null>(null)
  const [selCantidad, setSelCantidad] = useState(1)
  const [cargandoPrecio, setCargandoPrecio] = useState(false)

  const [cart, setCart] = useState<CartItem[]>([])
  const [verCarrito, setVerCarrito] = useState(false)
  const [obs, setObs] = useState("")
  const [metodoOverride, setMetodoOverride] = useState("")
  const [confirmando, setConfirmando] = useState(false)
  const [pedidoOk, setPedidoOk] = useState<{ numero: string } | null>(null)

  // ── Selección de cliente ────────────────────────────────────────────
  useEffect(() => {
    if (clienteParam) {
      fetch(`/api/vendedor/cliente/${clienteParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.error) setCliente(d.cliente)
        })
        .catch(() => {})
    }
  }, [clienteParam])

  useEffect(() => {
    if (!clienteParam) {
      fetch("/api/vendedor/clientes")
        .then((r) => r.json())
        .then((d) => !d.error && setClientes(d.clientes))
        .catch(() => {})
    }
  }, [clienteParam])

  // ── Carga de artículos según vista ──────────────────────────────────
  const cargarArticulos = useCallback(
    (v: string, term: string) => {
      if (!cliente) return
      if (v === "buscar" && !term) {
        setArticulos([])
        return
      }
      setCargandoArts(true)
      const params = new URLSearchParams({ vista: v, cliente: cliente.id })
      if (term) params.set("q", term)
      fetch(`/api/vendedor/articulos?${params}`)
        .then((r) => r.json())
        .then((d) => setArticulos(d.articulos || []))
        .catch(() => setArticulos([]))
        .finally(() => setCargandoArts(false))
    },
    [cliente]
  )

  useEffect(() => {
    if (cliente) cargarArticulos(vista, q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente])

  const cambiarVista = (v: string) => {
    setVista(v)
    cargarArticulos(v, q)
  }

  const onBuscar = (value: string) => {
    setQ(value)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => cargarArticulos("buscar", value), 400)
  }

  // ── Detalle de artículo + precio en vivo ────────────────────────────
  const abrirArticulo = async (a: Articulo) => {
    setSel(a)
    setSelCantidad(a.cantidad_habitual || 1)
    setSelPrecio(null)
    setCargandoPrecio(true)
    try {
      const p = await previewPrecioArticulo(cliente!.id, a.id, {})
      setSelPrecio({ precio: p.precio, precioNeto: p.precioNeto })
    } catch {
      setSelPrecio(null)
    } finally {
      setCargandoPrecio(false)
    }
  }

  const agregarAlCarrito = () => {
    if (!sel || !selPrecio || selCantidad <= 0) return
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.articulo.id === sel.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + selCantidad }
        return next
      }
      return [...prev, { articulo: sel, cantidad: selCantidad, precio: selPrecio.precio, precioNeto: selPrecio.precioNeto }]
    })
    setSel(null)
  }

  const total = cart.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const totalItems = cart.reduce((s, i) => s + i.cantidad, 0)

  const confirmarPedido = async () => {
    if (!cliente || !cart.length || confirmando) return
    setConfirmando(true)
    try {
      const pedido: any = await createPedido({
        cliente_id: cliente.id,
        items: cart.map((i) => ({
          producto_id: i.articulo.id,
          cantidad: i.cantidad,
          precio_unitario: i.precio,
          descuento: 0,
        })),
        observaciones: obs || undefined,
        ...(metodoOverride ? { metodo_facturacion_pedido: metodoOverride } : {}),
      })
      setPedidoOk({ numero: pedido?.numero_pedido || "" })
      setCart([])
      setVerCarrito(false)
    } catch (e: any) {
      alert(`Error al crear el pedido: ${e?.message || e}`)
    } finally {
      setConfirmando(false)
    }
  }

  // ── Pantalla éxito ──────────────────────────────────────────────────
  if (pedidoOk) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center max-w-md w-full space-y-4">
          <p className="text-6xl">✅</p>
          <h1 className="text-2xl font-bold text-gray-900">Pedido creado</h1>
          {pedidoOk.numero && <p className="text-gray-500 text-lg">N° {pedidoOk.numero}</p>}
          <div className="grid grid-cols-1 gap-3 pt-2">
            <button
              onClick={() => setPedidoOk(null)}
              className="bg-emerald-600 text-white rounded-xl px-6 py-4 text-lg font-bold"
            >
              Nuevo pedido para {cliente?.nombre}
            </button>
            <button
              onClick={() => router.push("/vendedor/pedidos")}
              className="bg-white border border-gray-300 text-gray-700 rounded-xl px-6 py-3 font-medium"
            >
              Ver mis pedidos
            </button>
            <button onClick={() => router.push("/vendedor")} className="text-gray-500 py-2">
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Selector de cliente ─────────────────────────────────────────────
  if (!cliente) {
    const filtrados = qCliente
      ? clientes.filter(
          (c) =>
            c.nombre.toLowerCase().includes(qCliente.toLowerCase()) ||
            (c.localidad || "").toLowerCase().includes(qCliente.toLowerCase())
        )
      : clientes
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
          <div className="px-5 py-3 flex items-center gap-3">
            <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
            <h1 className="text-xl font-bold">Nuevo pedido — Elegir cliente</h1>
          </div>
          <div className="px-4 pb-3">
            <input
              type="search"
              value={qCliente}
              onChange={(e) => setQCliente(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-xl px-4 py-3 text-gray-900 text-lg bg-white outline-none"
            />
          </div>
        </header>
        <div className="p-4 space-y-2 max-w-2xl mx-auto">
          {filtrados.map((c) => (
            <button
              key={c.id}
              onClick={() => router.replace(`/vendedor/pedido/nuevo?cliente=${c.id}`)}
              className="w-full bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-left active:scale-[0.98]"
            >
              <p className="font-bold text-gray-900">{c.nombre}</p>
              <p className="text-gray-500 text-sm">{c.localidad || "—"}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Pantalla principal de armado ────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{cliente.nombre}</h1>
            <p className="text-emerald-200 text-xs">
              {cliente.metodo_facturacion ? `Facturación: ${cliente.metodo_facturacion}` : "Nuevo pedido"}
            </p>
          </div>
        </div>
        <div className="px-4 pb-3 space-y-2">
          <div className="flex gap-2">
            {VISTAS.map((v) => (
              <button
                key={v.key}
                onClick={() => cambiarVista(v.key)}
                className={`flex-1 px-3 py-2 rounded-full text-sm font-medium ${
                  vista === v.key ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {vista === "buscar" && (
            <input
              type="search"
              value={q}
              onChange={(e) => onBuscar(e.target.value)}
              placeholder="Descripción, SKU o EAN..."
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-gray-900 text-lg bg-white outline-none"
            />
          )}
        </div>
      </header>

      <div className="p-4 space-y-2 max-w-2xl mx-auto">
        {cargandoArts ? (
          <div className="text-center py-10">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : articulos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
            {vista === "habituales"
              ? "Este cliente todavía no tiene artículos habituales."
              : vista === "ofertas"
                ? "No hay artículos en oferta."
                : q
                  ? "Sin resultados."
                  : "Escribí para buscar en el catálogo."}
          </div>
        ) : (
          articulos.map((a) => {
            const enCarrito = cart.find((i) => i.articulo.id === a.id)
            return (
              <button
                key={a.id}
                onClick={() => abrirArticulo(a)}
                className={`w-full bg-white rounded-xl shadow-sm border p-3 text-left active:scale-[0.98] ${
                  enCarrito ? "border-emerald-500 border-2" : "border-gray-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm leading-snug">{a.descripcion}</p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {[a.marca, a.proveedor].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {a.unidades_por_bulto ? `${a.unidades_por_bulto} u/bulto · ` : ""}
                      Stock: {a.stock_disponible}
                      {a.veces_pedido ? ` · pedido ${a.veces_pedido}×` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {a.descuento_propio > 0 && (
                      <span className="inline-block bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">
                        -{a.descuento_propio}%
                      </span>
                    )}
                    {enCarrito && (
                      <p className="text-emerald-700 font-bold text-sm mt-1">✓ {enCarrito.cantidad}</p>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Sheet de artículo */}
      {sel && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setSel(null)}>
          <div
            className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="font-bold text-gray-900 text-lg leading-snug">{sel.descripcion}</p>
              <p className="text-gray-500 text-sm mt-1">
                {[sel.marca, sel.proveedor].filter(Boolean).join(" · ")}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mt-2">
                {sel.sku && <span>SKU {sel.sku}</span>}
                {sel.ean13 && <span>EAN {sel.ean13}</span>}
                {sel.unidades_por_bulto ? <span>{sel.unidades_por_bulto} u/bulto</span> : null}
                <span className={sel.stock_disponible > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                  Stock: {sel.stock_disponible}
                </span>
                {sel.descuento_propio > 0 && (
                  <span className="text-red-600 font-bold">Oferta -{sel.descuento_propio}%</span>
                )}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-center">
              {cargandoPrecio ? (
                <div className="w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              ) : selPrecio ? (
                <>
                  <p className="text-3xl font-bold text-gray-900">{formatCurrency(selPrecio.precio)}</p>
                  {Math.abs(selPrecio.precio - selPrecio.precioNeto) > 0.01 ? (
                    <p className="text-gray-500 text-sm mt-1">
                      Neto {formatCurrency(selPrecio.precioNeto)} + IVA{" "}
                      {formatCurrency(selPrecio.precio - selPrecio.precioNeto)}
                    </p>
                  ) : (
                    <p className="text-gray-500 text-sm mt-1">IVA incluido</p>
                  )}
                </>
              ) : (
                <p className="text-red-500">No se pudo calcular el precio</p>
              )}
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setSelCantidad((c) => Math.max(1, c - 1))}
                className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={selCantidad}
                onChange={(e) => setSelCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 h-14 text-center text-2xl font-bold border border-gray-300 rounded-xl"
              />
              <button
                onClick={() => setSelCantidad((c) => c + 1)}
                className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700"
              >
                +
              </button>
              {sel.unidades_por_bulto ? (
                <button
                  onClick={() => setSelCantidad((c) => c + (sel.unidades_por_bulto || 0))}
                  className="h-14 px-4 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm"
                >
                  +bulto
                </button>
              ) : null}
            </div>

            {selPrecio && (
              <p className="text-center text-gray-500">
                Subtotal: <span className="font-bold text-gray-900">{formatCurrency(selPrecio.precio * selCantidad)}</span>
              </p>
            )}

            <button
              onClick={agregarAlCarrito}
              disabled={!selPrecio}
              className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
            >
              Agregar al pedido
            </button>
          </div>
        </div>
      )}

      {/* Barra de carrito */}
      {cart.length > 0 && !sel && (
        <div className="fixed bottom-0 inset-x-0 z-20 p-3">
          <button
            onClick={() => setVerCarrito(true)}
            className="w-full max-w-2xl mx-auto flex items-center justify-between bg-emerald-700 text-white rounded-2xl px-5 py-4 shadow-lg"
          >
            <span className="font-bold">🛒 {totalItems} ítems</span>
            <span className="text-xl font-bold">{formatCurrency(total)}</span>
            <span className="font-medium">Ver pedido →</span>
          </button>
        </div>
      )}

      {/* Carrito / confirmación */}
      {verCarrito && (
        <div className="fixed inset-0 z-40 bg-gray-50 overflow-y-auto">
          <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
            <button onClick={() => setVerCarrito(false)} className="text-2xl leading-none px-1">←</button>
            <div>
              <h1 className="text-lg font-bold">Confirmar pedido</h1>
              <p className="text-emerald-200 text-sm">{cliente.nombre}</p>
            </div>
          </header>
          <div className="p-4 space-y-4 max-w-2xl mx-auto pb-40">
            {cart.map((i, idx) => (
              <div key={i.articulo.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-gray-900 text-sm leading-snug flex-1">{i.articulo.descripcion}</p>
                  <button
                    onClick={() => setCart((prev) => prev.filter((_, j) => j !== idx))}
                    className="text-red-500 text-xl leading-none px-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setCart((prev) =>
                          prev.map((it, j) => (j === idx ? { ...it, cantidad: Math.max(1, it.cantidad - 1) } : it))
                        )
                      }
                      className="w-10 h-10 rounded-lg bg-gray-100 text-xl font-bold text-gray-700"
                    >
                      −
                    </button>
                    <span className="w-10 text-center font-bold text-lg">{i.cantidad}</span>
                    <button
                      onClick={() =>
                        setCart((prev) => prev.map((it, j) => (j === idx ? { ...it, cantidad: it.cantidad + 1 } : it)))
                      }
                      className="w-10 h-10 rounded-lg bg-gray-100 text-xl font-bold text-gray-700"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-xs">{formatCurrency(i.precio)} c/u</p>
                    <p className="font-bold text-gray-900">{formatCurrency(i.precio * i.cantidad)}</p>
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div>
                <label className="text-gray-500 text-sm block mb-1">Método de facturación</label>
                <select
                  value={metodoOverride}
                  onChange={(e) => setMetodoOverride(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white"
                >
                  <option value="">Del cliente{cliente.metodo_facturacion ? ` (${cliente.metodo_facturacion})` : ""}</option>
                  <option value="Factura">Factura</option>
                  <option value="Final">Final (Mixto)</option>
                  <option value="Presupuesto">Presupuesto</option>
                </select>
                {metodoOverride && (
                  <p className="text-orange-600 text-xs mt-1">
                    ⚠ Los precios se recalculan al confirmar con el método elegido.
                  </p>
                )}
              </div>
              <div>
                <label className="text-gray-500 text-sm block mb-1">Observaciones</label>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  placeholder="Opcional..."
                />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
            <div className="max-w-2xl mx-auto space-y-2">
              <div className="flex items-center justify-between text-lg">
                <span className="text-gray-500">Total ({totalItems} ítems)</span>
                <span className="font-bold text-2xl text-gray-900">{formatCurrency(total)}</span>
              </div>
              <button
                onClick={confirmarPedido}
                disabled={confirmando || !cart.length}
                className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
              >
                {confirmando ? "Creando pedido..." : "Confirmar pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function NuevoPedidoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <NuevoPedidoInner />
    </Suspense>
  )
}
