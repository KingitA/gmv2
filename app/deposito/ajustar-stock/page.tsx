"use client"

import { useState, useRef, useCallback } from "react"
import { actualizarDatosArticulo, ajustarStock, getArticuloExtra } from "@/lib/actions/deposito"

interface Articulo {
  id: string
  sku: string
  descripcion: string
  ean13: string[] | null
  cantidad_stock: number | null
  unidades_por_bulto: number | null
  unidad_de_medida: string | null
  tipo_fraccion: string | null
  cantidad_fraccion: number | null
}

type TipoAjuste = "entrada" | "salida" | "correccion"
type Seccion = "datos" | "stock"

export default function ModificacionArticulosPage() {
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articulo, setArticulo] = useState<Articulo | null>(null)
  const [seccion, setSeccion] = useState<Seccion>("stock")

  // datos
  const [ean13, setEan13] = useState<string[]>([])
  const [eanInput, setEanInput] = useState("")
  const [unidadesBulto, setUnidadesBulto] = useState("")
  const [unidadMedida, setUnidadMedida] = useState("")
  const [tipoFraccion, setTipoFraccion] = useState("")
  const [cantidadFraccion, setCantidadFraccion] = useState("")
  const [guardandoDatos, setGuardandoDatos] = useState(false)
  const [msgDatos, setMsgDatos] = useState<{ ok: boolean; txt: string } | null>(null)

  // stock
  const [tipo, setTipo] = useState<TipoAjuste>("correccion")
  const [cantidad, setCantidad] = useState("")
  const [motivo, setMotivo] = useState("")
  const [guardandoStock, setGuardandoStock] = useState(false)
  const [msgStock, setMsgStock] = useState<{ ok: boolean; txt: string } | null>(null)

  const timeout = useRef<NodeJS.Timeout>()

  const buscar = useCallback((q: string) => {
    setBusqueda(q)
    setResultados([])
    if (!q || q.length < 2) return
    clearTimeout(timeout.current)
    timeout.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch(`/api/deposito/picking?q=${encodeURIComponent(q)}`)
        const data = await r.json()
        setResultados(Array.isArray(data) ? data : [])
      } finally { setBuscando(false) }
    }, 300)
  }, [])

  const seleccionar = async (art: Articulo) => {
    setArticulo(art)
    setEan13(Array.isArray(art.ean13) ? art.ean13 : (art.ean13 ? [art.ean13] : []))
    setEanInput("")
    setUnidadesBulto(art.unidades_por_bulto ? String(art.unidades_por_bulto) : "")
    setUnidadMedida(art.unidad_de_medida || "")
    setTipoFraccion("")
    setCantidadFraccion("")
    setCantidad(tipo === "correccion" ? String(art.cantidad_stock ?? 0) : "")
    setMotivo("")
    setMsgDatos(null)
    setMsgStock(null)
    setBusqueda("")
    setResultados([])
    // Cargar campos extra (tipo_fraccion, cantidad_fraccion) en background
    try {
      const extra = await getArticuloExtra(art.id)
      if (extra) {
        setTipoFraccion(extra.tipo_fraccion || "")
        setCantidadFraccion(extra.cantidad_fraccion ? String(extra.cantidad_fraccion) : "")
      }
    } catch { /* columnas aún no migradas, ignorar */ }
  }

  const guardarDatos = async () => {
    if (!articulo) return
    setGuardandoDatos(true)
    setMsgDatos(null)
    try {
      await actualizarDatosArticulo(articulo.id, {
        ean13: ean13.length > 0 ? ean13 : null,
        unidades_por_bulto: unidadesBulto ? parseInt(unidadesBulto) : undefined,
        unidad_de_medida: unidadMedida || undefined,
        tipo_fraccion: tipoFraccion || null,
        cantidad_fraccion: cantidadFraccion ? parseInt(cantidadFraccion) : null,
      })
      setArticulo(a => a ? { ...a, ean13: ean13.length > 0 ? ean13 : null, unidades_por_bulto: unidadesBulto ? parseInt(unidadesBulto) : null, unidad_de_medida: unidadMedida || null, tipo_fraccion: tipoFraccion || null, cantidad_fraccion: cantidadFraccion ? parseInt(cantidadFraccion) : null } : a)
    } catch (e: any) {
      setMsgDatos({ ok: false, txt: e.message || "Error al guardar" })
    }
    setGuardandoDatos(false)
  }

  const aplicarStock = async () => {
    if (!articulo || !cantidad) { setMsgStock({ ok: false, txt: "Ingresá una cantidad" }); return }
    setGuardandoStock(true)
    setMsgStock(null)
    try {
      const res = await ajustarStock(articulo.id, parseFloat(cantidad), tipo, motivo)
      setArticulo(a => a ? { ...a, cantidad_stock: res.nuevoStock } : a)
      setCantidad(tipo === "correccion" ? String(res.nuevoStock) : "")
      setMotivo("")
      setMsgStock({ ok: true, txt: `✓ Stock actualizado: ${res.nuevoStock} ${articulo.unidad_de_medida || "UN"}` })
    } catch (e: any) {
      setMsgStock({ ok: false, txt: e.message || "Error al guardar" })
    }
    setGuardandoStock(false)
  }

  const stockResultante = () => {
    if (!articulo || !cantidad) return null
    const c = parseFloat(cantidad) || 0
    const s = articulo.cantidad_stock ?? 0
    if (tipo === "correccion") return c
    if (tipo === "entrada") return s + c
    return s - c
  }

  const C = {
    page: { minHeight: "calc(100dvh - 64px)", background: "#111827", color: "#f9fafb", display: "flex", flexDirection: "column" as const },
    searchBar: { background: "#1f2937", borderBottom: "1px solid #374151", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 },
    searchInput: { flex: 1, background: "#374151", border: "1px solid #4b5563", borderRadius: 14, padding: "14px 18px", color: "#f9fafb", fontSize: 17, outline: "none" },
    clearBtn: { width: 44, height: 44, borderRadius: 12, background: "#374151", border: "1px solid #4b5563", color: "#9ca3af", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 as const },
    results: { flex: 1, overflowY: "auto" as const, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 8 },
    artBtn: { background: "#1f2937", border: "1px solid #374151", borderRadius: 16, padding: "16px 18px", textAlign: "left" as const, cursor: "pointer", width: "100%" },
    artName: { color: "#f9fafb", fontWeight: 700, fontSize: 17, lineHeight: 1.3 },
    artSub: { color: "#9ca3af", fontSize: 14, marginTop: 4, display: "flex", gap: 16 },
    artStock: { color: "#34d399", fontWeight: 700 },

    artSelected: { background: "#1f2937", borderBottom: "1px solid #374151", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    artSelectedInfo: { flex: 1 },
    artSelectedName: { color: "#f9fafb", fontWeight: 700, fontSize: 16, lineHeight: 1.3 },
    artSelectedSub: { color: "#6b7280", fontSize: 13, marginTop: 2 },
    stockBadge: { background: "#065f46", color: "#34d399", borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" as const },
    changeBtn: { background: "#374151", border: "1px solid #4b5563", borderRadius: 10, padding: "8px 14px", color: "#9ca3af", fontSize: 13, cursor: "pointer" },

    tabs: { display: "flex", borderBottom: "1px solid #374151" },
    tab: (active: boolean, color: string) => ({
      flex: 1, padding: "16px", fontWeight: 700, fontSize: 15, textAlign: "center" as const, cursor: "pointer",
      background: active ? "#1f2937" : "transparent",
      color: active ? color : "#6b7280",
      borderBottom: active ? `3px solid ${color}` : "3px solid transparent",
    }),

    body: { flex: 1, overflowY: "auto" as const, padding: "16px", display: "flex", flexDirection: "column" as const, gap: 14 },
    card: { background: "#1f2937", border: "1px solid #374151", borderRadius: 16, padding: "18px" },
    label: { color: "#9ca3af", fontSize: 13, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8, display: "block" },
    input: { width: "100%", background: "#374151", border: "1px solid #4b5563", borderRadius: 12, padding: "14px 16px", color: "#f9fafb", fontSize: 17, outline: "none", boxSizing: "border-box" as const },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
    typeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 },
    typeBtn: (active: boolean, color: string) => ({
      padding: "14px 8px", borderRadius: 12, fontWeight: 700, fontSize: 15, textAlign: "center" as const, cursor: "pointer", border: "none",
      background: active ? color : "#374151", color: active ? "#fff" : "#9ca3af",
    }),
    bigInput: { width: "100%", background: "#374151", border: "2px solid #4b5563", borderRadius: 14, padding: "18px", color: "#f9fafb", fontSize: 28, fontWeight: 700, textAlign: "center" as const, outline: "none", boxSizing: "border-box" as const },
    resultante: { textAlign: "center" as const, marginTop: 10, fontSize: 15, color: "#9ca3af" },
    saveBtn: (color: string, disabled: boolean) => ({
      width: "100%", padding: "18px", borderRadius: 16, fontWeight: 700, fontSize: 17, border: "none", cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? "#374151" : color, color: disabled ? "#6b7280" : "#fff",
      opacity: disabled ? 0.7 : 1,
    }),
    msg: (ok: boolean) => ({
      padding: "12px 16px", borderRadius: 12, fontSize: 15, fontWeight: 600, textAlign: "center" as const,
      background: ok ? "#064e3b" : "#7f1d1d", color: ok ? "#34d399" : "#fca5a5",
    }),
    empty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 12, color: "#4b5563" },
  }

  // ── BUSQUEDA ─────────────────────────────────────────────
  return (
    <div style={C.page}>
      {/* Barra de búsqueda */}
      <div style={C.searchBar}>
        <input
          style={C.searchInput}
          type="text" inputMode="search"
          placeholder="Escanear EAN o buscar SKU / descripción..."
          value={busqueda}
          onChange={e => buscar(e.target.value)}
          autoFocus={!articulo}
        />
        {(busqueda || articulo) && (
          <button style={C.clearBtn} onClick={() => { setBusqueda(""); setResultados([]); setArticulo(null) }}>✕</button>
        )}
      </div>

      {/* Resultados de búsqueda — se muestran siempre que haya texto, aunque haya artículo cargado */}
      {busqueda.length >= 2 && (
        <>
          {buscando && <div style={{ padding: "16px", color: "#6b7280", fontSize: 15, textAlign: "center" }}>Buscando...</div>}
          {resultados.length > 0 && (
            <div style={C.results}>
              {resultados.map(art => (
                <button key={art.id} style={C.artBtn} onClick={() => seleccionar(art)}>
                  <div style={C.artName}>{art.descripcion}</div>
                  <div style={C.artSub}>
                    <span style={{ fontFamily: "monospace" }}>{art.sku}</span>
                    <span>Stock: <span style={C.artStock}>{art.cantidad_stock ?? 0}</span></span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!buscando && resultados.length === 0 && (
            <div style={C.empty}>
              <span style={{ fontSize: 16 }}>Sin resultados para &quot;{busqueda}&quot;</span>
            </div>
          )}
        </>
      )}

      {/* Estado vacío inicial */}
      {!articulo && busqueda.length < 2 && (
        <div style={C.empty}>
          <span style={{ fontSize: 48 }}>🔧</span>
          <span style={{ fontSize: 16 }}>Buscá un artículo para modificarlo</span>
        </div>
      )}

      {/* Artículo seleccionado — solo visible cuando no hay búsqueda activa */}
      {articulo && busqueda.length < 2 && (
        <>
          <div style={C.artSelected}>
            <div style={C.artSelectedInfo}>
              <div style={C.artSelectedName}>{articulo.descripcion}</div>
              <div style={C.artSelectedSub}>{articulo.sku}{articulo.ean13?.length ? ` · ${articulo.ean13.join(', ')}` : ""}</div>
            </div>
            <div style={C.stockBadge}>Stock: {articulo.cantidad_stock ?? 0}</div>
            <button style={C.changeBtn} onClick={() => { setArticulo(null); setBusqueda("") }}>Cambiar</button>
          </div>

          {/* Tabs */}
          <div style={C.tabs}>
            <div style={C.tab(seccion === "stock", "#f59e0b")} onClick={() => setSeccion("stock")}>Ajustar Stock</div>
            <div style={C.tab(seccion === "datos", "#60a5fa")} onClick={() => setSeccion("datos")}>Datos del Artículo</div>
          </div>

          <div style={C.body}>
            {/* ── STOCK ─────────────────────────── */}
            {seccion === "stock" && (
              <>
                <div style={C.card}>
                  <span style={C.label}>Tipo de movimiento</span>
                  <div style={C.typeGrid}>
                    {([["entrada", "#16a34a", "📥 Entrada"], ["salida", "#dc2626", "📤 Salida"], ["correccion", "#d97706", "✏️ Corrección"]] as const).map(([t, color, label]) => (
                      <button key={t} style={C.typeBtn(tipo === t, color)} onClick={() => { setTipo(t); setCantidad(t === "correccion" ? String(articulo.cantidad_stock ?? 0) : "") }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={C.card}>
                  <span style={C.label}>
                    {tipo === "correccion" ? "Nuevo stock (valor final)" : tipo === "entrada" ? "Cantidad a ingresar" : "Cantidad a retirar"}
                  </span>
                  <input
                    style={C.bigInput}
                    type="number" inputMode="decimal"
                    value={cantidad}
                    onChange={e => setCantidad(e.target.value)}
                    autoFocus
                  />
                  {stockResultante() !== null && (
                    <div style={C.resultante}>
                      Stock resultante: <strong style={{ color: (stockResultante() ?? 0) < 0 ? "#f87171" : "#34d399", fontSize: 18 }}>{stockResultante()}</strong>
                    </div>
                  )}
                </div>

                <div style={C.card}>
                  <span style={C.label}>Motivo (opcional)</span>
                  <input
                    style={C.input}
                    type="text"
                    placeholder="Ej: conteo físico, rotura, devolución..."
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                  />
                </div>

                {msgStock && <div style={C.msg(msgStock.ok)}>{msgStock.txt}</div>}

                <button
                  style={C.saveBtn(tipo === "entrada" ? "#16a34a" : tipo === "salida" ? "#dc2626" : "#d97706", guardandoStock)}
                  onClick={aplicarStock}
                  disabled={guardandoStock}
                >
                  {guardandoStock ? "Guardando..." : tipo === "entrada" ? "Registrar Entrada" : tipo === "salida" ? "Registrar Salida" : "Aplicar Corrección"}
                </button>
              </>
            )}

            {/* ── DATOS ─────────────────────────── */}
            {seccion === "datos" && (
              <>
                <div style={C.card}>
                  <span style={C.label}>EAN 13 <span style={{ color: "#6b7280", fontWeight: 400, textTransform: "none" as const }}>— puede tener varios</span></span>
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, background: "#374151", border: "1px solid #4b5563", borderRadius: 12, padding: "10px 12px", minHeight: 48 }}>
                    {ean13.map((e, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#1f2937", border: "1px solid #4b5563", borderRadius: 20, padding: "4px 10px", color: "#e5e7eb", fontSize: 14, fontFamily: "monospace" }}>
                        {e}
                        <button type="button" onClick={() => setEan13(p => p.filter((_, j) => j !== i))} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    ))}
                    <input
                      type="text" inputMode="numeric"
                      value={eanInput}
                      onChange={e => setEanInput(e.target.value)}
                      placeholder={ean13.length === 0 ? "Escribí un EAN y presioná Enter..." : "Agregar otro..."}
                      style={{ flex: 1, minWidth: 140, background: "transparent", border: "none", outline: "none", color: "#f9fafb", fontSize: 15 }}
                      onKeyDown={e => {
                        if ((e.key === "Enter" || e.key === ",") && eanInput.trim()) {
                          e.preventDefault()
                          const v = eanInput.trim()
                          if (!ean13.includes(v)) setEan13(p => [...p, v])
                          setEanInput("")
                        }
                      }}
                      onBlur={() => {
                        if (eanInput.trim()) {
                          const v = eanInput.trim()
                          if (!ean13.includes(v)) setEan13(p => [...p, v])
                          setEanInput("")
                        }
                      }}
                    />
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>Enter o coma para agregar · × para quitar</div>
                </div>

                <div style={{ ...C.card, ...C.row2 }}>
                  <div>
                    <span style={C.label}>Unid. por bulto</span>
                    <input style={C.input} type="number" inputMode="numeric" placeholder="—" value={unidadesBulto} onChange={e => setUnidadesBulto(e.target.value)} />
                  </div>
                  <div>
                    <span style={C.label}>Unidad de medida</span>
                    <input style={{ ...C.input, textTransform: "uppercase" }} type="text" placeholder="UN" value={unidadMedida} onChange={e => setUnidadMedida(e.target.value.toUpperCase())} />
                  </div>
                </div>

                <div style={{ ...C.card, ...C.row2 }}>
                  <div>
                    <span style={C.label}>Tipo de fracción</span>
                    <input style={C.input} type="text" placeholder="pack, blister, docena..." value={tipoFraccion} onChange={e => setTipoFraccion(e.target.value)} />
                  </div>
                  <div>
                    <span style={C.label}>Unidades / fracción</span>
                    <input style={C.input} type="number" inputMode="numeric" placeholder="—" value={cantidadFraccion} onChange={e => setCantidadFraccion(e.target.value)} />
                  </div>
                </div>

                {msgDatos && !msgDatos.ok && <div style={C.msg(false)}>{msgDatos.txt}</div>}

                <button style={C.saveBtn("#2563eb", guardandoDatos)} onClick={guardarDatos} disabled={guardandoDatos}>
                  {guardandoDatos ? "Guardando..." : "Guardar Datos"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
