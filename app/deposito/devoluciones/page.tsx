"use client"

import { useState, useEffect, useRef, useCallback } from "react"

interface DetalleDevolucion {
  id: string; cantidad: number; motivo?: string; es_vendible: boolean
  articulos: { id: string; sku: string; descripcion: string; ean13?: string }
}
interface Devolucion {
  id: string; numero_devolucion?: string; estado: string; observaciones?: string; created_at: string
  clientes: { nombre: string; razon_social?: string } | null
  devoluciones_detalle: DetalleDevolucion[]
}
interface ArticuloFound { id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number }

type Vista = "home" | "scanner" | "detalle" | "confirmar"

export default function DevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [vista, setVista] = useState<Vista>("home")

  // Scanner para buscar por artículo
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  // Devoluciones que contienen el artículo buscado
  const [devConArticulo, setDevConArticulo] = useState<{ dev: Devolucion; detalle: DetalleDevolucion }[]>([])
  const [articuloBuscado, setArticuloBuscado] = useState<ArticuloFound | null>(null)

  // Para confirmar una devolución
  const [devSeleccionada, setDevSeleccionada] = useState<Devolucion | null>(null)
  const [confirmados, setConfirmados] = useState<Record<string, boolean>>({})
  const [guardando, setGuardando] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => { cargarDevoluciones() }, [])
  useEffect(() => { if (vista === "scanner") setTimeout(() => inputRef.current?.focus(), 100) }, [vista])

  const cargarDevoluciones = () => {
    setLoading(true)
    fetch("/api/deposito/devoluciones")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setDevoluciones(data) })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }

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
    // Buscar en qué devoluciones aparece este artículo
    const coincidencias: { dev: Devolucion; detalle: DetalleDevolucion }[] = []
    devoluciones.forEach(dev => {
      dev.devoluciones_detalle.forEach(det => {
        if (det.articulos.id === art.id) coincidencias.push({ dev, detalle: det })
      })
    })
    setArticuloBuscado(art)
    setDevConArticulo(coincidencias)
    setBusqueda(""); setResultados([])
    setVista("detalle")
  }

  const abrirDevolucion = (dev: Devolucion) => {
    setDevSeleccionada(dev)
    const init: Record<string, boolean> = {}
    dev.devoluciones_detalle.forEach(d => { init[d.id] = d.es_vendible })
    setConfirmados(init)
    setVista("confirmar")
  }

  const confirmarDevolucion = async () => {
    if (!devSeleccionada) return
    setGuardando(true)
    try {
      const items_confirmados = devSeleccionada.devoluciones_detalle.map(d => ({
        detalle_id: d.id, articulo_id: d.articulos.id,
        cantidad_recibida: d.cantidad,
        es_vendible: confirmados[d.id] ?? d.es_vendible,
      }))
      const r = await fetch("/api/deposito/devoluciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devolucion_id: devSeleccionada.id, items_confirmados }),
      })
      const data = await r.json()
      if (data.ok) {
        setSuccess("✅ Devolución confirmada — ERP generará la nota de crédito")
        setVista("home"); setDevSeleccionada(null)
        setTimeout(() => { setSuccess(""); cargarDevoluciones() }, 3000)
      } else { setError(data.error || "Error al confirmar") }
    } catch { setError("Error de conexión") }
    finally { setGuardando(false) }
  }

  const s = { // styles shorthand
    card: { background: "#111827", border: "1px solid #1f2937", borderRadius: 20, padding: 16 } as React.CSSProperties,
    btn: (bg: string, color = "#fff") => ({ background: bg, color, fontWeight: 700, borderRadius: 18, border: "none", cursor: "pointer", padding: "16px 20px", fontSize: 16, width: "100%" } as React.CSSProperties),
  }

  // ── CONFIRMAR DEVOLUCIÓN ──
  if (vista === "confirmar" && devSeleccionada) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: "#030712" }}>
        <div style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f9fafb" }}>{devSeleccionada.numero_devolucion || "Devolución"}</div>
          <div style={{ color: "#a78bfa", fontSize: 14, marginTop: 2 }}>{devSeleccionada.clientes?.razon_social || devSeleccionada.clientes?.nombre}</div>
          {devSeleccionada.observaciones && <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4, fontStyle: "italic" }}>"{devSeleccionada.observaciones}"</div>}
        </div>
        <div style={{ background: "#1e1b4b", borderBottom: "1px solid #312e81", padding: "10px 16px" }}>
          <div style={{ color: "#c4b5fd", fontSize: 13 }}>⚠️ Confirmá si cada producto es <strong>vendible</strong> (mercadería sana) o <strong>no vendible</strong> (rota, vencida).</div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "12px 12px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 12 }}>
            {devSeleccionada.devoluciones_detalle.map(det => {
              const esVendible = confirmados[det.id] ?? det.es_vendible
              return (
                <div key={det.id} style={{ background: esVendible ? "#052e16" : "#450a0a", border: `1px solid ${esVendible ? "#14532d" : "#7f1d1d"}`, borderRadius: 16, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <span style={{ fontSize: 24 }}>{esVendible ? "✅" : "🚫"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#f9fafb", fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{det.articulos.descripcion}</div>
                      <div style={{ color: "#9ca3af", fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>{det.articulos.sku}</div>
                      {det.motivo && <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4, fontStyle: "italic" }}>{det.motivo}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#f9fafb", fontWeight: 700, fontSize: 18 }}>{det.cantidad}</div>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>unidades</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => setConfirmados(p => ({ ...p, [det.id]: true }))}
                      style={{ ...s.btn(esVendible ? "#059669" : "#1f2937", esVendible ? "#fff" : "#9ca3af"), padding: "12px" }}>
                      ✓ Vendible
                    </button>
                    <button onClick={() => setConfirmados(p => ({ ...p, [det.id]: false }))}
                      style={{ ...s.btn(!esVendible ? "#dc2626" : "#1f2937", !esVendible ? "#fff" : "#9ca3af"), padding: "12px" }}>
                      ✗ No vendible
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {error && <div style={{ margin: "0 12px", background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 12, padding: 12, color: "#fca5a5", textAlign: "center", fontSize: 13 }}>{error}</div>}
        <div style={{ background: "#111827", borderTop: "1px solid #1f2937", padding: "12px 16px", display: "flex", gap: 10 }}>
          <button onClick={() => setVista("home")} style={{ ...s.btn("#1f2937", "#9ca3af"), flex: 1 }}>← Volver</button>
          <button onClick={confirmarDevolucion} disabled={guardando} style={{ ...s.btn("#7c3aed"), flex: 2, opacity: guardando ? 0.5 : 1 }}>
            {guardando ? "Confirmando..." : "✅ Confirmar recepción"}
          </button>
        </div>
      </div>
    )
  }

  // ── RESULTADO DE BÚSQUEDA POR ARTÍCULO ──
  if (vista === "detalle" && articuloBuscado) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: "#030712" }}>
        <div style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={() => { setVista("home"); setArticuloBuscado(null); setDevConArticulo([]) }}
            style={{ width: 44, height: 44, borderRadius: 14, background: "#1f2937", border: "1px solid #374151", color: "#f9fafb", fontSize: 20, cursor: "pointer", flexShrink: 0 }}>←</button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f9fafb" }}>{articuloBuscado.descripcion}</div>
            <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "monospace" }}>{articuloBuscado.sku}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {devConArticulo.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#9ca3af" }}>Este artículo no está en ninguna devolución pendiente</div>
            </div>
          ) : (
            <>
              <div style={{ color: "#a78bfa", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
                {devConArticulo.length} devolución{devConArticulo.length > 1 ? "es" : ""} con este artículo:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {devConArticulo.map(({ dev, detalle }) => (
                  <button key={dev.id} onClick={() => abrirDevolucion(dev)}
                    style={{ textAlign: "left", background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 16, cursor: "pointer", width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ color: "#f9fafb", fontWeight: 700, fontSize: 16 }}>{dev.numero_devolucion || "DEV-" + dev.id.slice(0, 6)}</div>
                        <div style={{ color: "#a78bfa", fontSize: 13, marginTop: 2 }}>{dev.clientes?.razon_social || dev.clientes?.nombre}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#f9fafb", fontWeight: 700, fontSize: 20 }}>{detalle.cantidad}</div>
                        <div style={{ color: "#6b7280", fontSize: 11 }}>unidades</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: detalle.es_vendible ? "#052e16" : "#450a0a", color: detalle.es_vendible ? "#34d399" : "#f87171" }}>
                        {detalle.es_vendible ? "Vendible" : "No vendible"}
                      </span>
                      {detalle.motivo && <span style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>{detalle.motivo}</span>}
                    </div>
                    <div style={{ color: "#a78bfa", fontSize: 13, marginTop: 8, fontWeight: 600 }}>Confirmar esta devolución →</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── SCANNER ──
  if (vista === "scanner") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 64px)", background: "#030712" }}>
        <div style={{ padding: 16, background: "#111827", borderBottom: "1px solid #1f2937", display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={() => { setVista("home"); setBusqueda(""); setResultados([]) }}
            style={{ width: 44, height: 44, borderRadius: 14, background: "#1f2937", border: "1px solid #374151", color: "#f9fafb", fontSize: 20, cursor: "pointer", flexShrink: 0 }}>←</button>
          <input ref={inputRef} type="text" inputMode="search" placeholder="Escanear EAN o buscar artículo..." value={busqueda}
            onChange={e => { setBusqueda(e.target.value); buscarArticulo(e.target.value) }} autoFocus
            style={{ flex: 1, background: "#1f2937", color: "#f9fafb", fontSize: 17, borderRadius: 14, padding: "12px 16px", border: "1px solid #374151", outline: "none" }} />
        </div>
        {buscando && <div style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>Buscando...</div>}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {resultados.map(art => (
            <button key={art.id} onClick={() => seleccionarArticulo(art)}
              style={{ textAlign: "left", background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 16, cursor: "pointer", width: "100%" }}>
              <div style={{ color: "#f9fafb", fontWeight: 600, fontSize: 15 }}>{art.descripcion}</div>
              <div style={{ color: "#9ca3af", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>{art.sku} {art.ean13 && `• ${art.ean13}`}</div>
            </button>
          ))}
          {!busqueda && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 12, color: "#4b5563" }}>
              <div style={{ fontSize: 40 }}>📦</div>
              <div style={{ textAlign: "center", fontSize: 14 }}>Escaneá un artículo del camión<br />para ver a qué devolución pertenece</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── HOME ──
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 64px)", background: "#030712" }}>
      <div style={{ padding: "16px 16px 0" }}>
        {success && <div style={{ background: "#064e3b", border: "1px solid #065f46", borderRadius: 14, padding: "12px 16px", color: "#6ee7b7", fontSize: 14, marginBottom: 12 }}>{success}</div>}
        {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 14, padding: "12px 16px", color: "#fca5a5", fontSize: 14, marginBottom: 12 }}>{error}</div>}

        {/* Botón principal: escanear del camión */}
        <button onClick={() => setVista("scanner")}
          style={{ width: "100%", background: "linear-gradient(135deg, #7c3aed, #6d28d9)", color: "#fff", fontWeight: 700, fontSize: 18, padding: "20px 0", borderRadius: 20, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 4px 20px rgba(124,58,237,0.4)", marginBottom: 20 }}>
          <span style={{ fontSize: 26 }}>📦</span> Escanear artículo del camión
        </button>

        {/* Separador */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: "#1f2937" }} />
          <div style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>o ver listado</div>
          <div style={{ flex: 1, height: 1, background: "#1f2937" }} />
        </div>
      </div>

      {/* Lista de devoluciones */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px" }}>
        {loading && <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Cargando...</div>}
        {!loading && devoluciones.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>↩️</div>
            <div style={{ color: "#6b7280", fontSize: 16 }}>No hay devoluciones pendientes</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 20 }}>
          {devoluciones.map(dev => {
            const items = dev.devoluciones_detalle || []
            return (
              <button key={dev.id} onClick={() => abrirDevolucion(dev)}
                style={{ textAlign: "left", background: "#111827", border: "1px solid #1f2937", borderRadius: 20, padding: 16, cursor: "pointer", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ color: "#f9fafb", fontWeight: 700, fontSize: 17 }}>{dev.numero_devolucion || `DEV-${dev.id.slice(0, 6)}`}</div>
                    <div style={{ color: "#a78bfa", fontSize: 14, marginTop: 2 }}>{dev.clientes?.razon_social || dev.clientes?.nombre}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: "#4c1d95", color: "#c4b5fd" }}>Pendiente</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>
                  <span>📦 {items.length} artículo{items.length !== 1 ? "s" : ""}</span>
                  <span style={{ color: "#34d399" }}>✓ {items.filter(i => i.es_vendible).length} vendibles</span>
                  <span style={{ color: "#f87171" }}>✗ {items.filter(i => !i.es_vendible).length} no vendibles</span>
                </div>
                <div style={{ color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>Confirmar recepción →</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
