"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"

interface DetallePedido {
  id: string; articulo_id: string; cantidad: number
  cantidad_preparada: number; estado_item: string
  articulos: { id: string; sku: string; descripcion: string; ean13?: string; unidades_por_bulto?: number }
}
interface ArticuloFound { id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number }
type Vista = "lista" | "scanner" | "cantidad" | "faltantes"

const C = {
  bg: "#f4f6f9", white: "#ffffff", border: "#e5e7eb",
  text: "#111827", textSub: "#6b7280", textLight: "#9ca3af",
  orange: "#ea580c", orangeLight: "#fff7ed", orangeBorder: "#fed7aa",
  green: "#16a34a", greenLight: "#f0fdf4", greenBorder: "#bbf7d0",
  red: "#dc2626", redLight: "#fef2f2", redBorder: "#fecaca",
  yellow: "#d97706", yellowLight: "#fffbeb", yellowBorder: "#fde68a",
  gray: "#f3f4f6", grayBorder: "#e5e7eb",
}

export default function PickingPage() {
  const { id: pedidoId } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pedido, setPedido] = useState<any>(null)
  const [items, setItems] = useState<DetallePedido[]>([])
  const [vista, setVista] = useState<Vista>("lista")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [itemActivo, setItemActivo] = useState<DetallePedido | null>(null)
  const [cantidadInput, setCantidadInput] = useState("")
  const [finalizando, setFinalizando] = useState(false)
  const [toast, setToast] = useState<{msg: string; type: "ok"|"err"} | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    fetch("/api/deposito/picking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedido_id: pedidoId }) })
      .then(r => r.json()).then(data => {
        if (data.error) { showToast(data.error, "err"); return }
        setPedido(data.pedido)
        setItems(data.pedido.pedidos_detalle || [])
      }).catch(() => showToast("Error de conexión", "err"))
      .finally(() => setLoading(false))
  }, [pedidoId])

  useEffect(() => { if (vista === "scanner") setTimeout(() => inputRef.current?.focus(), 100) }, [vista])

  const showToast = (msg: string, type: "ok"|"err") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const buscarArticulo = useCallback((q: string) => {
    if (!q || q.length < 2) { setResultados([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setBuscando(true)
      try { setResultados(await (await fetch(`/api/deposito/picking?q=${encodeURIComponent(q)}`)).json()) }
      finally { setBuscando(false) }
    }, 300)
  }, [])

  const abrirItem = (item: DetallePedido) => {
    setItemActivo(item)
    setCantidadInput(String(item.cantidad))
    setVista("cantidad")
  }

  const seleccionarDeBusqueda = (art: ArticuloFound) => {
    const item = items.find(i => i.articulo_id === art.id)
    if (!item) { showToast(`"${art.descripcion}" no está en este pedido`, "err"); setBusqueda(""); setResultados([]); return }
    if (item.estado_item === "COMPLETO") { showToast("Este artículo ya está completo", "err"); setBusqueda(""); setResultados([]); return }
    abrirItem(item)
    setBusqueda(""); setResultados([])
  }

  const guardarCantidad = async (esFaltante = false) => {
    if (!itemActivo) return
    setSaving(true)
    try {
      const cantidad = esFaltante ? 0 : parseFloat(cantidadInput) || 0
      const r = await fetch("/api/deposito/picking/item", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_detalle_id: itemActivo.id, cantidad_preparada: cantidad, es_faltante: esFaltante, cantidad_pedida: itemActivo.cantidad }),
      })
      const data = await r.json()
      if (data.error) { showToast(data.error, "err"); return }
      setItems(prev => prev.map(i => i.id === itemActivo.id ? { ...i, cantidad_preparada: cantidad, estado_item: data.estado_item } : i))
      showToast(esFaltante ? "Marcado como faltante" : "✓ Guardado", "ok")
      setVista("lista"); setItemActivo(null); setCantidadInput("")
    } catch { showToast("Error al guardar", "err") }
    finally { setSaving(false) }
  }

  const devolverAPendiente = async (item: DetallePedido) => {
    setSaving(true)
    try {
      await fetch("/api/deposito/picking/item", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_detalle_id: item.id, cantidad_preparada: 0, es_faltante: false, cantidad_pedida: item.cantidad }),
      })
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, cantidad_preparada: 0, estado_item: "PENDIENTE" } : i))
      showToast("Devuelto a pendientes", "ok")
    } catch { showToast("Error", "err") }
    finally { setSaving(false) }
  }

  const finalizarPicking = async () => {
    const pendientes = items.filter(i => !i.estado_item || i.estado_item === "PENDIENTE").length
    if (pendientes > 0) {
      showToast(`Quedan ${pendientes} artículos sin resolver. Escaneálos o marcálos como faltantes.`, "err")
      return
    }
    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/picking/item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedido_id: pedidoId }) })
      const data = await r.json()
      if (data.ok) router.push("/deposito/preparar-pedidos")
      else showToast(data.error || "Error al finalizar", "err")
    } catch { showToast("Error de conexión", "err") }
    finally { setFinalizando(false) }
  }

  const completos = items.filter(i => i.estado_item === "COMPLETO" || i.estado_item === "PARCIAL").length
  const faltantesList = items.filter(i => i.estado_item === "FALTANTE")
  const pendientesList = items.filter(i => !i.estado_item || i.estado_item === "PENDIENTE")
  const pct = items.length > 0 ? Math.round(((completos + faltantesList.length) / items.length) * 100) : 0
  const todosResueltos = pendientesList.length === 0

  const btn = (label: string, onClick: () => void, bg: string, color = "#fff", disabled = false, full = true) => (
    <button onClick={onClick} disabled={disabled} style={{ width: full ? "100%" : "auto", background: disabled ? "#d1d5db" : bg, color: disabled ? "#9ca3af" : color, fontWeight: 700, fontSize: 16, padding: "16px 20px", borderRadius: 16, border: "none", cursor: disabled ? "not-allowed" : "pointer" }}>
      {label}
    </button>
  )

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: C.textLight }}>Cargando pedido...</div>

  // Toast
  const ToastEl = toast ? (
    <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: toast.type === "ok" ? C.green : C.red, color: "#fff", padding: "10px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 200, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
      {toast.msg}
    </div>
  ) : null

  // ── MODAL FALTANTES ──
  if (vista === "faltantes") return (
    <div style={{ background: C.bg, minHeight: "calc(100dvh - 64px)", padding: 16 }}>
      {ToastEl}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Artículos faltantes ({faltantesList.length})</div>
        <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>Podés devolverlos a la lista de pendientes</div>
      </div>
      {faltantesList.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No hay faltantes</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {faltantesList.map(item => (
          <div key={item.id} style={{ background: C.white, border: `1px solid ${C.redBorder}`, borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>❌</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.articulos?.descripcion}</div>
              <div style={{ color: C.textLight, fontSize: 12, fontFamily: "monospace" }}>{item.articulos?.sku}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.text, fontWeight: 700 }}>{item.cantidad}</div>
              <button onClick={() => devolverAPendiente(item)} disabled={saving} style={{ fontSize: 11, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: 8, padding: "3px 8px", cursor: "pointer", marginTop: 4, fontWeight: 600 }}>
                Mover a pendientes
              </button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setVista("lista")} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 600, fontSize: 15, padding: "14px", borderRadius: 16, border: `1px solid ${C.border}`, cursor: "pointer" }}>
        ← Volver a la lista
      </button>
    </div>
  )

  // ── MODAL CANTIDAD ──
  if (vista === "cantidad" && itemActivo) return (
    <div style={{ background: C.bg, minHeight: "calc(100dvh - 64px)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {ToastEl}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 11, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Artículo</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{itemActivo.articulos?.descripcion}</div>
        <div style={{ fontSize: 13, color: C.textSub, fontFamily: "monospace", marginTop: 6 }}>{itemActivo.articulos?.sku}</div>
      </div>
      <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: 14, padding: "14px 18px", textAlign: "center" }}>
        <div style={{ color: C.orange, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad pedida</div>
        <div style={{ color: C.orange, fontWeight: 800, fontSize: 44, lineHeight: 1.1 }}>{itemActivo.cantidad}</div>
        {itemActivo.cantidad_preparada > 0 && <div style={{ color: C.orange, fontSize: 12, marginTop: 2, opacity: 0.8 }}>Ya preparado: {itemActivo.cantidad_preparada}</div>}
      </div>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
        <div style={{ color: C.textSub, fontSize: 13, marginBottom: 8 }}>Cantidad que separaste físicamente:</div>
        <input type="number" inputMode="decimal" value={cantidadInput} onChange={e => setCantidadInput(e.target.value)} autoFocus
          style={{ width: "100%", background: C.bg, color: C.text, fontSize: 40, fontWeight: 800, textAlign: "center", borderRadius: 14, padding: "14px", border: `2px solid ${C.border}`, outline: "none", boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {btn(saving ? "..." : "✓ Confirmar", () => guardarCantidad(false), C.green, "#fff", saving)}
        {btn("✗ Faltante", () => guardarCantidad(true), C.red, "#fff", saving)}
      </div>
      <button onClick={() => { setVista("lista"); setItemActivo(null) }} style={{ background: C.white, color: C.textSub, fontWeight: 600, padding: "13px", borderRadius: 16, border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 15 }}>
        ← Cancelar
      </button>
    </div>
  )

  // ── SCANNER ──
  if (vista === "scanner") return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: C.bg }}>
      {ToastEl}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "10px 16px" }}>
        <div style={{ fontSize: 12, color: C.textSub }}>{pedido?.numero_pedido} · {pedido?.clientes?.razon_social || pedido?.clientes?.nombre}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 13 }}>
          <span style={{ color: C.yellow, fontWeight: 600 }}>⏳ {pendientesList.length} pendientes</span>
          <span style={{ color: C.green, fontWeight: 600 }}>✓ {completos} listos</span>
          {faltantesList.length > 0 && <span style={{ color: C.red, fontWeight: 600 }}>✗ {faltantesList.length} faltantes</span>}
        </div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        <input ref={inputRef} type="text" inputMode="search" placeholder="Escanear EAN o buscar por SKU / nombre..." value={busqueda}
          onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }} autoFocus
          style={{ width: "100%", background: C.white, color: C.text, fontSize: 16, borderRadius: 14, padding: "13px 16px", border: `1.5px solid ${C.border}`, outline: "none", boxSizing: "border-box", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }} />
      </div>
      {buscando && <div style={{ padding: "0 16px", color: C.textLight, fontSize: 13 }}>Buscando...</div>}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {resultados.map(art => {
          const enPedido = items.find(i => i.articulo_id === art.id)
          return (
            <button key={art.id} onClick={() => seleccionarDeBusqueda(art)}
              style={{ textAlign: "left", width: "100%", background: enPedido ? C.orangeLight : C.white, border: `1px solid ${enPedido ? C.orangeBorder : C.border}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 15 }}>{art.descripcion}</div>
              <div style={{ fontSize: 12, color: C.textSub, fontFamily: "monospace", marginTop: 4 }}>{art.sku}{art.ean13 && ` · ${art.ean13}`}</div>
              {enPedido && <div style={{ fontSize: 12, color: C.orange, marginTop: 4, fontWeight: 600 }}>Pedido: {enPedido.cantidad} u · {enPedido.estado_item || "PENDIENTE"}</div>}
            </button>
          )
        })}
        {!busqueda && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 10, color: C.textLight }}>
            <div style={{ fontSize: 40 }}>📱</div>
            <div style={{ textAlign: "center", fontSize: 14 }}>Escaneá el código de barras<br />o escribí para buscar</div>
          </div>
        )}
      </div>
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => setVista("lista")} style={{ flex: 1, background: C.gray, color: C.text, fontWeight: 600, padding: "15px 0", borderRadius: 14, border: "none", cursor: "pointer" }}>📋 Lista</button>
        {todosResueltos
          ? <button onClick={finalizarPicking} disabled={finalizando} style={{ flex: 1, background: C.green, color: "#fff", fontWeight: 700, padding: "15px 0", borderRadius: 14, border: "none", cursor: "pointer", opacity: finalizando ? 0.6 : 1 }}>{finalizando ? "..." : "✅ Finalizar"}</button>
          : <button onClick={() => showToast(`Faltan ${pendientesList.length} artículos`, "err")} style={{ flex: 1, background: "#d1d5db", color: "#9ca3af", fontWeight: 700, padding: "15px 0", borderRadius: 14, border: "none", cursor: "not-allowed" }}>✅ Finalizar</button>
        }
      </div>
    </div>
  )

  // ── LISTA PRINCIPAL ──
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: C.bg }}>
      {ToastEl}
      {/* Cabecera con progreso */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{pedido?.numero_pedido}</div>
            <div style={{ color: C.textSub, fontSize: 13, marginTop: 2 }}>{pedido?.clientes?.razon_social || pedido?.clientes?.nombre}</div>
          </div>
          {faltantesList.length > 0 && (
            <button onClick={() => setVista("faltantes")} style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: "5px 10px", fontSize: 12, fontWeight: 600, color: C.red, cursor: "pointer" }}>
              ✗ {faltantesList.length} faltante{faltantesList.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.textSub, marginBottom: 5 }}>
            <span><span style={{ color: C.green, fontWeight: 700 }}>{completos + faltantesList.length}</span> de {items.length} resueltos</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? C.green : C.text }}>{pct}%</span>
          </div>
          <div style={{ background: C.border, borderRadius: 999, height: 7, overflow: "hidden" }}>
            <div style={{ height: "100%", background: pct === 100 ? C.green : C.orange, borderRadius: 999, width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12 }}>
            <span style={{ color: C.yellow, fontWeight: 600 }}>⏳ {pendientesList.length}</span>
            <span style={{ color: C.green, fontWeight: 600 }}>✓ {completos}</span>
            {faltantesList.length > 0 && <span style={{ color: C.red, fontWeight: 600 }}>✗ {faltantesList.length}</span>}
          </div>
        </div>
      </div>

      {/* Lista de artículos */}
      <div style={{ flex: 1, overflow: "auto", padding: "10px 12px 0" }}>
        {/* Pendientes */}
        {pendientesList.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.1em", padding: "4px 2px 8px" }}>Pendientes ({pendientesList.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {pendientesList.map(item => (
                <button key={item.id} onClick={() => abrirItem(item)} style={{ textAlign: "left", width: "100%", background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fbbf24", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.text, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.articulos?.descripcion}</div>
                    <div style={{ color: C.textLight, fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>{item.articulos?.sku}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: 16 }}>{item.cantidad}</div>
                    <div style={{ color: C.textLight, fontSize: 11 }}>unidades</div>
                  </div>
                  <div style={{ color: C.textLight, fontSize: 18 }}>›</div>
                </button>
              ))}
            </div>
          </>
        )}
        {/* Completos */}
        {completos > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.1em", padding: "4px 2px 8px" }}>Listos ({completos})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {items.filter(i => i.estado_item === "COMPLETO" || i.estado_item === "PARCIAL").map(item => (
                <button key={item.id} onClick={() => abrirItem(item)} style={{ textAlign: "left", width: "100%", background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 14, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.text, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.articulos?.descripcion}</div>
                    <div style={{ color: C.textLight, fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>{item.articulos?.sku}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: C.green, fontWeight: 700, fontSize: 16 }}>{item.cantidad_preparada}<span style={{ color: C.textLight, fontWeight: 400, fontSize: 13 }}> / {item.cantidad}</span></div>
                    <div style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>{item.estado_item}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 12 }} />
      </div>

      {/* Barra inferior */}
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => setVista("scanner")} style={{ flex: 2, background: C.orange, color: "#fff", fontWeight: 700, fontSize: 17, padding: "17px 0", borderRadius: 16, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>📱</span> Escanear
        </button>
        {todosResueltos
          ? <button onClick={finalizarPicking} disabled={finalizando} style={{ flex: 1, background: C.green, color: "#fff", fontWeight: 700, fontSize: 15, padding: "17px 0", borderRadius: 16, border: "none", cursor: "pointer", opacity: finalizando ? 0.6 : 1 }}>{finalizando ? "..." : "✅ Listo"}</button>
          : <button onClick={() => showToast(`Faltan ${pendientesList.length} artículos`, "err")} style={{ flex: 1, background: "#f3f4f6", color: "#9ca3af", fontWeight: 700, fontSize: 15, padding: "17px 0", borderRadius: 16, border: `1px solid ${C.border}`, cursor: "not-allowed" }}>✅ Listo</button>
        }
      </div>
    </div>
  )
}
