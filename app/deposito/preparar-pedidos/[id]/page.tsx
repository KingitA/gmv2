"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"

interface DetallePedido {
  id: string
  articulo_id: string
  cantidad: number
  cantidad_preparada: number
  estado_item: string // PENDIENTE | COMPLETO | PARCIAL | FALTANTE
  articulos: { id: string; sku: string; descripcion: string; ean13?: string; unidades_por_bulto?: number }
}

interface ArticuloFound {
  id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number
}

type Vista = "lista" | "scanner" | "cantidad"

export default function PickingPage() {
  const { id: pedidoId } = useParams<{ id: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [pedido, setPedido] = useState<any>(null)
  const [items, setItems] = useState<DetallePedido[]>([])
  const [vista, setVista] = useState<Vista>("lista")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [itemActivo, setItemActivo] = useState<DetallePedido | null>(null)
  const [articuloSel, setArticuloSel] = useState<ArticuloFound | null>(null)
  const [cantidadInput, setCantidadInput] = useState("")
  const [filtro, setFiltro] = useState<"pendientes" | "todos" | "listos">("pendientes")
  const [finalizando, setFinalizando] = useState(false)
  const [successMsg, setSuccessMsg] = useState("")

  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    // Iniciar sesión y cargar pedido
    fetch("/api/deposito/picking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedido_id: pedidoId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setPedido(data.pedido)
        setItems(data.pedido.pedidos_detalle || [])
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }, [pedidoId])

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
    // Buscar en los items del pedido
    const item = items.find(i => i.articulo_id === art.id && i.estado_item !== "COMPLETO" && i.estado_item !== "FALTANTE")
    if (!item) {
      // Puede ser que ya está completo o no pertenece al pedido
      const enPedido = items.find(i => i.articulo_id === art.id)
      if (!enPedido) {
        showError(`"${art.descripcion}" no está en este pedido`)
        setBusqueda(""); setResultados([])
        return
      }
      if (enPedido.estado_item === "COMPLETO") {
        showError(`"${art.descripcion}" ya está completo`)
        setBusqueda(""); setResultados([])
        return
      }
    }
    setItemActivo(item || null)
    setArticuloSel(art)
    setCantidadInput(String(item?.cantidad || ""))
    setBusqueda(""); setResultados([])
    setVista("cantidad")
  }

  const confirmarCantidad = async (esFaltante = false) => {
    if (!itemActivo) return
    setSaving(true)
    try {
      const cantidad = esFaltante ? 0 : parseFloat(cantidadInput) || 0
      const r = await fetch("/api/deposito/picking/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedido_detalle_id: itemActivo.id,
          cantidad_preparada: cantidad,
          es_faltante: esFaltante,
          cantidad_pedida: itemActivo.cantidad,
        }),
      })
      const data = await r.json()
      if (data.error) { showError(data.error); return }

      // Actualizar estado local
      setItems(prev => prev.map(i =>
        i.id === itemActivo.id
          ? { ...i, cantidad_preparada: cantidad, estado_item: data.estado_item }
          : i
      ))
      showSuccess(esFaltante ? "Marcado como faltante" : "✓ Guardado")
      setVista("scanner")
      setItemActivo(null); setArticuloSel(null); setCantidadInput("")
    } catch { showError("Error al guardar") }
    finally { setSaving(false) }
  }

  const finalizarPicking = async () => {
    const pendientes = items.filter(i => !i.estado_item || i.estado_item === "PENDIENTE").length
    if (pendientes > 0 && !confirm(`Quedan ${pendientes} artículos sin escanear. ¿Marcarlos como FALTANTE y finalizar?`)) return

    // Marcar pendientes como faltantes
    if (pendientes > 0) {
      setSaving(true)
      for (const item of items.filter(i => !i.estado_item || i.estado_item === "PENDIENTE")) {
        await fetch("/api/deposito/picking/item", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedido_detalle_id: item.id, cantidad_preparada: 0, es_faltante: true, cantidad_pedida: item.cantidad }),
        })
      }
      setSaving(false)
    }

    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/picking/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: pedidoId }),
      })
      const data = await r.json()
      if (data.ok) router.push("/deposito/preparar-pedidos")
      else showError(data.error || "Error al finalizar")
    } catch { showError("Error de conexión") }
    finally { setFinalizando(false) }
  }

  const showError = (msg: string) => { setError(msg); setTimeout(() => setError(""), 3000) }
  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 2000) }

  const completos = items.filter(i => i.estado_item === "COMPLETO" || i.estado_item === "PARCIAL").length
  const faltantes = items.filter(i => i.estado_item === "FALTANTE").length
  const pendientes = items.filter(i => !i.estado_item || i.estado_item === "PENDIENTE").length
  const total = items.length
  const pct = total > 0 ? Math.round(((completos + faltantes) / total) * 100) : 0

  const itemsFiltrados = items.filter(i => {
    if (filtro === "pendientes") return !i.estado_item || i.estado_item === "PENDIENTE"
    if (filtro === "listos") return i.estado_item && i.estado_item !== "PENDIENTE"
    return true
  })

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#9ca3af" }}>Cargando pedido...</div>

  if (error && !pedido) return (
    <div style={{ padding: 16 }}>
      <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 14, padding: 20, color: "#fca5a5", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        {error}
      </div>
    </div>
  )

  // ── MODAL CANTIDAD ──
  if (vista === "cantidad" && articuloSel && itemActivo) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#030712", zIndex: 100, display: "flex", flexDirection: "column", padding: 16, gap: 12 }}>
        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 20, padding: 20 }}>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Artículo encontrado</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb", lineHeight: 1.3 }}>{articuloSel.descripcion}</div>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "monospace", marginTop: 6 }}>{articuloSel.sku}{articuloSel.ean13 && ` · ${articuloSel.ean13}`}</div>
        </div>

        <div style={{ background: "#1e3a5f", border: "1px solid #1d4ed8", borderRadius: 16, padding: "14px 20px", textAlign: "center" }}>
          <div style={{ color: "#93c5fd", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad pedida</div>
          <div style={{ color: "#eff6ff", fontWeight: 700, fontSize: 40 }}>{itemActivo.cantidad}</div>
          {itemActivo.cantidad_preparada > 0 && (
            <div style={{ color: "#60a5fa", fontSize: 12 }}>Ya preparado: {itemActivo.cantidad_preparada}</div>
          )}
        </div>

        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 20, padding: 16 }}>
          <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>Cantidad que separaste:</div>
          <input
            type="number" inputMode="decimal" value={cantidadInput}
            onChange={e => setCantidadInput(e.target.value)} autoFocus
            style={{ width: "100%", background: "#1f2937", color: "#f9fafb", fontSize: 40, fontWeight: 700, textAlign: "center", borderRadius: 14, padding: "14px", border: "2px solid #374151", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 12, padding: 12, color: "#fca5a5", textAlign: "center", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={() => confirmarCantidad(false)} disabled={saving}
            style={{ background: "#059669", color: "#fff", fontWeight: 700, fontSize: 18, padding: 18, borderRadius: 18, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>
            {saving ? "..." : "✓ Confirmar"}
          </button>
          <button onClick={() => confirmarCantidad(true)} disabled={saving}
            style={{ background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 18, padding: 18, borderRadius: 18, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>
            ✗ Faltante
          </button>
        </div>
        <button onClick={() => { setVista("scanner"); setItemActivo(null); setArticuloSel(null) }}
          style={{ background: "#1f2937", color: "#9ca3af", fontWeight: 600, padding: 14, borderRadius: 18, border: "none", cursor: "pointer" }}>
          ← Volver
        </button>
      </div>
    )
  }

  // ── SCANNER ──
  if (vista === "scanner") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: "#030712" }}>
        <div style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: "12px 16px" }}>
          <div style={{ fontSize: 13, color: "#9ca3af" }}>{pedido?.numero_pedido} · {pedido?.clientes?.razon_social || pedido?.clientes?.nombre}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 13 }}>
            <span style={{ color: "#f59e0b" }}>⏳ {pendientes}</span>
            <span style={{ color: "#34d399" }}>✓ {completos}</span>
            <span style={{ color: "#f87171" }}>✗ {faltantes}</span>
            <span style={{ color: "#6b7280" }}>/ {total}</span>
          </div>
        </div>

        <div style={{ padding: "12px 16px" }}>
          <input ref={inputRef} type="text" inputMode="search"
            placeholder="Escanear EAN o buscar artículo..." value={busqueda}
            onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }} autoFocus
            style={{ width: "100%", background: "#1f2937", color: "#f9fafb", fontSize: 17, borderRadius: 16, padding: "14px 16px", border: "2px solid #374151", outline: "none", boxSizing: "border-box" }} />
        </div>

        {buscando && <div style={{ padding: "0 16px", color: "#9ca3af", fontSize: 13 }}>Buscando...</div>}

        <div style={{ flex: 1, overflow: "auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {resultados.map(art => {
            const enPedido = items.find(i => i.articulo_id === art.id)
            return (
              <button key={art.id} onClick={() => seleccionarArticulo(art)}
                style={{ textAlign: "left", width: "100%", background: enPedido ? "#1e3a5f" : "#111827", border: `1px solid ${enPedido ? "#1d4ed8" : "#1f2937"}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>
                <div style={{ color: "#f9fafb", fontWeight: 600, fontSize: 15 }}>{art.descripcion}</div>
                <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace", marginTop: 4 }}>{art.sku}{art.ean13 && ` · ${art.ean13}`}</div>
                {enPedido && <div style={{ fontSize: 12, color: "#60a5fa", marginTop: 4 }}>En pedido: {enPedido.cantidad} u · Estado: {enPedido.estado_item || "PENDIENTE"}</div>}
              </button>
            )
          })}
          {!busqueda && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 12, color: "#4b5563" }}>
              <div style={{ fontSize: 40 }}>📱</div>
              <div style={{ textAlign: "center", fontSize: 14 }}>Escaneá el código de barras<br />o escribí para buscar</div>
            </div>
          )}
        </div>

        {(error || successMsg) && (
          <div style={{ margin: "0 16px", background: error ? "#450a0a" : "#064e3b", border: `1px solid ${error ? "#7f1d1d" : "#065f46"}`, borderRadius: 12, padding: 12, color: error ? "#fca5a5" : "#6ee7b7", textAlign: "center", fontSize: 13 }}>
            {error || successMsg}
          </div>
        )}

        <div style={{ background: "#111827", borderTop: "1px solid #1f2937", padding: "12px 16px", display: "flex", gap: 10 }}>
          <button onClick={() => setVista("lista")}
            style={{ flex: 1, background: "#1f2937", color: "#d1d5db", fontWeight: 600, padding: "16px 0", borderRadius: 16, border: "none", cursor: "pointer" }}>
            📋 Ver lista
          </button>
          {pendientes === 0 && (
            <button onClick={finalizarPicking} disabled={finalizando}
              style={{ flex: 1, background: "#059669", color: "#fff", fontWeight: 700, padding: "16px 0", borderRadius: 16, border: "none", cursor: "pointer", opacity: finalizando ? 0.5 : 1 }}>
              {finalizando ? "..." : "✅ Finalizar"}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── LISTA ──
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: "#030712" }}>
      {/* Header */}
      <div style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb" }}>{pedido?.numero_pedido}</div>
        <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 2 }}>{pedido?.clientes?.razon_social || pedido?.clientes?.nombre}</div>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginBottom: 5 }}>
            <span><span style={{ color: "#34d399", fontWeight: 600 }}>{completos + faltantes}</span> de {total} resueltos</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? "#34d399" : "#f9fafb" }}>{pct}%</span>
          </div>
          <div style={{ background: "#1f2937", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", background: pct === 100 ? "#059669" : "#3b82f6", borderRadius: 999, width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12 }}>
            <span style={{ color: "#f59e0b" }}>⏳ {pendientes} pendientes</span>
            <span style={{ color: "#34d399" }}>✓ {completos} completos</span>
            <span style={{ color: "#f87171" }}>✗ {faltantes} faltantes</span>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", background: "#111827", borderBottom: "1px solid #1f2937" }}>
        {(["pendientes", "todos", "listos"] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            style={{ flex: 1, padding: "12px 0", fontSize: 13, fontWeight: 600, background: "none", border: "none", cursor: "pointer", color: filtro === f ? "#3b82f6" : "#6b7280", borderBottom: filtro === f ? "2px solid #3b82f6" : "2px solid transparent" }}>
            {f === "pendientes" ? `Pendientes (${pendientes})` : f === "todos" ? `Todos (${total})` : `Listos (${completos + faltantes})`}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflow: "auto", padding: "10px 12px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 10 }}>
          {itemsFiltrados.map(item => {
            const estado = item.estado_item || "PENDIENTE"
            const bg = estado === "COMPLETO" ? "#052e16" : estado === "FALTANTE" ? "#450a0a" : estado === "PARCIAL" ? "#422006" : "#111827"
            const border = estado === "COMPLETO" ? "#14532d" : estado === "FALTANTE" ? "#7f1d1d" : estado === "PARCIAL" ? "#78350f" : "#1f2937"
            const icon = estado === "COMPLETO" ? "✅" : estado === "FALTANTE" ? "❌" : estado === "PARCIAL" ? "⚠️" : "⬜"
            return (
              <div key={item.id} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#f9fafb", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.articulos?.descripcion}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>{item.articulos?.sku}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ color: "#f9fafb", fontWeight: 700, fontSize: 15 }}>
                    {estado !== "PENDIENTE" ? item.cantidad_preparada : "—"}
                    <span style={{ color: "#6b7280", fontWeight: 400 }}> / {item.cantidad}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Barra inferior */}
      <div style={{ background: "#111827", borderTop: "1px solid #1f2937", padding: "12px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => setVista("scanner")}
          style={{ flex: 2, background: "#1e40af", color: "#fff", fontWeight: 700, fontSize: 18, padding: "18px 0", borderRadius: 18, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>📱</span> Escanear
        </button>
        {pendientes === 0 && (
          <button onClick={finalizarPicking} disabled={finalizando || saving}
            style={{ flex: 1, background: "#059669", color: "#fff", fontWeight: 700, fontSize: 15, padding: "18px 0", borderRadius: 18, border: "none", cursor: "pointer", opacity: finalizando ? 0.5 : 1 }}>
            {finalizando ? "..." : "✅ Finalizar"}
          </button>
        )}
      </div>
    </div>
  )
}
