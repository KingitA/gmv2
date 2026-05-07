"use client"

import { useState, useRef, useEffect } from "react"
import {
  actualizarDatosArticulo, ajustarStock, getArticuloExtra,
  buscarArticulosDeposito, getProveedoresDeposito, getCategoriasDeposito,
  cargarSesionDeposito,
} from "@/lib/actions/deposito"

interface Articulo {
  id: string
  sku: string
  descripcion: string
  ean13: string[] | null
  stock_actual: number | null
  unidades_por_bulto: number | null
  unidad_de_medida: string | null
  tipo_fraccion: string | null
  cantidad_fraccion: number | null
  orden_deposito?: number | null
  proveedor?: { nombre: string } | null
}

type TipoAjuste = "entrada" | "salida" | "correccion"
type Seccion   = "datos" | "stock"
type FiltroPanel = "prov" | "cat" | null

export default function ModificacionArticulosPage() {
  // ── Búsqueda individual ───────────────────────────────
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articulo, setArticulo] = useState<Articulo | null>(null)
  const [seccion, setSeccion] = useState<Seccion>("stock")

  // ── Filtros ───────────────────────────────────────────
  const [proveedores, setProveedores] = useState<{id:string;nombre:string}[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [filtroProveedor, setFiltroProveedor] = useState<{id:string;nombre:string}|null>(null)
  const [filtroCategoria, setFiltroCategoria] = useState<string|null>(null)
  const [panelFiltro, setPanelFiltro] = useState<FiltroPanel>(null)
  const [busqFiltro, setBusqFiltro] = useState("")

  // ── Sesión de conteo ──────────────────────────────────
  const [modoSesion, setModoSesion] = useState(false)
  const [sesionArts, setSesionArts] = useState<Articulo[]>([])
  const [sesionIdx, setSesionIdx] = useState(0)
  const [cargandoSesion, setCargandoSesion] = useState(false)
  const [sesionDone, setSesionDone] = useState(false)

  // ── Error búsqueda ────────────────────────────────────
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)

  // ── Datos artículo ────────────────────────────────────
  const [ean13, setEan13] = useState<string[]>([])
  const [eanInput, setEanInput] = useState("")
  const [unidadesBulto, setUnidadesBulto] = useState("")
  const [unidadMedida, setUnidadMedida] = useState("")
  const [tipoFraccion, setTipoFraccion] = useState("")
  const [cantidadFraccion, setCantidadFraccion] = useState("")
  const [guardandoDatos, setGuardandoDatos] = useState(false)
  const [msgDatos, setMsgDatos] = useState<{ ok: boolean; txt: string } | null>(null)

  // ── Stock ─────────────────────────────────────────────
  const [tipo, setTipo] = useState<TipoAjuste>("correccion")
  const [cantidad, setCantidad] = useState("")
  const [motivo, setMotivo] = useState("")
  const [guardandoStock, setGuardandoStock] = useState(false)
  const [msgStock, setMsgStock] = useState<{ ok: boolean; txt: string } | null>(null)

  const debounce = useRef<NodeJS.Timeout>()

  // ── Init ─────────────────────────────────────────────
  useEffect(() => {
    getProveedoresDeposito().then(setProveedores)
    getCategoriasDeposito().then(setCategorias)
  }, [])

  // Búsqueda reactiva (modo individual)
  useEffect(() => {
    if (modoSesion) return
    const hayFiltro = !!(filtroProveedor || filtroCategoria)
    if (!busqueda && !hayFiltro) { setResultados([]); return }
    if (busqueda.length > 0 && busqueda.length < 2 && !hayFiltro) return

    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setBuscando(true)
      setErrorBusqueda(null)
      try {
        const res = await buscarArticulosDeposito(busqueda, {
          proveedorId: filtroProveedor?.id,
          categoria: filtroCategoria ?? undefined,
        })
        if (res.error) setErrorBusqueda(res.error)
        setResultados(res.data as Articulo[])
      } catch (e: any) {
        setResultados([])
        setErrorBusqueda(e?.message || "Error al buscar")
      }
      finally { setBuscando(false) }
    }, 250)
    return () => clearTimeout(debounce.current)
  }, [busqueda, filtroProveedor, filtroCategoria, modoSesion])

  // ── Helpers de sesión ─────────────────────────────────
  const iniciarSesion = async () => {
    if (!filtroProveedor && !filtroCategoria) return
    setCargandoSesion(true)
    try {
      const res = await cargarSesionDeposito({
        proveedorId: filtroProveedor?.id,
        categoria: filtroCategoria ?? undefined,
      })
      if (res.error) { alert("Error al cargar: " + res.error); return }
      if (res.data.length === 0) { alert("No hay artículos con ese filtro"); return }
      setSesionArts(res.data as Articulo[])
      setSesionIdx(0)
      setSesionDone(false)
      setModoSesion(true)
      cargarArticuloSesion(res.data[0] as Articulo)
    } finally { setCargandoSesion(false) }
  }

  const cargarArticuloSesion = async (art: Articulo) => {
    setArticulo(art)
    setEan13(Array.isArray(art.ean13) ? art.ean13 : (art.ean13 ? [art.ean13] : []))
    setEanInput("")
    setUnidadesBulto(art.unidades_por_bulto ? String(art.unidades_por_bulto) : "")
    setUnidadMedida(art.unidad_de_medida || "")
    setTipoFraccion("")
    setCantidadFraccion("")
    setTipo("correccion")
    setCantidad(String(art.stock_actual ?? 0))
    setMotivo("")
    setMsgDatos(null)
    setMsgStock(null)
    try {
      const extra = await getArticuloExtra(art.id)
      if (extra) {
        setTipoFraccion(extra.tipo_fraccion || "")
        setCantidadFraccion(extra.cantidad_fraccion ? String(extra.cantidad_fraccion) : "")
      }
    } catch { /* columnas opcionales */ }
  }

  const avanzarSesion = (delta: 1 | -1) => {
    const next = sesionIdx + delta
    if (next < 0 || next >= sesionArts.length) return
    setSesionIdx(next)
    cargarArticuloSesion(sesionArts[next])
    setMsgStock(null)
  }

  const salirSesion = () => {
    setModoSesion(false); setSesionArts([]); setSesionIdx(0); setSesionDone(false)
    setArticulo(null); setBusqueda("")
  }

  // ── Helpers modo individual ───────────────────────────
  const seleccionar = async (art: Articulo) => {
    setArticulo(art)
    setEan13(Array.isArray(art.ean13) ? art.ean13 : (art.ean13 ? [art.ean13] : []))
    setEanInput("")
    setUnidadesBulto(art.unidades_por_bulto ? String(art.unidades_por_bulto) : "")
    setUnidadMedida(art.unidad_de_medida || "")
    setTipoFraccion(""); setCantidadFraccion("")
    setCantidad(tipo === "correccion" ? String(art.stock_actual ?? 0) : "")
    setMotivo(""); setMsgDatos(null); setMsgStock(null)
    setBusqueda(""); setResultados([]); setPanelFiltro(null)
    try {
      const extra = await getArticuloExtra(art.id)
      if (extra) {
        setTipoFraccion(extra.tipo_fraccion || "")
        setCantidadFraccion(extra.cantidad_fraccion ? String(extra.cantidad_fraccion) : "")
      }
    } catch { /* columnas opcionales */ }
  }

  const limpiarTodo = () => {
    setBusqueda(""); setResultados([]); setArticulo(null)
    setFiltroProveedor(null); setFiltroCategoria(null); setPanelFiltro(null)
    if (modoSesion) salirSesion()
  }

  const guardarDatos = async () => {
    if (!articulo) return
    setGuardandoDatos(true); setMsgDatos(null)
    try {
      await actualizarDatosArticulo(articulo.id, {
        ean13: ean13.length > 0 ? ean13 : null,
        unidades_por_bulto: unidadesBulto ? parseInt(unidadesBulto) : undefined,
        unidad_de_medida: unidadMedida || undefined,
        tipo_fraccion: tipoFraccion || null,
        cantidad_fraccion: cantidadFraccion ? parseInt(cantidadFraccion) : null,
      })
      setMsgDatos({ ok: true, txt: "✓ Datos guardados" })
    } catch (e: any) { setMsgDatos({ ok: false, txt: e.message || "Error al guardar" }) }
    setGuardandoDatos(false)
  }

  const aplicarStock = async (yAvanzar = false) => {
    if (!articulo || !cantidad) { setMsgStock({ ok: false, txt: "Ingresá una cantidad" }); return }
    setGuardandoStock(true); setMsgStock(null)
    try {
      const res = await ajustarStock(articulo.id, parseFloat(cantidad), tipo, motivo)
      // Actualizar el artículo en la cola de sesión también
      if (modoSesion) {
        setSesionArts(prev => prev.map((a, i) => i === sesionIdx ? { ...a, stock_actual: res.nuevoStock } : a))
      }
      setArticulo(a => a ? { ...a, stock_actual: res.nuevoStock } : a)
      setCantidad(tipo === "correccion" ? String(res.nuevoStock) : "")
      setMotivo("")
      setMsgStock({ ok: true, txt: `✓ Stock: ${res.nuevoStock} ${articulo.unidad_de_medida || "UN"}` })
      if (yAvanzar) {
        const next = sesionIdx + 1
        if (next >= sesionArts.length) { setSesionDone(true); return }
        setTimeout(() => avanzarSesion(1), 400)
      }
    } catch (e: any) { setMsgStock({ ok: false, txt: e.message || "Error al guardar" }) }
    setGuardandoStock(false)
  }

  const stockResultante = () => {
    if (!articulo || !cantidad) return null
    const c = parseFloat(cantidad) || 0, s = articulo.stock_actual ?? 0
    if (tipo === "correccion") return c
    if (tipo === "entrada") return s + c
    return s - c
  }

  const mostrarResultados = !modoSesion && (busqueda.length >= 2 || !!(filtroProveedor || filtroCategoria))
  const hayFiltroActivo  = !!(filtroProveedor || filtroCategoria)

  // ── Estilos ───────────────────────────────────────────
  const C = {
    page: { minHeight: "calc(100dvh - 64px)", background: "#111827", color: "#f9fafb", display: "flex", flexDirection: "column" as const },
    searchBar: { background: "#1f2937", borderBottom: "1px solid #374151", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 },
    searchInput: { flex: 1, background: "#374151", border: "1px solid #4b5563", borderRadius: 14, padding: "14px 18px", color: "#f9fafb", fontSize: 17, outline: "none" },
    clearBtn: { width: 44, height: 44, borderRadius: 12, background: "#374151", border: "1px solid #4b5563", color: "#9ca3af", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 as const },

    filterBar: { background: "#1f2937", borderBottom: "1px solid #374151", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const },
    filterChip: (active: boolean) => ({
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "8px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
      background: active ? "#312e81" : "#374151",
      border: `1px solid ${active ? "#6366f1" : "#4b5563"}`,
      color: active ? "#a5b4fc" : "#9ca3af",
    }),
    chipX: { marginLeft: 2, color: "#a5b4fc", fontSize: 15, lineHeight: 1 },
    startBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer", background: "#16a34a", border: "none", color: "#fff", marginLeft: "auto" },

    filterPanel: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, background: "#111827", zIndex: 50, display: "flex", flexDirection: "column" as const },
    filterSearch: { background: "#374151", border: "1px solid #4b5563", borderRadius: 12, padding: "12px 16px", color: "#f9fafb", fontSize: 16, outline: "none", margin: "12px 14px 4px" },
    filterHeader: { padding: "14px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    filterTitle: { color: "#f9fafb", fontWeight: 700, fontSize: 17 },
    filterList: { flex: 1, overflowY: "auto" as const, padding: "4px 10px 20px" },
    filterItem: (active: boolean) => ({
      padding: "14px 16px", borderRadius: 12, margin: "4px 0", cursor: "pointer",
      background: active ? "#312e81" : "transparent",
      color: active ? "#a5b4fc" : "#e5e7eb",
      fontWeight: active ? 700 : 400, fontSize: 15,
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }),

    // Sesión
    sesionHeader: { background: "#1f2937", borderBottom: "1px solid #374151", padding: "10px 14px" },
    sesionLabel: { color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em" },
    sesionProgress: { marginTop: 6, height: 4, background: "#374151", borderRadius: 99 },
    sesionBar: (pct: number) => ({ height: 4, borderRadius: 99, background: "#16a34a", width: `${pct}%`, transition: "width 0.3s" }),
    sesionNav: { display: "flex", gap: 8, padding: "10px 14px", background: "#1f2937", borderBottom: "1px solid #374151" },
    navBtn: (disabled: boolean) => ({
      flex: 1, padding: "12px", borderRadius: 12, fontWeight: 700, fontSize: 14, border: "none", cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? "#1f2937" : "#374151", color: disabled ? "#374151" : "#9ca3af",
      border: `1px solid ${disabled ? "#1f2937" : "#4b5563"}` as any,
    }),
    skipBtn: { flex: 1, padding: "12px", borderRadius: 12, fontWeight: 700, fontSize: 14, border: "1px solid #4b5563", cursor: "pointer", background: "transparent", color: "#9ca3af" },
    saveNextBtn: (disabled: boolean) => ({
      flex: 2, padding: "12px", borderRadius: 12, fontWeight: 700, fontSize: 15, border: "none", cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? "#374151" : "#16a34a", color: disabled ? "#6b7280" : "#fff",
    }),

    results: { flex: 1, overflowY: "auto" as const, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 8 },
    artBtn: { background: "#1f2937", border: "1px solid #374151", borderRadius: 16, padding: "14px 18px", textAlign: "left" as const, cursor: "pointer", width: "100%" },
    artName: { color: "#f9fafb", fontWeight: 700, fontSize: 16, lineHeight: 1.3 },
    artSub: { color: "#9ca3af", fontSize: 13, marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" as const },
    artStock: { color: "#34d399", fontWeight: 700 },

    artSelected: { background: "#1f2937", borderBottom: "1px solid #374151", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    artSelectedInfo: { flex: 1, minWidth: 0 },
    artSelectedName: { color: "#f9fafb", fontWeight: 700, fontSize: 15, lineHeight: 1.3 },
    artSelectedSub: { color: "#6b7280", fontSize: 12, marginTop: 2 },
    stockBadge: { background: "#065f46", color: "#34d399", borderRadius: 10, padding: "6px 10px", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" as const },
    changeBtn: { background: "#374151", border: "1px solid #4b5563", borderRadius: 10, padding: "8px 12px", color: "#9ca3af", fontSize: 12, cursor: "pointer" },

    tabs: { display: "flex", borderBottom: "1px solid #374151" },
    tab: (active: boolean, color: string) => ({
      flex: 1, padding: "14px", fontWeight: 700, fontSize: 14, textAlign: "center" as const, cursor: "pointer",
      background: active ? "#1f2937" : "transparent", color: active ? color : "#6b7280",
      borderBottom: active ? `3px solid ${color}` : "3px solid transparent",
    }),
    body: { flex: 1, overflowY: "auto" as const, padding: "14px", display: "flex", flexDirection: "column" as const, gap: 12 },
    card: { background: "#1f2937", border: "1px solid #374151", borderRadius: 16, padding: "16px" },
    label: { color: "#9ca3af", fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8, display: "block" },
    input: { width: "100%", background: "#374151", border: "1px solid #4b5563", borderRadius: 12, padding: "12px 14px", color: "#f9fafb", fontSize: 16, outline: "none", boxSizing: "border-box" as const },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    typeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 },
    typeBtn: (active: boolean, color: string) => ({
      padding: "12px 6px", borderRadius: 12, fontWeight: 700, fontSize: 14, textAlign: "center" as const, cursor: "pointer", border: "none",
      background: active ? color : "#374151", color: active ? "#fff" : "#9ca3af",
    }),
    bigInput: { width: "100%", background: "#374151", border: "2px solid #4b5563", borderRadius: 14, padding: "16px", color: "#f9fafb", fontSize: 32, fontWeight: 700, textAlign: "center" as const, outline: "none", boxSizing: "border-box" as const },
    resultante: { textAlign: "center" as const, marginTop: 8, fontSize: 14, color: "#9ca3af" },
    saveBtn: (color: string, disabled: boolean) => ({
      width: "100%", padding: "16px", borderRadius: 16, fontWeight: 700, fontSize: 16, border: "none", cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? "#374151" : color, color: disabled ? "#6b7280" : "#fff", opacity: disabled ? 0.7 : 1,
    }),
    msg: (ok: boolean) => ({
      padding: "10px 14px", borderRadius: 12, fontSize: 14, fontWeight: 600, textAlign: "center" as const,
      background: ok ? "#064e3b" : "#7f1d1d", color: ok ? "#34d399" : "#fca5a5",
    }),
    empty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 12, color: "#4b5563" },
  }

  const provsFiltrados = busqFiltro ? proveedores.filter(p => p.nombre.toLowerCase().includes(busqFiltro.toLowerCase())) : proveedores
  const catsFiltradas  = busqFiltro ? categorias.filter(c => c.toLowerCase().includes(busqFiltro.toLowerCase())) : categorias
  const sesionPct = sesionArts.length > 0 ? Math.round((sesionIdx / sesionArts.length) * 100) : 0
  const sesionLabel = filtroProveedor?.nombre ?? filtroCategoria ?? "Sesión"

  return (
    <div style={{ ...C.page, position: "relative" }}>

      {/* ── Barra de búsqueda ── */}
      {!modoSesion && (
        <div style={C.searchBar}>
          <input
            style={C.searchInput}
            type="text" inputMode="search"
            placeholder="Escanear EAN o buscar SKU / descripción..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            autoFocus={!articulo}
          />
          {(busqueda || articulo || hayFiltroActivo) && (
            <button style={C.clearBtn} onClick={limpiarTodo}>✕</button>
          )}
        </div>
      )}

      {/* ── Barra de filtros ── */}
      {!modoSesion && (
        <div style={C.filterBar}>
          <button style={C.filterChip(!!filtroProveedor)} onClick={() => { setPanelFiltro(panelFiltro === "prov" ? null : "prov"); setBusqFiltro("") }}>
            🏭 {filtroProveedor ? filtroProveedor.nombre : "Proveedor"}
            {filtroProveedor && <span style={C.chipX} onClick={e => { e.stopPropagation(); setFiltroProveedor(null) }}>×</span>}
          </button>
          <button style={C.filterChip(!!filtroCategoria)} onClick={() => { setPanelFiltro(panelFiltro === "cat" ? null : "cat"); setBusqFiltro("") }}>
            🗂 {filtroCategoria ?? "Categoría"}
            {filtroCategoria && <span style={C.chipX} onClick={e => { e.stopPropagation(); setFiltroCategoria(null) }}>×</span>}
          </button>
          {hayFiltroActivo && (
            <button style={C.startBtn as any} onClick={iniciarSesion} disabled={cargandoSesion}>
              {cargandoSesion ? "Cargando..." : "▶ Iniciar conteo"}
            </button>
          )}
          {hayFiltroActivo && !cargandoSesion && (
            <button style={{ ...C.filterChip(false) as any, border: "none", color: "#ef4444", fontSize: 12, marginLeft: 0 }} onClick={() => { setFiltroProveedor(null); setFiltroCategoria(null) }}>
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* ── Panel de filtro (overlay) ── */}
      {panelFiltro && (
        <div style={C.filterPanel}>
          <div style={C.filterHeader}>
            <span style={C.filterTitle}>{panelFiltro === "prov" ? "Filtrar por Proveedor" : "Filtrar por Categoría"}</span>
            <button style={{ ...C.clearBtn, width: 36, height: 36 }} onClick={() => setPanelFiltro(null)}>✕</button>
          </div>
          <input
            style={C.filterSearch} type="text" inputMode="search" autoFocus
            placeholder={panelFiltro === "prov" ? "Buscar proveedor..." : "Buscar categoría..."}
            value={busqFiltro} onChange={e => setBusqFiltro(e.target.value)}
          />
          <div style={C.filterList}>
            <div style={C.filterItem(panelFiltro === "prov" ? !filtroProveedor : !filtroCategoria)} onClick={() => { if (panelFiltro === "prov") setFiltroProveedor(null); else setFiltroCategoria(null); setPanelFiltro(null); setBusqFiltro("") }}>
              <span>— Todos —</span>
              {(panelFiltro === "prov" ? !filtroProveedor : !filtroCategoria) && <span>✓</span>}
            </div>
            {panelFiltro === "prov"
              ? provsFiltrados.map(p => (
                  <div key={p.id} style={C.filterItem(filtroProveedor?.id === p.id)} onClick={() => { setFiltroProveedor(p); setPanelFiltro(null); setBusqFiltro("") }}>
                    <span>{p.nombre}</span>{filtroProveedor?.id === p.id && <span>✓</span>}
                  </div>
                ))
              : catsFiltradas.map(cat => (
                  <div key={cat} style={C.filterItem(filtroCategoria === cat)} onClick={() => { setFiltroCategoria(cat); setPanelFiltro(null); setBusqFiltro("") }}>
                    <span>{cat}</span>{filtroCategoria === cat && <span>✓</span>}
                  </div>
                ))
            }
          </div>
        </div>
      )}

      {/* ── Resultados búsqueda individual ── */}
      {mostrarResultados && !panelFiltro && !articulo && (
        <>
          {buscando && <div style={{ padding: "16px", color: "#6b7280", textAlign: "center" }}>Buscando...</div>}
          {errorBusqueda && <div style={{ padding: "12px 16px", background: "#7f1d1d", color: "#fca5a5", fontSize: 13, margin: "8px 14px", borderRadius: 10 }}>Error: {errorBusqueda}</div>}
          {resultados.length > 0 && (
            <div style={C.results}>
              {resultados.map(art => (
                <button key={art.id} style={C.artBtn} onClick={() => seleccionar(art)}>
                  <div style={C.artName}>{art.descripcion}</div>
                  <div style={C.artSub}>
                    <span style={{ fontFamily: "monospace" }}>{art.sku}</span>
                    <span>Stock: <span style={C.artStock}>{art.stock_actual ?? 0}</span></span>
                    {art.orden_deposito != null && <span style={{ color: "#6366f1" }}>#{art.orden_deposito}</span>}
                    {(art as any).proveedor?.nombre && <span style={{ color: "#6b7280" }}>{(art as any).proveedor.nombre}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!buscando && resultados.length === 0 && (
            <div style={C.empty}><span>Sin resultados{busqueda ? ` para "${busqueda}"` : ""}{ hayFiltroActivo ? " con filtros activos" : ""}</span></div>
          )}
        </>
      )}

      {/* ── Estado vacío ── */}
      {!modoSesion && !articulo && !mostrarResultados && !panelFiltro && (
        <div style={C.empty}>
          <span style={{ fontSize: 48 }}>🔧</span>
          <span style={{ fontSize: 16 }}>Buscá un artículo para modificarlo</span>
          <span style={{ fontSize: 13 }}>o usá los filtros → "Iniciar conteo" para recorrer el depósito en orden</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          MODO SESIÓN
      ═══════════════════════════════════════════════════ */}
      {modoSesion && (
        <>
          {/* Header sesión */}
          <div style={C.sesionHeader}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={C.sesionLabel}>{sesionLabel}</span>
              <button style={{ background: "none", border: "none", color: "#6b7280", fontSize: 13, cursor: "pointer" }} onClick={salirSesion}>✕ Salir</button>
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: sesionDone ? "#34d399" : "#9ca3af" }}>
              {sesionDone
                ? `✓ Sesión completada — ${sesionArts.length} artículos`
                : `${sesionIdx + 1} / ${sesionArts.length} artículos`}
            </div>
            <div style={C.sesionProgress}>
              <div style={C.sesionBar(sesionDone ? 100 : sesionPct)} />
            </div>
          </div>

          {/* Pantalla de completado */}
          {sesionDone && (
            <div style={C.empty}>
              <span style={{ fontSize: 56 }}>✅</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#34d399" }}>¡Sesión completada!</span>
              <span style={{ fontSize: 14, color: "#6b7280" }}>{sesionArts.length} artículos revisados</span>
              <button style={{ ...C.saveBtn("#16a34a", false), width: "auto", padding: "14px 32px", marginTop: 16 }} onClick={salirSesion}>
                Nueva sesión
              </button>
            </div>
          )}

          {/* Artículo de sesión */}
          {!sesionDone && articulo && (
            <>
              {/* Info artículo */}
              <div style={C.artSelected}>
                <div style={C.artSelectedInfo}>
                  <div style={C.artSelectedName}>{articulo.descripcion}</div>
                  <div style={C.artSelectedSub}>
                    {articulo.sku}
                    {articulo.orden_deposito != null && <span style={{ color: "#6366f1", marginLeft: 8 }}>Pos #{articulo.orden_deposito}</span>}
                  </div>
                </div>
                <div style={C.stockBadge}>Stock: {articulo.stock_actual ?? 0}</div>
              </div>

              {/* Tabs */}
              <div style={C.tabs}>
                <div style={C.tab(seccion === "stock", "#f59e0b")} onClick={() => setSeccion("stock")}>Ajustar Stock</div>
                <div style={C.tab(seccion === "datos", "#60a5fa")} onClick={() => setSeccion("datos")}>Datos</div>
              </div>

              <div style={C.body}>
                {seccion === "stock" && (
                  <>
                    <div style={C.card}>
                      <span style={C.label}>Tipo</span>
                      <div style={C.typeGrid}>
                        {([["entrada", "#16a34a", "📥 Entrada"], ["salida", "#dc2626", "📤 Salida"], ["correccion", "#d97706", "✏️ Corrección"]] as const).map(([t, color, label]) => (
                          <button key={t} style={C.typeBtn(tipo === t, color)} onClick={() => { setTipo(t); setCantidad(t === "correccion" ? String(articulo.stock_actual ?? 0) : "") }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={C.card}>
                      <span style={C.label}>{tipo === "correccion" ? "Nuevo stock (valor final)" : tipo === "entrada" ? "Cantidad a ingresar" : "Cantidad a retirar"}</span>
                      <input style={C.bigInput} type="number" inputMode="decimal" value={cantidad} onChange={e => setCantidad(e.target.value)} autoFocus />
                      {stockResultante() !== null && (
                        <div style={C.resultante}>
                          Stock resultante: <strong style={{ color: (stockResultante() ?? 0) < 0 ? "#f87171" : "#34d399", fontSize: 20 }}>{stockResultante()}</strong>
                        </div>
                      )}
                    </div>
                    {msgStock && <div style={C.msg(msgStock.ok)}>{msgStock.txt}</div>}
                  </>
                )}

                {seccion === "datos" && (
                  <>
                    <div style={C.card}>
                      <span style={C.label}>EAN 13</span>
                      <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, background: "#374151", border: "1px solid #4b5563", borderRadius: 12, padding: "10px 12px", minHeight: 44 }}>
                        {ean13.map((e, i) => (
                          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#1f2937", border: "1px solid #4b5563", borderRadius: 20, padding: "4px 10px", color: "#e5e7eb", fontSize: 13, fontFamily: "monospace" }}>
                            {e}<button type="button" onClick={() => setEan13(p => p.filter((_,j)=>j!==i))} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                          </span>
                        ))}
                        <input type="text" inputMode="numeric" value={eanInput} onChange={e=>setEanInput(e.target.value)} placeholder={ean13.length===0?"EAN...":"Otro EAN..."} style={{ flex:1, minWidth:110, background:"transparent", border:"none", outline:"none", color:"#f9fafb", fontSize:15 }}
                          onKeyDown={e=>{ if((e.key==="Enter"||e.key===",")&&eanInput.trim()){e.preventDefault();const v=eanInput.trim();if(!ean13.includes(v))setEan13(p=>[...p,v]);setEanInput("")}}}
                          onBlur={()=>{if(eanInput.trim()){const v=eanInput.trim();if(!ean13.includes(v))setEan13(p=>[...p,v]);setEanInput("")}}}
                        />
                      </div>
                    </div>
                    <div style={{ ...C.card, ...C.row2 }}>
                      <div><span style={C.label}>Unid/bulto</span><input style={C.input} type="number" inputMode="numeric" placeholder="—" value={unidadesBulto} onChange={e=>setUnidadesBulto(e.target.value)}/></div>
                      <div><span style={C.label}>Unidad</span><input style={{...C.input,textTransform:"uppercase"}} type="text" placeholder="UN" value={unidadMedida} onChange={e=>setUnidadMedida(e.target.value.toUpperCase())}/></div>
                    </div>
                    {msgDatos && <div style={C.msg(msgDatos.ok)}>{msgDatos.txt}</div>}
                    <button style={C.saveBtn("#2563eb", guardandoDatos)} onClick={guardarDatos} disabled={guardandoDatos}>
                      {guardandoDatos ? "Guardando..." : "Guardar Datos"}
                    </button>
                  </>
                )}
              </div>

              {/* Barra de navegación de sesión (sticky bottom) */}
              <div style={C.sesionNav}>
                <button style={C.navBtn(sesionIdx === 0) as any} disabled={sesionIdx === 0} onClick={() => avanzarSesion(-1)}>← Anterior</button>
                <button style={C.skipBtn as any} onClick={() => avanzarSesion(1)}>Omitir →</button>
                <button
                  style={C.saveNextBtn(guardandoStock) as any}
                  disabled={guardandoStock}
                  onClick={() => aplicarStock(true)}
                >
                  {guardandoStock ? "Guardando..." : sesionIdx === sesionArts.length - 1 ? "✓ Guardar y Finalizar" : "✓ Guardar y Siguiente →"}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Artículo individual (modo búsqueda) ── */}
      {!modoSesion && articulo && !panelFiltro && (
        <>
          <div style={C.artSelected}>
            <div style={C.artSelectedInfo}>
              <div style={C.artSelectedName}>{articulo.descripcion}</div>
              <div style={C.artSelectedSub}>{articulo.sku}{articulo.ean13?.length ? ` · ${articulo.ean13.join(', ')}` : ""}</div>
            </div>
            <div style={C.stockBadge}>Stock: {articulo.stock_actual ?? 0}</div>
            <button style={C.changeBtn} onClick={() => { setArticulo(null); setBusqueda("") }}>Cambiar</button>
          </div>
          <div style={C.tabs}>
            <div style={C.tab(seccion === "stock", "#f59e0b")} onClick={() => setSeccion("stock")}>Ajustar Stock</div>
            <div style={C.tab(seccion === "datos", "#60a5fa")} onClick={() => setSeccion("datos")}>Datos del Artículo</div>
          </div>
          <div style={C.body}>
            {seccion === "stock" && (
              <>
                <div style={C.card}>
                  <span style={C.label}>Tipo de movimiento</span>
                  <div style={C.typeGrid}>
                    {([["entrada","#16a34a","📥 Entrada"],["salida","#dc2626","📤 Salida"],["correccion","#d97706","✏️ Corrección"]] as const).map(([t,color,label])=>(
                      <button key={t} style={C.typeBtn(tipo===t,color)} onClick={()=>{setTipo(t);setCantidad(t==="correccion"?String(articulo.stock_actual??0):"")}}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={C.card}>
                  <span style={C.label}>{tipo==="correccion"?"Nuevo stock (valor final)":tipo==="entrada"?"Cantidad a ingresar":"Cantidad a retirar"}</span>
                  <input style={C.bigInput} type="number" inputMode="decimal" value={cantidad} onChange={e=>setCantidad(e.target.value)} autoFocus/>
                  {stockResultante()!==null&&(
                    <div style={C.resultante}>Stock resultante: <strong style={{color:(stockResultante()??0)<0?"#f87171":"#34d399",fontSize:20}}>{stockResultante()}</strong></div>
                  )}
                </div>
                <div style={C.card}>
                  <span style={C.label}>Motivo (opcional)</span>
                  <input style={C.input} type="text" placeholder="Ej: conteo físico, rotura..." value={motivo} onChange={e=>setMotivo(e.target.value)}/>
                </div>
                {msgStock&&<div style={C.msg(msgStock.ok)}>{msgStock.txt}</div>}
                <button style={C.saveBtn(tipo==="entrada"?"#16a34a":tipo==="salida"?"#dc2626":"#d97706",guardandoStock)} onClick={()=>aplicarStock(false)} disabled={guardandoStock}>
                  {guardandoStock?"Guardando...":tipo==="entrada"?"Registrar Entrada":tipo==="salida"?"Registrar Salida":"Aplicar Corrección"}
                </button>
              </>
            )}
            {seccion === "datos" && (
              <>
                <div style={C.card}>
                  <span style={C.label}>EAN 13 <span style={{color:"#6b7280",fontWeight:400,textTransform:"none" as const}}>— puede tener varios</span></span>
                  <div style={{display:"flex",flexWrap:"wrap" as const,gap:8,background:"#374151",border:"1px solid #4b5563",borderRadius:12,padding:"10px 12px",minHeight:48}}>
                    {ean13.map((e,i)=>(
                      <span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#1f2937",border:"1px solid #4b5563",borderRadius:20,padding:"4px 10px",color:"#e5e7eb",fontSize:14,fontFamily:"monospace"}}>
                        {e}<button type="button" onClick={()=>setEan13(p=>p.filter((_,j)=>j!==i))} style={{color:"#9ca3af",background:"none",border:"none",cursor:"pointer",fontSize:16,lineHeight:1,padding:0}}>×</button>
                      </span>
                    ))}
                    <input type="text" inputMode="numeric" value={eanInput} onChange={e=>setEanInput(e.target.value)} placeholder={ean13.length===0?"Escribí un EAN y presioná Enter...":"Agregar otro..."} style={{flex:1,minWidth:140,background:"transparent",border:"none",outline:"none",color:"#f9fafb",fontSize:15}}
                      onKeyDown={e=>{if((e.key==="Enter"||e.key===",")&&eanInput.trim()){e.preventDefault();const v=eanInput.trim();if(!ean13.includes(v))setEan13(p=>[...p,v]);setEanInput("")}}}
                      onBlur={()=>{if(eanInput.trim()){const v=eanInput.trim();if(!ean13.includes(v))setEan13(p=>[...p,v]);setEanInput("")}}}
                    />
                  </div>
                  <div style={{color:"#6b7280",fontSize:12,marginTop:6}}>Enter o coma para agregar · × para quitar</div>
                </div>
                <div style={{...C.card,...C.row2}}>
                  <div><span style={C.label}>Unid. por bulto</span><input style={C.input} type="number" inputMode="numeric" placeholder="—" value={unidadesBulto} onChange={e=>setUnidadesBulto(e.target.value)}/></div>
                  <div><span style={C.label}>Unidad de medida</span><input style={{...C.input,textTransform:"uppercase"}} type="text" placeholder="UN" value={unidadMedida} onChange={e=>setUnidadMedida(e.target.value.toUpperCase())}/></div>
                </div>
                <div style={{...C.card,...C.row2}}>
                  <div><span style={C.label}>Tipo de fracción</span><input style={C.input} type="text" placeholder="pack, blister..." value={tipoFraccion} onChange={e=>setTipoFraccion(e.target.value)}/></div>
                  <div><span style={C.label}>Unidades / fracción</span><input style={C.input} type="number" inputMode="numeric" placeholder="—" value={cantidadFraccion} onChange={e=>setCantidadFraccion(e.target.value)}/></div>
                </div>
                {msgDatos&&!msgDatos.ok&&<div style={C.msg(false)}>{msgDatos.txt}</div>}
                <button style={C.saveBtn("#2563eb",guardandoDatos)} onClick={guardarDatos} disabled={guardandoDatos}>
                  {guardandoDatos?"Guardando...":"Guardar Datos"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
