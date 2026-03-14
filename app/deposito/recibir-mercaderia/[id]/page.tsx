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

export default function RecibirMercaderiaDetallePage() {
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

  const [scannerOpen, setScannerOpen] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)

  const [itemEditando, setItemEditando] = useState<RecepcionItem | null>(null)
  const [articuloModal, setArticuloModal] = useState<ArticuloFound | null>(null)
  const [cantidadInput, setCantidadInput] = useState("")

  const [finalizando, setFinalizando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  const scanInputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    fetch("/api/deposito/recepciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orden_compra_id: ordenId }),
    })
      .then(r => r.json())
      .then(async recData => {
        if (recData.error) { setError(recData.error); return }
        setRecepcion(recData)
        setDocumentos(recData.recepciones_documentos || [])
        const ordRes = await fetch("/api/deposito/recepciones")
        const ordenes = await ordRes.json()
        const ord = Array.isArray(ordenes) ? ordenes.find((o: any) => o.id === ordenId) : null
        setOrden(ord)
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
    if (scannerOpen) setTimeout(() => scanInputRef.current?.focus(), 100)
  }, [scannerOpen])

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

  const abrirItemDirecto = (item: RecepcionItem) => {
    setItemEditando(item)
    setArticuloModal({ id: item.articulo_id, sku: item.articulos?.sku || "", descripcion: item.articulos?.descripcion || item.articulo_id, ean13: item.articulos?.ean13, stock_actual: 0, unidades_por_bulto: item.articulos?.unidades_por_bulto })
    setCantidadInput(String(item.cantidad_oc))
    setScannerOpen(false)
  }

  const seleccionarDeBusqueda = (art: ArticuloFound) => {
    const item = items.find(i => i.articulo_id === art.id)
    setItemEditando(item || null)
    setArticuloModal(art)
    setCantidadInput(item ? String(item.cantidad_oc) : "")
    setBusqueda(""); setResultados([]); setScannerOpen(false)
  }

  const confirmarCantidad = async (esFaltante = false) => {
    if (!articuloModal || !recepcion) return
    setSaving(true)
    try {
      const cantidad = esFaltante ? 0 : parseFloat(cantidadInput) || 0
      const r = await fetch("/api/deposito/recepciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recepcion_id: recepcion.id, articulo_id: articuloModal.id, cantidad_fisica: cantidad }),
      })
      if (!r.ok) throw new Error()
      setItems(prev => prev.map(i => i.articulo_id === articuloModal.id ? { ...i, cantidad_fisica: cantidad, estado_linea: cantidad > 0 ? "ok" : "pendiente" } : i))
      setItemEditando(null); setArticuloModal(null)
      showSuccess(esFaltante ? "Marcado como faltante" : "✓ Guardado")
    } catch { setError("Error al guardar") }
    finally { setSaving(false) }
  }

  const subirFoto = async (file: File) => {
    if (!recepcion) return
    setSubiendo(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("recepcion_id", recepcion.id)
      formData.append("tipo_documento", "remito")
      const r = await fetch("/api/deposito/recepciones/documento", { method: "POST", body: formData })
      if (r.ok) { const doc = await r.json(); setDocumentos(prev => [...prev, doc]); showSuccess("📎 Adjuntado") }
    } finally { setSubiendo(false) }
  }

  const finalizarRecepcion = async () => {
    const pend = items.filter(i => i.estado_linea === "pendiente").length
    if (pend > 0) {
      showSuccess(`❌ Faltan ${pend} artículos por recibir o marcar como faltante. No podés finalizar.`)
      return
    }
    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/recepciones", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recepcion_id: recepcion.id, finalizar: true }) })
      const data = await r.json()
      if (data.ok) router.push("/deposito/recibir-mercaderia")
      else setError(data.error || "Error")
    } catch { setError("Error") }
    finally { setFinalizando(false) }
  }

  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 2500) }

  const recibidos = items.filter(i => i.estado_linea === "ok").length
  const pendientes = items.filter(i => i.estado_linea === "pendiente").length
  const pct = items.length > 0 ? Math.round((recibidos / items.length) * 100) : 0

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#9ca3af" }}>Cargando orden...</div>

  // Modal cantidad
  if (articuloModal) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#030712", zIndex: 100, display: "flex", flexDirection: "column", padding: 16, gap: 12, overflow: "auto" }}>
        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 20, padding: 20 }}>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Artículo</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb", lineHeight: 1.3 }}>{articuloModal.descripcion}</div>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "monospace", marginTop: 6 }}>{articuloModal.sku}</div>
        </div>
        {itemEditando && (
          <div style={{ background: "#064e3b", border: "1px solid #065f46", borderRadius: 16, padding: "14px 20px", textAlign: "center" }}>
            <div style={{ color: "#6ee7b7", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad en OC</div>
            <div style={{ color: "#ecfdf5", fontWeight: 700, fontSize: 40 }}>{itemEditando.cantidad_oc}</div>
          </div>
        )}
        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 20, padding: 16 }}>
          <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>Cantidad recibida físicamente:</div>
          <input type="number" inputMode="decimal" value={cantidadInput} onChange={e => setCantidadInput(e.target.value)} autoFocus
            style={{ width: "100%", background: "#1f2937", color: "#f9fafb", fontSize: 40, fontWeight: 700, textAlign: "center", borderRadius: 14, padding: "14px", border: "2px solid #374151", outline: "none", boxSizing: "border-box" }} />
        </div>
        {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 12, padding: 12, color: "#fca5a5", textAlign: "center", fontSize: 13 }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={() => confirmarCantidad(false)} disabled={saving} style={{ background: "#059669", color: "#fff", fontWeight: 700, fontSize: 18, padding: 18, borderRadius: 18, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>✓ Confirmar</button>
          <button onClick={() => confirmarCantidad(true)} disabled={saving} style={{ background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 18, padding: 18, borderRadius: 18, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>✗ Faltante</button>
        </div>
        <button onClick={() => { setItemEditando(null); setArticuloModal(null) }} style={{ background: "#1f2937", color: "#9ca3af", fontWeight: 600, padding: 14, borderRadius: 18, border: "none", cursor: "pointer", fontSize: 15 }}>← Cancelar</button>
      </div>
    )
  }

  // Scanner overlay
  if (scannerOpen) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#030712", zIndex: 100, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px", background: "#111827", borderBottom: "1px solid #1f2937", display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={() => { setScannerOpen(false); setBusqueda(""); setResultados([]) }} style={{ width: 44, height: 44, borderRadius: 14, background: "#1f2937", border: "1px solid #374151", color: "#f9fafb", fontSize: 20, cursor: "pointer", flexShrink: 0 }}>←</button>
          <input ref={scanInputRef} type="text" inputMode="search" placeholder="Escanear EAN o buscar..." value={busqueda} onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }} autoFocus
            style={{ flex: 1, background: "#1f2937", color: "#f9fafb", fontSize: 17, borderRadius: 14, padding: "12px 16px", border: "1px solid #374151", outline: "none" }} />
        </div>
        {buscando && <div style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>Buscando...</div>}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {resultados.map(art => {
            const enOrden = items.find(i => i.articulo_id === art.id)
            return (
              <button key={art.id} onClick={() => seleccionarDeBusqueda(art)}
                style={{ textAlign: "left", width: "100%", background: enOrden ? "#064e3b" : "#111827", border: `1px solid ${enOrden ? "#065f46" : "#1f2937"}`, borderRadius: 16, padding: 16, cursor: "pointer" }}>
                <div style={{ color: "#f9fafb", fontWeight: 600, fontSize: 15 }}>{art.descripcion}</div>
                <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace", marginTop: 4 }}>{art.sku} {art.ean13 && `• ${art.ean13}`}</div>
                {enOrden && <div style={{ fontSize: 12, color: "#34d399", marginTop: 4 }}>OC: {enOrden.cantidad_oc} u • Recibido: {enOrden.cantidad_fisica}</div>}
              </button>
            )
          })}
          {!busqueda && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 12, color: "#4b5563" }}><div style={{ fontSize: 40 }}>📱</div><div style={{ textAlign: "center", fontSize: 14 }}>Escaneá el código de barras<br />o escribí para buscar</div></div>}
        </div>
      </div>
    )
  }

  // Vista principal
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: "#030712" }}>
      {/* Cabecera OC */}
      <div style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb" }}>{orden?.numero_orden || "Recepción"}</div>
            <div style={{ color: "#34d399", fontWeight: 600, fontSize: 14, marginTop: 2 }}>🏭 {orden?.proveedores?.nombre || "Sin proveedor"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) subirFoto(e.target.files[0]) }} />
            <button onClick={() => fileRef.current?.click()} disabled={subiendo}
              style={{ width: 54, height: 54, borderRadius: 16, background: "#1e3a5f", border: "2px solid #3b82f6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 26 }}>
              {subiendo ? "⏳" : "📷"}
            </button>
            <div style={{ fontSize: 10, color: "#6b7280" }}>{documentos.length > 0 ? `${documentos.length} foto${documentos.length > 1 ? "s" : ""}` : "Adjuntar"}</div>
          </div>
        </div>
        {/* Progreso */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginBottom: 5 }}>
            <span><span style={{ color: "#34d399", fontWeight: 600 }}>{recibidos}</span> de {items.length} recibidos</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? "#34d399" : "#f9fafb" }}>{pct}%</span>
          </div>
          <div style={{ background: "#1f2937", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", background: pct === 100 ? "#059669" : "#3b82f6", borderRadius: 999, width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12 }}>
            <span style={{ color: "#34d399" }}>✓ {recibidos}</span>
            <span style={{ color: "#f59e0b" }}>⏳ {pendientes}</span>
          </div>
        </div>
      </div>

      {/* Lista artículos */}
      <div style={{ flex: 1, overflow: "auto", padding: "10px 12px 0" }}>
        {successMsg && <div style={{ background: "#064e3b", border: "1px solid #065f46", borderRadius: 12, padding: "10px 16px", color: "#6ee7b7", textAlign: "center", fontSize: 13, marginBottom: 10 }}>{successMsg}</div>}
        {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 12, padding: "10px 16px", color: "#fca5a5", textAlign: "center", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 10 }}>
          {items.map(item => {
            const ok = item.estado_linea === "ok"
            return (
              <button key={item.id} onClick={() => abrirItemDirecto(item)}
                style={{ textAlign: "left", width: "100%", background: ok ? "#052e16" : "#111827", border: `1px solid ${ok ? "#14532d" : "#1f2937"}`, borderRadius: 14, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{ok ? "✅" : "⬜"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#f9fafb", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.articulos?.descripcion || item.articulo_id}</div>
                  <div style={{ color: "#6b7280", fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>{item.articulos?.sku}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: ok ? "#34d399" : "#9ca3af" }}>{ok ? item.cantidad_fisica : "—"}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>/ {item.cantidad_oc}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Barra inferior fija */}
      <div style={{ background: "#111827", borderTop: "1px solid #1f2937", padding: "12px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => setScannerOpen(true)}
          style={{ flex: 2, background: "#1e40af", color: "#fff", fontWeight: 700, fontSize: 18, padding: "18px 0", borderRadius: 18, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>📱</span> Escanear
        </button>
        <button onClick={finalizarRecepcion} disabled={finalizando}
          style={{ flex: 1, background: "#059669", color: "#fff", fontWeight: 700, fontSize: 15, padding: "18px 0", borderRadius: 18, border: "none", cursor: "pointer", opacity: finalizando ? 0.5 : 1, textAlign: "center" }}>
          {finalizando ? "..." : "✅ Finalizar OC"}
        </button>
      </div>
    </div>
  )
}
