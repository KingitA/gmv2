"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"

interface RecepcionItem {
  id: string
  articulo_id: string
  cantidad_oc: number
  cantidad_fisica: number
  estado_linea: "pendiente" | "ok" | "diferencia_cantidad" | "no_pedido"
  articulos?: { sku: string; descripcion: string; ean13?: string; unidades_por_bulto?: number }
}

interface ArticuloFound {
  id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number; unidades_por_bulto?: number
}

type Vista = "lista" | "scanner" | "cantidad"

export default function RecibirMercaderiaDetalleePage() {
  const { id: ordenId } = useParams<{ id: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  const [orden, setOrden] = useState<any>(null)
  const [recepcion, setRecepcion] = useState<any>(null)
  const [items, setItems] = useState<RecepcionItem[]>([])
  const [documentos, setDocumentos] = useState<any[]>([])

  const [vista, setVista] = useState<Vista>("scanner")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articuloSel, setArticuloSel] = useState<ArticuloFound | null>(null)
  const [cantidadInput, setCantidadInput] = useState("")
  const [itemActivo, setItemActivo] = useState<RecepcionItem | null>(null)

  const [filtro, setFiltro] = useState<"todos" | "pendientes" | "recibidos">("pendientes")
  const [finalizando, setFinalizando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    // Load orden and start/resume recepcion
    fetch(`/api/deposito/recepciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orden_compra_id: ordenId }),
    })
      .then(r => r.json())
      .then(async recData => {
        if (recData.error) { setError(recData.error); return }
        setRecepcion(recData)
        setDocumentos(recData.recepciones_documentos || [])

        // Load orden detail
        const ordRes = await fetch(`/api/deposito/recepciones`)
        const ordenes = await ordRes.json()
        const ord = ordenes.find((o: any) => o.id === ordenId)
        setOrden(ord)

        // Merge recepcion items with articulo info
        const merged = (recData.recepciones_items || []).map((ri: any) => {
          const det = ord?.ordenes_compra_detalle?.find((d: any) => d.articulo_id === ri.articulo_id)
          return { ...ri, articulos: det?.articulos }
        })
        setItems(merged)
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }, [ordenId])

  useEffect(() => {
    if (vista === "scanner") setTimeout(() => inputRef.current?.focus(), 100)
  }, [vista])

  const buscarArticulo = useCallback((q: string) => {
    if (!q || q.length < 2) { setResultados([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch(`/api/deposito/picking?q=${encodeURIComponent(q)}`)
        setResultados(await r.json())
      } finally { setBuscando(false) }
    }, 300)
  }, [])

  const seleccionarArticulo = (art: ArticuloFound) => {
    const ri = items.find(i => i.articulo_id === art.id)
    setArticuloSel(art)
    setItemActivo(ri || null)
    setCantidadInput(ri ? String(ri.cantidad_oc) : "")
    setBusqueda("")
    setResultados([])
    setVista("cantidad")
  }

  const confirmarCantidad = async () => {
    if (!articuloSel || !recepcion) return
    setSaving(true)
    try {
      const cantidad = parseFloat(cantidadInput) || 0
      const r = await fetch("/api/deposito/recepciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recepcion_id: recepcion.id,
          articulo_id: articuloSel.id,
          cantidad_fisica: cantidad,
        }),
      })
      if (!r.ok) throw new Error()

      setItems(prev => prev.map(i =>
        i.articulo_id === articuloSel.id
          ? { ...i, cantidad_fisica: cantidad, estado_linea: cantidad > 0 ? "ok" : "pendiente" }
          : i
      ))
      setVista("scanner")
      setArticuloSel(null)
      setItemActivo(null)
      showSuccess("✓ Guardado")
    } catch { setError("Error al guardar") }
    finally { setSaving(false) }
  }

  const subirDocumento = async (file: File, tipo: string) => {
    if (!recepcion) return
    setSubiendo(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("recepcion_id", recepcion.id)
      formData.append("tipo_documento", tipo)
      const r = await fetch("/api/deposito/recepciones/documento", { method: "POST", body: formData })
      if (r.ok) {
        const doc = await r.json()
        setDocumentos(prev => [...prev, doc])
        showSuccess("Documento adjuntado")
      }
    } finally { setSubiendo(false) }
  }

  const finalizarRecepcion = async () => {
    const pendientes = items.filter(i => i.estado_linea === "pendiente").length
    if (pendientes > 0 && !confirm(`Hay ${pendientes} artículos sin recibir. ¿Finalizar de todas formas?`)) return
    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/recepciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recepcion_id: recepcion.id, finalizar: true }),
      })
      const data = await r.json()
      if (data.ok) router.push("/deposito/recibir-mercaderia")
      else setError(data.error || "Error al finalizar")
    } catch { setError("Error de conexión") }
    finally { setFinalizando(false) }
  }

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(""), 2000)
  }

  const recibidos = items.filter(i => i.estado_linea === "ok" || i.estado_linea === "diferencia_cantidad").length
  const pendientes = items.filter(i => i.estado_linea === "pendiente").length
  const total = items.length

  const itemsFiltrados = items.filter(i => {
    if (filtro === "pendientes") return i.estado_linea === "pendiente"
    if (filtro === "recibidos") return i.estado_linea !== "pendiente"
    return true
  })

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-400 animate-pulse text-lg">Cargando orden...</div></div>

  // ─── VISTA CANTIDAD ───
  if (vista === "cantidad" && articuloSel) {
    return (
      <div className="p-4 flex flex-col gap-4">
        {itemActivo && (
          <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-2xl p-4 text-center">
            <div className="text-emerald-300 text-sm">Cantidad en orden de compra</div>
            <div className="text-emerald-100 font-bold text-4xl">{itemActivo.cantidad_oc}</div>
          </div>
        )}
        {!itemActivo && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-2xl p-3 text-yellow-300 text-sm text-center">
            ⚠️ Este artículo no estaba en la orden de compra
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Artículo</div>
          <div className="text-white font-bold text-lg leading-tight">{articuloSel.descripcion}</div>
          <div className="text-gray-400 text-sm font-mono mt-1">{articuloSel.sku}</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <label className="text-gray-400 text-sm block mb-2">Cantidad recibida físicamente:</label>
          <input
            type="number"
            inputMode="decimal"
            value={cantidadInput}
            onChange={e => setCantidadInput(e.target.value)}
            className="w-full bg-gray-800 text-white text-3xl font-bold text-center rounded-xl px-4 py-4 border border-gray-700 focus:border-emerald-500 outline-none"
            autoFocus
          />
        </div>

        <button onClick={confirmarCantidad} disabled={saving}
          className="bg-emerald-600 active:bg-emerald-700 text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50">
          {saving ? "Guardando..." : "✓ Confirmar cantidad"}
        </button>
        <button onClick={() => { setVista("scanner"); setArticuloSel(null) }}
          className="bg-gray-800 text-gray-300 font-semibold py-3 rounded-2xl active:bg-gray-700">
          ← Volver
        </button>
      </div>
    )
  }

  // ─── VISTA SCANNER ───
  if (vista === "scanner") {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 bg-gray-900 border-b border-gray-800">
          <div className="text-white font-bold">{orden?.numero_orden || "Recepción"}</div>
          <div className="text-emerald-400 text-sm">{orden?.proveedores?.nombre}</div>
          <div className="flex gap-3 text-sm mt-2">
            <span className="text-yellow-400">⏳ {pendientes}</span>
            <span className="text-green-400">✓ {recibidos}</span>
            <span className="text-gray-500">/ {total} total</span>
          </div>
        </div>

        <div className="p-4 bg-gray-950">
          <input
            ref={inputRef}
            type="text" inputMode="search"
            placeholder="Escanear EAN o buscar artículo..."
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }}
            className="w-full bg-gray-800 text-white text-lg rounded-2xl px-5 py-4 border border-gray-700 focus:border-emerald-500 outline-none placeholder-gray-500"
            autoFocus
          />
        </div>

        {buscando && <div className="px-4 text-gray-400 text-sm animate-pulse">Buscando...</div>}

        {resultados.length > 0 && (
          <div className="flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2">
            {resultados.map(art => {
              const enOrden = items.find(i => i.articulo_id === art.id)
              return (
                <button key={art.id} onClick={() => seleccionarArticulo(art)}
                  className={`text-left w-full rounded-2xl p-4 border active:scale-95 transition-all ${enOrden ? "bg-emerald-900/30 border-emerald-700/50" : "bg-gray-900 border-gray-700"}`}>
                  <div className="text-white font-semibold">{art.descripcion}</div>
                  <div className="flex gap-3 text-sm mt-1 text-gray-400 font-mono">
                    <span>{art.sku}</span>
                    {art.ean13 && <span>{art.ean13}</span>}
                  </div>
                  {enOrden && <div className="text-emerald-400 text-xs mt-1">En OC: {enOrden.cantidad_oc} u</div>}
                </button>
              )
            })}
          </div>
        )}

        {!busqueda && (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-center px-8">
            <div><div className="text-4xl mb-3">📦</div><div>Escaneá el código del producto<br />o buscá por nombre</div></div>
          </div>
        )}

        {successMsg && (
          <div className="mx-4 bg-green-900/60 border border-green-700 rounded-xl p-3 text-green-300 text-center text-sm">{successMsg}</div>
        )}
        {error && (
          <div className="mx-4 bg-red-900/50 border border-red-700 rounded-xl p-3 text-red-300 text-center text-sm">{error}</div>
        )}

        {/* Documentos adjuntos */}
        <div className="px-4 py-2 bg-gray-900 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs">{documentos.length} doc{documentos.length !== 1 ? "s" : ""} adjunto{documentos.length !== 1 ? "s" : ""}</span>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
              onChange={e => { if (e.target.files?.[0]) subirDocumento(e.target.files[0], "remito") }} />
            <button onClick={() => fileRef.current?.click()} disabled={subiendo}
              className="text-xs text-emerald-400 px-3 py-1 rounded-lg bg-emerald-900/30 border border-emerald-700/50 active:bg-emerald-900/50">
              {subiendo ? "Subiendo..." : "+ Adjuntar remito/factura"}
            </button>
          </div>
        </div>

        <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3">
          <button onClick={() => setVista("lista")} className="flex-1 bg-gray-800 text-gray-300 font-semibold py-3 rounded-xl active:bg-gray-700">
            📋 Ver lista
          </button>
          <button onClick={finalizarRecepcion} disabled={finalizando}
            className="flex-1 bg-emerald-600 text-white font-bold py-3 rounded-xl active:bg-emerald-700 disabled:opacity-50">
            {finalizando ? "Finalizando..." : "✅ Finalizar"}
          </button>
        </div>
      </div>
    )
  }

  // ─── VISTA LISTA ───
  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="p-4 bg-gray-900 border-b border-gray-800">
        <div className="text-white font-bold">{orden?.numero_orden}</div>
        <div className="text-emerald-400 text-sm">{orden?.proveedores?.nombre}</div>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{recibidos} de {total} artículos recibidos</span>
            <span>{Math.round((recibidos / Math.max(total, 1)) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${(recibidos / Math.max(total, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="flex border-b border-gray-800 bg-gray-900">
        {(["todos", "pendientes", "recibidos"] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`flex-1 py-3 text-sm font-semibold capitalize ${filtro === f ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-500"}`}>
            {f === "todos" ? `Todos (${total})` : f === "pendientes" ? `Pendientes (${pendientes})` : `Recibidos (${recibidos})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 flex flex-col gap-2">
        {itemsFiltrados.map(item => {
          const ok = item.estado_linea === "ok"
          const cls = ok ? "border-green-700/50 bg-green-900/20" : "border-gray-700 bg-gray-900"
          return (
            <div key={item.id} className={`rounded-xl border p-3 ${cls}`}>
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{ok ? "✅" : "⬜"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm leading-tight truncate">
                    {item.articulos?.descripcion || item.articulo_id}
                  </div>
                  <div className="text-gray-500 text-xs font-mono mt-0.5">{item.articulos?.sku}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-white font-bold text-sm">
                    {ok ? item.cantidad_fisica : "—"}
                    <span className="text-gray-500 font-normal"> / {item.cantidad_oc}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3">
        <button onClick={() => setVista("scanner")} className="flex-1 bg-emerald-600 text-white font-bold py-4 rounded-2xl text-lg active:bg-emerald-700">
          📱 Escanear
        </button>
        <button onClick={finalizarRecepcion} disabled={finalizando}
          className="bg-green-600 text-white font-bold px-5 py-4 rounded-2xl active:bg-green-700 disabled:opacity-50">
          {finalizando ? "..." : "✅"}
        </button>
      </div>
    </div>
  )
}
