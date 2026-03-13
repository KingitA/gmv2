"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"

interface PickingItem {
  id: string
  pedido_detalle_id: string
  articulo_id: string
  cantidad_pedida: number
  cantidad_preparada: number
  estado: "pendiente" | "preparado" | "faltante" | "parcial"
  usuario_nombre?: string
  articulos?: { sku: string; descripcion: string; ean13?: string; unidades_por_bulto?: number }
}

interface ArticuloFound {
  id: string
  sku: string
  descripcion: string
  ean13?: string
  stock_actual: number
  unidades_por_bulto?: number
}

type Vista = "lista" | "scanner" | "cantidad"

export default function PickingPage() {
  const { id: pedidoId } = useParams<{ id: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [pedido, setPedido] = useState<any>(null)
  const [sesion, setSesion] = useState<any>(null)
  const [items, setItems] = useState<PickingItem[]>([])

  const [vista, setVista] = useState<Vista>("lista")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articuloSeleccionado, setArticuloSeleccionado] = useState<ArticuloFound | null>(null)
  const [cantidadInput, setCantidadInput] = useState("")
  const [pickingItemActivo, setPickingItemActivo] = useState<PickingItem | null>(null)

  const [filtro, setFiltro] = useState<"todos" | "pendientes" | "listos">("pendientes")
  const [finalizando, setFinalizando] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  // Load pedido and session
  useEffect(() => {
    fetch(`/api/deposito/picking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedido_id: pedidoId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setPedido(data.pedido)
        setSesion(data.sesion)
        // Merge picking_items con articulos del pedido
        const merged = (data.sesion?.picking_items || []).map((pi: any) => {
          const det = data.pedido.pedidos_detalle?.find((d: any) => d.id === pi.pedido_detalle_id)
          return { ...pi, articulos: det?.articulos }
        })
        setItems(merged)
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }, [pedidoId])

  // Search articles
  const buscarArticulo = useCallback((q: string) => {
    if (!q || q.length < 2) { setResultados([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch(`/api/deposito/picking?q=${encodeURIComponent(q)}`)
        const data = await r.json()
        setResultados(Array.isArray(data) ? data : [])
      } finally { setBuscando(false) }
    }, 300)
  }, [])

  useEffect(() => {
    if (vista === "scanner") {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [vista])

  const seleccionarArticulo = (art: ArticuloFound) => {
    // Find matching picking item
    const pi = items.find((i) => i.articulo_id === art.id && i.estado !== "preparado" && i.estado !== "faltante")
    if (!pi) {
      // Article not in this order
      setError(`"${art.descripcion}" no está en este pedido`)
      setTimeout(() => setError(""), 3000)
      setBusqueda("")
      setResultados([])
      return
    }
    setArticuloSeleccionado(art)
    setPickingItemActivo(pi)
    setCantidadInput(String(pi.cantidad_pedida))
    setBusqueda("")
    setResultados([])
    setVista("cantidad")
  }

  const confirmarCantidad = async (esFaltante = false) => {
    if (!pickingItemActivo || !sesion) return
    setSaving(true)
    try {
      const cantidad = esFaltante ? 0 : parseFloat(cantidadInput) || 0
      const estado = esFaltante ? "faltante" : cantidad < pickingItemActivo.cantidad_pedida ? "parcial" : "preparado"

      const r = await fetch("/api/deposito/picking/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sesion_id: sesion.id,
          picking_item_id: pickingItemActivo.id,
          cantidad_preparada: cantidad,
          estado,
        }),
      })
      if (!r.ok) throw new Error()

      // Update local state
      setItems((prev) =>
        prev.map((i) =>
          i.id === pickingItemActivo.id ? { ...i, cantidad_preparada: cantidad, estado } : i
        )
      )
      setVista("scanner")
      setArticuloSeleccionado(null)
      setPickingItemActivo(null)
      setCantidadInput("")
    } catch {
      setError("Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const finalizarPicking = async () => {
    const pendientes = items.filter((i) => i.estado === "pendiente").length
    if (pendientes > 0) {
      if (!confirm(`Hay ${pendientes} artículos sin escanear. ¿Marcarlos como faltantes y finalizar?`)) return
      // Mark remaining as faltante
      setSaving(true)
      for (const item of items.filter((i) => i.estado === "pendiente")) {
        await fetch("/api/deposito/picking/item", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sesion_id: sesion.id,
            picking_item_id: item.id,
            cantidad_preparada: 0,
            estado: "faltante",
          }),
        })
      }
    }

    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/picking/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sesion_id: sesion.id, pedido_id: pedidoId }),
      })
      const data = await r.json()
      if (data.ok) {
        router.push("/deposito/preparar-pedidos")
      } else {
        setError(data.error || "Error al finalizar")
      }
    } catch {
      setError("Error de conexión")
    } finally {
      setFinalizando(false)
      setSaving(false)
    }
  }

  // Stats
  const totalItems = items.length
  const preparados = items.filter((i) => i.estado === "preparado" || i.estado === "parcial").length
  const faltantes = items.filter((i) => i.estado === "faltante").length
  const pendientes = items.filter((i) => i.estado === "pendiente").length

  const itemsFiltrados = items.filter((i) => {
    if (filtro === "pendientes") return i.estado === "pendiente"
    if (filtro === "listos") return i.estado !== "pendiente"
    return true
  })

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-400 animate-pulse text-lg">Cargando pedido...</div></div>
  }

  if (error && !pedido) {
    return (
      <div className="p-4">
        <div className="bg-red-900/50 border border-red-700 rounded-xl p-6 text-red-300 text-center">
          <div className="text-3xl mb-2">⚠️</div>
          {error}
        </div>
      </div>
    )
  }

  // ─── VISTA CANTIDAD ───
  if (vista === "cantidad" && articuloSeleccionado && pickingItemActivo) {
    return (
      <div className="p-4 flex flex-col gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Artículo encontrado</div>
          <div className="text-white font-bold text-lg leading-tight">{articuloSeleccionado.descripcion}</div>
          <div className="flex gap-3 mt-2 text-sm text-gray-400">
            <span>SKU: <span className="text-gray-200 font-mono">{articuloSeleccionado.sku}</span></span>
            {articuloSeleccionado.ean13 && <span>EAN: <span className="text-gray-200 font-mono">{articuloSeleccionado.ean13}</span></span>}
          </div>
        </div>

        <div className="bg-blue-900/30 border border-blue-700/50 rounded-2xl p-4 text-center">
          <div className="text-blue-300 text-sm">Cantidad pedida</div>
          <div className="text-blue-100 font-bold text-4xl">{pickingItemActivo.cantidad_pedida}</div>
          {articuloSeleccionado.unidades_por_bulto && (
            <div className="text-blue-400 text-sm mt-1">({articuloSeleccionado.unidades_por_bulto} u/bulto)</div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <label className="text-gray-400 text-sm block mb-2">Cantidad que separaste físicamente:</label>
          <input
            type="number"
            inputMode="decimal"
            value={cantidadInput}
            onChange={(e) => setCantidadInput(e.target.value)}
            className="w-full bg-gray-800 text-white text-3xl font-bold text-center rounded-xl px-4 py-4 border border-gray-700 focus:border-blue-500 outline-none"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => confirmarCantidad(false)}
            disabled={saving}
            className="bg-green-600 active:bg-green-700 text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50"
          >
            {saving ? "Guardando..." : "✓ Confirmar"}
          </button>
          <button
            onClick={() => confirmarCantidad(true)}
            disabled={saving}
            className="bg-red-700 active:bg-red-800 text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50"
          >
            ✗ Faltante
          </button>
        </div>

        <button
          onClick={() => { setVista("scanner"); setArticuloSeleccionado(null) }}
          className="bg-gray-800 text-gray-300 font-semibold py-3 rounded-2xl active:bg-gray-700"
        >
          ← Volver
        </button>

        {error && <div className="bg-red-900/50 border border-red-700 rounded-xl p-3 text-red-300 text-sm text-center">{error}</div>}
      </div>
    )
  }

  // ─── VISTA SCANNER / BÚSQUEDA ───
  if (vista === "scanner") {
    return (
      <div className="flex flex-col h-full">
        {/* Header stats */}
        <div className="p-4 bg-gray-900 border-b border-gray-800">
          <div className="text-gray-400 text-sm mb-1">{pedido?.numero_pedido} — {pedido?.clientes?.razon_social || pedido?.clientes?.nombre}</div>
          <div className="flex gap-3 text-sm">
            <span className="text-yellow-400">⏳ {pendientes}</span>
            <span className="text-green-400">✓ {preparados}</span>
            <span className="text-red-400">✗ {faltantes}</span>
            <span className="text-gray-500">/ {totalItems} total</span>
          </div>
        </div>

        {/* Search bar */}
        <div className="p-4 bg-gray-950">
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            placeholder="Escanear EAN o buscar por SKU / descripción..."
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }}
            className="w-full bg-gray-800 text-white text-lg rounded-2xl px-5 py-4 border border-gray-700 focus:border-blue-500 outline-none placeholder-gray-500"
            autoFocus
          />
        </div>

        {/* Results */}
        {buscando && (
          <div className="px-4 text-gray-400 text-sm animate-pulse">Buscando...</div>
        )}
        {resultados.length > 0 && (
          <div className="flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2">
            {resultados.map((art) => {
              const inOrder = items.find((i) => i.articulo_id === art.id)
              return (
                <button
                  key={art.id}
                  onClick={() => seleccionarArticulo(art)}
                  className={`text-left w-full rounded-2xl p-4 border transition-all active:scale-95 ${
                    inOrder ? "bg-blue-900/30 border-blue-700/50" : "bg-gray-900 border-gray-700 opacity-60"
                  }`}
                >
                  <div className="text-white font-semibold">{art.descripcion}</div>
                  <div className="flex gap-3 text-sm mt-1">
                    <span className="text-gray-400 font-mono">{art.sku}</span>
                    {art.ean13 && <span className="text-gray-500 font-mono">{art.ean13}</span>}
                    {!inOrder && <span className="text-red-400 text-xs">No está en este pedido</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {!busqueda && (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-center px-8">
            <div>
              <div className="text-4xl mb-3">📱</div>
              <div>Escaneá el código de barras<br />o escribí para buscar</div>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-4 bg-red-900/50 border border-red-700 rounded-xl p-3 text-red-300 text-sm text-center">{error}</div>
        )}

        {/* Bottom actions */}
        <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3">
          <button
            onClick={() => setVista("lista")}
            className="flex-1 bg-gray-800 text-gray-300 font-semibold py-3 rounded-xl active:bg-gray-700"
          >
            📋 Ver lista
          </button>
          {pendientes === 0 && (
            <button
              onClick={finalizarPicking}
              disabled={finalizando}
              className="flex-1 bg-green-600 text-white font-bold py-3 rounded-xl active:bg-green-700 disabled:opacity-50"
            >
              {finalizando ? "Finalizando..." : "✅ Finalizar"}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── VISTA LISTA ───
  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="p-4 bg-gray-900 border-b border-gray-800">
        <div className="text-white font-bold text-lg">{pedido?.numero_pedido}</div>
        <div className="text-gray-400 text-sm">{pedido?.clientes?.razon_social || pedido?.clientes?.nombre}</div>
        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{preparados + faltantes} de {totalItems} resueltos</span>
            <span>{Math.round(((preparados + faltantes) / Math.max(totalItems, 1)) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${((preparados + faltantes) / Math.max(totalItems, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        {(["todos", "pendientes", "listos"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`flex-1 py-3 text-sm font-semibold capitalize transition-colors ${filtro === f ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-500"}`}
          >
            {f === "todos" ? `Todos (${totalItems})` : f === "pendientes" ? `Pendientes (${pendientes})` : `Listos (${preparados + faltantes})`}
          </button>
        ))}
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-auto px-3 py-3 flex flex-col gap-2">
        {itemsFiltrados.map((item) => {
          const estadoIcon = { pendiente: "⬜", preparado: "✅", faltante: "❌", parcial: "⚠️" }[item.estado]
          const estadoCls = {
            pendiente: "border-gray-700 bg-gray-900",
            preparado: "border-green-700/50 bg-green-900/20",
            faltante: "border-red-700/50 bg-red-900/20",
            parcial: "border-yellow-700/50 bg-yellow-900/20",
          }[item.estado]

          return (
            <div key={item.id} className={`rounded-xl border p-3 ${estadoCls}`}>
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5 flex-shrink-0">{estadoIcon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm leading-tight truncate">
                    {item.articulos?.descripcion || "Artículo desconocido"}
                  </div>
                  <div className="text-gray-500 text-xs font-mono mt-0.5">{item.articulos?.sku}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-white font-bold">
                    {item.estado === "pendiente" ? item.cantidad_pedida : item.cantidad_preparada}
                    <span className="text-gray-500 font-normal"> / {item.cantidad_pedida}</span>
                  </div>
                  {item.usuario_nombre && (
                    <div className="text-gray-500 text-xs">{item.usuario_nombre}</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom */}
      <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3">
        <button
          onClick={() => setVista("scanner")}
          className="flex-1 bg-blue-600 text-white font-bold py-4 rounded-2xl text-lg active:bg-blue-700"
        >
          📱 Escanear artículo
        </button>
        {pendientes === 0 && (
          <button
            onClick={finalizarPicking}
            disabled={finalizando}
            className="bg-green-600 text-white font-bold px-5 py-4 rounded-2xl active:bg-green-700 disabled:opacity-50"
          >
            {finalizando ? "..." : "✅"}
          </button>
        )}
      </div>
    </div>
  )
}
