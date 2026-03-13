"use client"

import { useState, useRef, useCallback } from "react"

interface ArticuloFound {
  id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number
}

type Step = "buscar" | "ajustar" | "historial"

export default function AjustarStockPage() {
  const [step, setStep] = useState<Step>("buscar")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articuloSel, setArticuloSel] = useState<ArticuloFound | null>(null)

  const [tipo, setTipo] = useState<"entrada" | "salida" | "ajuste">("ajuste")
  const [cantidad, setCantidad] = useState("")
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [historial, setHistorial] = useState<any[]>([])
  const [loadingHist, setLoadingHist] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

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

  const seleccionar = (art: ArticuloFound) => {
    setArticuloSel(art)
    setBusqueda("")
    setResultados([])
    setCantidad("")
    setMotivo("")
    setStep("ajustar")
  }

  const guardarAjuste = async () => {
    if (!articuloSel || !cantidad) { setError("Ingresá una cantidad"); return }
    setGuardando(true)
    setError("")
    try {
      const r = await fetch("/api/deposito/ajustes-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articulo_id: articuloSel.id,
          tipo,
          cantidad: parseFloat(cantidad),
          motivo,
        }),
      })
      const data = await r.json()
      if (data.error) { setError(data.error); return }
      setSuccess("Ajuste enviado al ERP para confirmación")
      setTimeout(() => {
        setSuccess("")
        setStep("buscar")
        setArticuloSel(null)
        setCantidad("")
        setMotivo("")
      }, 2500)
    } catch { setError("Error de conexión") }
    finally { setGuardando(false) }
  }

  const cargarHistorial = async () => {
    setLoadingHist(true)
    try {
      const r = await fetch("/api/deposito/ajustes-stock")
      setHistorial(await r.json())
    } finally { setLoadingHist(false) }
    setStep("historial")
  }

  const stockNuevo = () => {
    if (!articuloSel || !cantidad) return null
    const cant = parseFloat(cantidad) || 0
    if (tipo === "entrada") return articuloSel.stock_actual + cant
    if (tipo === "salida") return articuloSel.stock_actual - cant
    return cant // ajuste directo
  }

  // ─── HISTORIAL ───
  if (step === "historial") {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">Ajustes recientes</h2>
          <button onClick={() => setStep("buscar")} className="px-4 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm">← Volver</button>
        </div>
        {loadingHist && <div className="text-gray-400 animate-pulse text-center py-8">Cargando...</div>}
        <div className="flex flex-col gap-3">
          {historial.map(aj => (
            <div key={aj.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-white font-semibold text-sm">{aj.articulos?.descripcion}</div>
                  <div className="text-gray-500 text-xs font-mono">{aj.articulos?.sku}</div>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                  aj.estado === "confirmado" ? "bg-green-700 text-green-100" :
                  aj.estado === "rechazado" ? "bg-red-700 text-red-100" :
                  "bg-yellow-700 text-yellow-100"
                }`}>{aj.estado}</span>
              </div>
              <div className="flex gap-3 mt-2 text-sm text-gray-400">
                <span>{aj.tipo === "entrada" ? "+" : aj.tipo === "salida" ? "-" : "="}{aj.cantidad}</span>
                <span>•</span>
                <span>{aj.usuario_nombre}</span>
                <span>•</span>
                <span>{new Date(aj.created_at).toLocaleDateString("es-AR")}</span>
              </div>
              {aj.motivo && <div className="text-gray-500 text-xs mt-1">{aj.motivo}</div>}
            </div>
          ))}
          {historial.length === 0 && !loadingHist && (
            <div className="text-center text-gray-500 py-8">Sin ajustes recientes</div>
          )}
        </div>
      </div>
    )
  }

  // ─── AJUSTAR ARTÍCULO ───
  if (step === "ajustar" && articuloSel) {
    const nuevo = stockNuevo()
    return (
      <div className="p-4 flex flex-col gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Artículo seleccionado</div>
          <div className="text-white font-bold text-lg">{articuloSel.descripcion}</div>
          <div className="text-gray-400 text-sm font-mono mt-1">{articuloSel.sku}</div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-gray-400 text-sm">Stock actual:</span>
            <span className="text-white font-bold text-xl">{articuloSel.stock_actual}</span>
          </div>
        </div>

        {/* Tipo de ajuste */}
        <div className="grid grid-cols-3 gap-2">
          {(["entrada", "salida", "ajuste"] as const).map(t => (
            <button key={t} onClick={() => setTipo(t)}
              className={`py-3 rounded-xl font-semibold text-sm capitalize transition-all ${
                tipo === t
                  ? t === "entrada" ? "bg-green-600 text-white" : t === "salida" ? "bg-red-600 text-white" : "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400"
              }`}>
              {t === "entrada" ? "📥 Entrada" : t === "salida" ? "📤 Salida" : "✏️ Corrección"}
            </button>
          ))}
        </div>

        {/* Cantidad */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <label className="text-gray-400 text-sm block mb-2">
            {tipo === "ajuste" ? "Stock correcto (valor final):" : `Cantidad a ${tipo === "entrada" ? "ingresar" : "retirar"}:`}
          </label>
          <input
            type="number" inputMode="decimal"
            value={cantidad}
            onChange={e => setCantidad(e.target.value)}
            className="w-full bg-gray-800 text-white text-3xl font-bold text-center rounded-xl px-4 py-4 border border-gray-700 focus:border-amber-500 outline-none"
            autoFocus
          />
          {nuevo !== null && (
            <div className="text-center mt-3 text-sm">
              <span className="text-gray-400">Stock resultante: </span>
              <span className={`font-bold text-lg ${nuevo < 0 ? "text-red-400" : "text-white"}`}>{nuevo}</span>
            </div>
          )}
        </div>

        {/* Motivo */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <label className="text-gray-400 text-sm block mb-2">Motivo (opcional):</label>
          <input
            type="text"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: Rotura, conteo físico, mercadería vencida..."
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:border-amber-500 outline-none text-sm placeholder-gray-600"
          />
        </div>

        {error && <div className="bg-red-900/50 border border-red-700 rounded-xl p-3 text-red-300 text-sm text-center">{error}</div>}
        {success && <div className="bg-green-900/50 border border-green-700 rounded-xl p-3 text-green-300 text-sm text-center">{success}</div>}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => { setStep("buscar"); setArticuloSel(null) }}
            className="bg-gray-800 text-gray-300 font-semibold py-4 rounded-2xl active:bg-gray-700">
            ← Volver
          </button>
          <button onClick={guardarAjuste} disabled={guardando}
            className="bg-amber-600 active:bg-amber-700 text-white font-bold py-4 rounded-2xl disabled:opacity-50">
            {guardando ? "Enviando..." : "📤 Enviar ajuste"}
          </button>
        </div>

        <div className="text-center text-xs text-gray-500">
          El ajuste queda pendiente de confirmación en el ERP
        </div>
      </div>
    )
  }

  // ─── BUSCAR ───
  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="p-4 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg">Ajustar Stock</h2>
          <p className="text-gray-400 text-sm">Buscá el artículo a ajustar</p>
        </div>
        <button onClick={cargarHistorial} className="px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm active:bg-gray-700">
          📋 Historial
        </button>
      </div>

      <div className="p-4">
        <input
          ref={inputRef}
          type="text" inputMode="search"
          placeholder="Escanear EAN o buscar por SKU / descripción..."
          value={busqueda}
          onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }}
          className="w-full bg-gray-800 text-white text-lg rounded-2xl px-5 py-4 border border-gray-700 focus:border-amber-500 outline-none placeholder-gray-500"
          autoFocus
        />
      </div>

      {buscando && <div className="px-4 text-gray-400 text-sm animate-pulse">Buscando...</div>}

      {resultados.length > 0 && (
        <div className="flex-1 overflow-auto px-4 flex flex-col gap-2">
          {resultados.map(art => (
            <button key={art.id} onClick={() => seleccionar(art)}
              className="text-left w-full bg-gray-900 border border-gray-700 rounded-2xl p-4 active:bg-gray-800">
              <div className="text-white font-semibold">{art.descripcion}</div>
              <div className="flex gap-4 mt-1 text-sm">
                <span className="text-gray-400 font-mono">{art.sku}</span>
                <span className="text-gray-500">Stock: <span className="text-white font-bold">{art.stock_actual}</span></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {!busqueda && (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-center px-8">
          <div><div className="text-4xl mb-3">🔧</div><div>Escaneá o buscá el artículo<br />para ajustar su stock</div></div>
        </div>
      )}
    </div>
  )
}
