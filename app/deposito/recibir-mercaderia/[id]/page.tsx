"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"

interface RecepcionItem {
  id: string; articulo_id: string; cantidad_oc: number; cantidad_fisica: number
  estado_linea: "pendiente" | "ok" | "faltante"
  articulos?: { sku: string; descripcion: string; ean13?: string; unidades_por_bulto?: number }
}
interface ArticuloFound { id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number }

const C = {
  bg:"#f4f6f9", white:"#ffffff", border:"#e5e7eb",
  text:"#111827", sub:"#6b7280", light:"#9ca3af",
  green:"#16a34a", greenL:"#f0fdf4", greenB:"#bbf7d0",
  orange:"#ea580c", orangeL:"#fff7ed", orangeB:"#fed7aa",
  red:"#dc2626", redL:"#fef2f2", redB:"#fecaca",
  yellow:"#d97706",
}

function ItemRowOC({ item, onFaltante, saving }: { item: RecepcionItem; onFaltante: (item: RecepcionItem) => void; saving: boolean }) {
  const [dx, setDx] = useState(0)
  const startX = useRef(0)
  const ok = item.estado_linea === "ok"
  const faltante = item.estado_linea === "faltante"

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX }
  const onTouchMove = (e: React.TouchEvent) => {
    const diff = startX.current - e.touches[0].clientX
    setDx(diff > 0 ? Math.min(diff, 90) : 0)
  }
  const onTouchEnd = () => { if (dx > 55) { onFaltante(item); setDx(0) } else setDx(0) }

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, marginBottom: 8 }}>
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 90, background: C.red, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0 16px 16px 0" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#fff", fontSize: 22, fontWeight: 700 }}>✕</div>
          <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, marginTop: 2 }}>FALTANTE</div>
        </div>
      </div>
      <div
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ position: "relative", background: ok ? C.greenL : faltante ? C.redL : C.white, border: `1.5px solid ${ok ? C.greenB : faltante ? C.redB : C.border}`, borderRadius: 16, padding: "15px 16px", display: "flex", alignItems: "center", gap: 14, transform: `translateX(-${dx}px)`, transition: dx === 0 ? "transform 0.2s" : "none", userSelect: "none" }}
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: ok ? C.green : faltante ? C.red : "#fbbf24", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.articulos?.descripcion || item.articulo_id}</div>
          <div style={{ color: C.light, fontSize: 12, fontFamily: "monospace", marginTop: 3 }}>{item.articulos?.sku}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {ok ? (
            <>
              <div style={{ color: C.green, fontWeight: 800, fontSize: 20 }}>{item.cantidad_fisica}</div>
              <div style={{ color: C.light, fontSize: 12 }}>de {item.cantidad_oc}</div>
            </>
          ) : faltante ? (
            <div style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>FALTANTE</div>
          ) : (
            <>
              <div style={{ color: C.text, fontWeight: 800, fontSize: 20 }}>{item.cantidad_oc}</div>
              <div style={{ color: C.light, fontSize: 12 }}>esperadas</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function RecibirMercaderiaDetallePage() {
  const { id: ordenId } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orden, setOrden] = useState<any>(null)
  const [recepcion, setRecepcion] = useState<any>(null)
  const [items, setItems] = useState<RecepcionItem[]>([])
  const [documentos, setDocumentos] = useState<any[]>([])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articuloSel, setArticuloSel] = useState<ArticuloFound | null>(null)
  const [itemActivo, setItemActivo] = useState<RecepcionItem | null>(null)
  const [cantidadInput, setCantidadInput] = useState("")
  const [finalizando, setFinalizando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [vistaFaltantes, setVistaFaltantes] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tipo: "ok" | "err" } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    fetch("/api/deposito/recepciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orden_compra_id: ordenId }) })
      .then(r => r.json()).then(async recData => {
        if (recData.error) { showToast(recData.error, "err"); return }
        setRecepcion(recData); setDocumentos(recData.recepciones_documentos || [])
        const ordenes = await (await fetch("/api/deposito/recepciones")).json()
        const ord = Array.isArray(ordenes) ? ordenes.find((o: any) => o.id === ordenId) : null
        setOrden(ord)
        const merged = (recData.recepciones_items || []).map((ri: any) => {
          const det = ord?.ordenes_compra_detalle?.find((d: any) => d.articulo_id === ri.articulo_id)
          return { ...ri, estado_linea: ri.estado_linea || "pendiente", articulos: det?.articulos }
        })
        setItems(merged)
      }).catch(() => showToast("Error de conexión", "err")).finally(() => setLoading(false))
  }, [ordenId])

  useEffect(() => { if (scannerOpen) setTimeout(() => inputRef.current?.focus(), 100) }, [scannerOpen])

  const showToast = (msg: string, tipo: "ok" | "err") => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 3000) }

  const buscarArticulo = useCallback((q: string) => {
    if (!q || q.length < 2) { setResultados([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setBuscando(true)
      try { setResultados(await (await fetch(`/api/deposito/picking?q=${encodeURIComponent(q)}`)).json()) }
      finally { setBuscando(false) }
    }, 300)
  }, [])

  const seleccionarDeBusqueda = (art: ArticuloFound) => {
    const item = items.find(i => i.articulo_id === art.id)
    setArticuloSel(art); setItemActivo(item || null)
    setCantidadInput(item ? String(item.cantidad_oc) : "")
    setBusqueda(""); setResultados([]); setScannerOpen(false)
  }

  const guardarCantidad = async (esFaltante = false) => {
    if (!articuloSel || !recepcion) return
    setSaving(true)
    try {
      const cantidad = esFaltante ? 0 : parseFloat(cantidadInput) || 0
      const r = await fetch("/api/deposito/recepciones", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recepcion_id: recepcion.id, articulo_id: articuloSel.id, cantidad_fisica: cantidad }),
      })
      if (!r.ok) throw new Error()
      setItems(prev => prev.map(i => i.articulo_id === articuloSel.id
        ? { ...i, cantidad_fisica: cantidad, estado_linea: esFaltante ? "faltante" : cantidad > 0 ? "ok" : "pendiente" }
        : i
      ))
      showToast(esFaltante ? "Marcado como faltante" : "✓ Guardado", "ok")
      setArticuloSel(null); setItemActivo(null); setCantidadInput("")
    } catch { showToast("Error al guardar", "err") }
    finally { setSaving(false) }
  }

  const marcarFaltanteSwipe = async (item: RecepcionItem) => {
    if (!recepcion) return
    setSaving(true)
    try {
      await fetch("/api/deposito/recepciones", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recepcion_id: recepcion.id, articulo_id: item.articulo_id, cantidad_fisica: 0 }),
      })
      setItems(prev => prev.map(i => i.articulo_id === item.articulo_id ? { ...i, cantidad_fisica: 0, estado_linea: "faltante" } : i))
      showToast("Marcado como faltante", "ok")
    } finally { setSaving(false) }
  }

  const devolverAPendiente = async (item: RecepcionItem) => {
    if (!recepcion) return
    setSaving(true)
    try {
      await fetch("/api/deposito/recepciones", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recepcion_id: recepcion.id, articulo_id: item.articulo_id, cantidad_fisica: -1 }), // -1 = volver a pendiente
      })
      setItems(prev => prev.map(i => i.articulo_id === item.articulo_id ? { ...i, cantidad_fisica: 0, estado_linea: "pendiente" } : i))
      showToast("Devuelto a pendientes", "ok")
    } finally { setSaving(false) }
  }

  const subirFoto = async (file: File) => {
    if (!recepcion) return
    setSubiendo(true)
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("recepcion_id", recepcion.id); fd.append("tipo_documento", "remito")
      const r = await fetch("/api/deposito/recepciones/documento", { method: "POST", body: fd })
      if (r.ok) { const doc = await r.json(); setDocumentos(prev => [...prev, doc]); showToast("📎 Foto adjuntada", "ok") }
    } finally { setSubiendo(false) }
  }

  const finalizarRecepcion = async () => {
    const pendientes = items.filter(i => i.estado_linea === "pendiente").length
    if (pendientes > 0) { showToast(`Faltan ${pendientes} artículos por escanear o marcar`, "err"); return }
    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/recepciones", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recepcion_id: recepcion.id, finalizar: true }) })
      const data = await r.json()
      if (data.ok) router.push("/deposito/recibir-mercaderia")
      else showToast(data.error || "Error al finalizar", "err")
    } catch { showToast("Error", "err") }
    finally { setFinalizando(false) }
  }

  const recibidos = items.filter(i => i.estado_linea === "ok").length
  const faltantesList = items.filter(i => i.estado_linea === "faltante")
  const pendientesList = items.filter(i => i.estado_linea === "pendiente")
  const pct = items.length > 0 ? Math.round(((recibidos + faltantesList.length) / items.length) * 100) : 0
  const todosResueltos = pendientesList.length === 0

  const Toast = toast ? (
    <div style={{ position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)", background: toast.tipo === "ok" ? C.green : C.red, color: "#fff", padding: "11px 22px", borderRadius: 14, fontSize: 15, fontWeight: 600, zIndex: 300, whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
      {toast.msg}
    </div>
  ) : null

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: C.light }}>Cargando orden...</div>

  // ── MODAL CANTIDAD ──
  if (articuloSel) return (
    <div style={{ background: C.bg, minHeight: "calc(100dvh - 64px)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      {Toast}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: 20 }}>
        <div style={{ fontSize: 12, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Artículo</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{articuloSel.descripcion}</div>
        <div style={{ fontSize: 14, color: C.sub, fontFamily: "monospace", marginTop: 8 }}>{articuloSel.sku}</div>
      </div>
      {itemActivo && (
        <div style={{ background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
          <div style={{ color: C.green, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad en OC</div>
          <div style={{ color: C.green, fontWeight: 800, fontSize: 52, lineHeight: 1.1 }}>{itemActivo.cantidad_oc}</div>
        </div>
      )}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: 18 }}>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 10 }}>Cantidad recibida físicamente:</div>
        <input type="number" inputMode="decimal" value={cantidadInput} onChange={e => setCantidadInput(e.target.value)} autoFocus
          style={{ width: "100%", background: C.bg, color: C.text, fontSize: 48, fontWeight: 800, textAlign: "center", borderRadius: 16, padding: "16px", border: `2px solid ${C.border}`, outline: "none", boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button onClick={() => guardarCantidad(false)} disabled={saving} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 20, padding: 20, borderRadius: 20, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>
          {saving ? "..." : "✓ Confirmar"}
        </button>
        <button onClick={() => guardarCantidad(true)} disabled={saving} style={{ background: C.red, color: "#fff", fontWeight: 800, fontSize: 20, padding: 20, borderRadius: 20, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>
          ✕ Faltante
        </button>
      </div>
      <button onClick={() => { setArticuloSel(null); setItemActivo(null); setScannerOpen(true) }} style={{ background: C.white, color: C.sub, fontWeight: 600, padding: 16, borderRadius: 18, border: `1.5px solid ${C.border}`, cursor: "pointer", fontSize: 16 }}>
        ← Volver al scanner
      </button>
    </div>
  )

  // ── SCANNER ──
  if (scannerOpen) return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: C.bg }}>
      {Toast}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{orden?.numero_orden}</div>
        <div style={{ color: C.green, fontWeight: 600, fontSize: 14, marginTop: 2 }}>🏭 {orden?.proveedores?.nombre}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 14 }}>
          <span style={{ color: C.yellow, fontWeight: 700 }}>⏳ {pendientesList.length}</span>
          <span style={{ color: C.green, fontWeight: 700 }}>✓ {recibidos}</span>
          {faltantesList.length > 0 && <span style={{ color: C.red, fontWeight: 700 }}>✕ {faltantesList.length}</span>}
        </div>
      </div>
      <div style={{ padding: "14px 16px" }}>
        <input ref={inputRef} type="text" inputMode="search" placeholder="Escanear EAN o buscar artículo..." value={busqueda}
          onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }} autoFocus
          style={{ width: "100%", background: C.white, color: C.text, fontSize: 17, borderRadius: 16, padding: "15px 18px", border: `1.5px solid ${C.border}`, outline: "none", boxSizing: "border-box", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }} />
      </div>
      {buscando && <div style={{ padding: "0 16px 8px", color: C.light, fontSize: 14 }}>Buscando...</div>}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {resultados.map(art => {
          const enOrden = items.find(i => i.articulo_id === art.id)
          return (
            <button key={art.id} onClick={() => seleccionarDeBusqueda(art)}
              style={{ textAlign: "left", width: "100%", background: enOrden?.estado_linea === "ok" ? C.greenL : enOrden ? C.orangeL : C.white, border: `1.5px solid ${enOrden?.estado_linea === "ok" ? C.greenB : enOrden ? C.orangeB : C.border}`, borderRadius: 16, padding: 18, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 16 }}>{art.descripcion}</div>
              <div style={{ fontSize: 13, color: C.sub, fontFamily: "monospace", marginTop: 5 }}>{art.sku}{art.ean13 && ` · ${art.ean13}`}</div>
              {enOrden && <div style={{ fontSize: 13, color: enOrden.estado_linea === "ok" ? C.green : C.orange, marginTop: 5, fontWeight: 600 }}>
                OC: {enOrden.cantidad_oc} u · Recibido: {enOrden.cantidad_fisica} · {enOrden.estado_linea.toUpperCase()}
              </div>}
            </button>
          )
        })}
        {!busqueda && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 14, color: C.light }}>
            <div style={{ fontSize: 56, lineHeight: 1 }}>📱</div>
            <div style={{ textAlign: "center", fontSize: 15, lineHeight: 1.5 }}>Escaneá el código de barras<br />o escribí para buscar</div>
          </div>
        )}
      </div>
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => { setScannerOpen(false); setBusqueda(""); setResultados([]) }}
          style={{ flex: 1, background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, border: `1.5px solid ${C.border}`, cursor: "pointer" }}>
          📋 Lista
        </button>
        {todosResueltos
          ? <button onClick={finalizarRecepcion} disabled={finalizando} style={{ flex: 1, background: C.green, color: "#fff", fontWeight: 800, fontSize: 17, padding: "17px 0", borderRadius: 16, border: "none", cursor: "pointer", opacity: finalizando ? 0.6 : 1 }}>{finalizando ? "..." : "✅ Finalizar"}</button>
          : <button onClick={() => showToast(`Faltan ${pendientesList.length} artículos`, "err")} style={{ flex: 1, background: "#e5e7eb", color: C.light, fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, border: "none", cursor: "not-allowed" }}>✅ Finalizar</button>
        }
      </div>
    </div>
  )

  // ── VISTA FALTANTES ──
  if (vistaFaltantes) return (
    <div style={{ background: C.bg, minHeight: "calc(100dvh - 64px)", padding: 20 }}>
      {Toast}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Artículos faltantes ({faltantesList.length})</div>
        <div style={{ fontSize: 14, color: C.sub, marginTop: 4 }}>Podés devolverlos a la lista de pendientes</div>
      </div>
      {faltantesList.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: C.light }}>No hay faltantes</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {faltantesList.map(item => (
          <div key={item.id} style={{ background: C.white, border: `1.5px solid ${C.redB}`, borderRadius: 16, padding: "15px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.articulos?.descripcion}</div>
              <div style={{ color: C.light, fontSize: 13, fontFamily: "monospace", marginTop: 3 }}>{item.articulos?.sku}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.text, fontWeight: 800, fontSize: 18 }}>{item.cantidad_oc}</div>
              <button onClick={() => devolverAPendiente(item)} disabled={saving} style={{ fontSize: 12, color: C.orange, background: C.orangeL, border: `1px solid ${C.orangeB}`, borderRadius: 10, padding: "5px 10px", cursor: "pointer", marginTop: 6, fontWeight: 700, display: "block" }}>
                ↩ Pendiente
              </button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setVistaFaltantes(false)} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}`, cursor: "pointer" }}>
        ← Volver a la lista
      </button>
    </div>
  )

  // ── LISTA PRINCIPAL ──
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: C.bg }}>
      {Toast}
      {/* Cabecera */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{orden?.numero_orden || "Recepción"}</div>
            <div style={{ color: C.green, fontWeight: 600, fontSize: 14, marginTop: 3 }}>🏭 {orden?.proveedores?.nombre}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) subirFoto(e.target.files[0]) }} />
            <button onClick={() => fileRef.current?.click()} disabled={subiendo}
              style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 14, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#1d4ed8" }}>
              {subiendo ? "⏳" : "📷"} {documentos.length > 0 ? `${documentos.length} foto${documentos.length > 1 ? "s" : ""}` : "Foto"}
            </button>
            {faltantesList.length > 0 && (
              <button onClick={() => setVistaFaltantes(true)} style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: C.red, cursor: "pointer" }}>
                ✕ {faltantesList.length} faltante{faltantesList.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
        {/* Progreso */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.sub, marginBottom: 6 }}>
            <span><span style={{ color: C.green, fontWeight: 700 }}>{recibidos + faltantesList.length}</span> de {items.length} resueltos</span>
            <span style={{ fontWeight: 800, color: pct === 100 ? C.green : C.text, fontSize: 14 }}>{pct}%</span>
          </div>
          <div style={{ background: C.border, borderRadius: 999, height: 8 }}>
            <div style={{ height: "100%", background: pct === 100 ? C.green : "#22c55e", borderRadius: 999, width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 7, fontSize: 13 }}>
            <span style={{ color: C.yellow, fontWeight: 700 }}>⏳ {pendientesList.length}</span>
            <span style={{ color: C.green, fontWeight: 700 }}>✓ {recibidos}</span>
            {faltantesList.length > 0 && <span style={{ color: C.red, fontWeight: 700 }}>✕ {faltantesList.length}</span>}
          </div>
        </div>
      </div>

      {/* Hint swipe */}
      {pendientesList.length > 0 && (
        <div style={{ background: C.greenL, borderBottom: `1px solid ${C.greenB}`, padding: "10px 18px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 16 }}>👈</span>
          <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>Swipeá para marcar como faltante · Escaneá para registrar cantidad</span>
        </div>
      )}

      {/* Lista */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 0" }}>
        {pendientesList.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", padding: "2px 2px 10px" }}>Pendientes ({pendientesList.length})</div>
            {pendientesList.map(item => <ItemRowOC key={item.id} item={item} onFaltante={marcarFaltanteSwipe} saving={saving} />)}
          </>
        )}
        {recibidos > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", padding: "8px 2px 10px" }}>Recibidos ({recibidos})</div>
            {items.filter(i => i.estado_linea === "ok").map(item => <ItemRowOC key={item.id} item={item} onFaltante={marcarFaltanteSwipe} saving={saving} />)}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      {/* Barra inferior */}
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 12 }}>
        <button onClick={() => setScannerOpen(true)} style={{ flex: 2, background: C.green, color: "#fff", fontWeight: 800, fontSize: 19, padding: "19px 0", borderRadius: 18, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>📱</span> Escanear
        </button>
        {todosResueltos
          ? <button onClick={finalizarRecepcion} disabled={finalizando} style={{ flex: 1, background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "19px 0", borderRadius: 18, border: "none", cursor: "pointer", opacity: finalizando ? 0.6 : 1, background: "#15803d" }}>{finalizando ? "..." : "✅ Finalizar"}</button>
          : <button onClick={() => showToast(`Faltan ${pendientesList.length} artículos`, "err")} style={{ flex: 1, background: "#f3f4f6", color: C.light, fontWeight: 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}`, cursor: "not-allowed" }}>✅ Finalizar</button>
        }
      </div>
    </div>
  )
}
