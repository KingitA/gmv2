"use client"

import { useState, useRef, useEffect } from "react"
import {
  actualizarDatosArticulo, ajustarStock, getArticuloExtra,
  buscarArticulosDeposito, getProveedoresDeposito, getCategoriasDeposito,
  getArticulosListado,
} from "@/lib/actions/deposito"

interface Articulo {
  id: string
  sku: string
  descripcion: string
  ean13: string[] | null
  codigo_bulto?: string | null
  stock_actual: number | null
  unidades_por_bulto: number | null
  unidad_de_medida: string | null
  tipo_fraccion: string | null
  cantidad_fraccion: number | null
  orden_deposito?: number | null
  marca?: string | null
}

type ListaFiltro = { proveedorId?: string; categoria?: string; soloConOrden?: boolean }
type TipoAjuste  = "entrada" | "salida" | "correccion"
type Seccion     = "datos" | "stock"
type FiltroPanel = "prov" | "cat" | "lista" | null

export default function ModificacionArticulosPage() {
  // ── Búsqueda libre ────────────────────────────────────
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [articulo, setArticulo] = useState<Articulo | null>(null)
  const [seccion, setSeccion] = useState<Seccion>("stock")

  // ── Filtros ───────────────────────────────────────────
  const [proveedores, setProveedores] = useState<{id:string;nombre:string}[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [filtroProveedor, setFiltroProveedor] = useState<{id:string;nombre:string}|null>(null)
  const [filtroCategoria, setFiltroCategoria] = useState<string|null>(null)
  const [panelFiltro, setPanelFiltro] = useState<FiltroPanel>(null)
  const [busqFiltro, setBusqFiltro] = useState("")

  // ── Lista navegable (prov / cat / orden deposito) ─────
  const [listaOrden, setListaOrden] = useState<Articulo[]>([])
  const [listaTotal, setListaTotal] = useState(0)
  const [listaPagina, setListaPagina] = useState(0)
  const [listaCargando, setListaCargando] = useState(false)
  const [listaLabel, setListaLabel] = useState("")
  const [listaFiltro, setListaFiltro] = useState<ListaFiltro>({})
  const [indiceActual, setIndiceActual] = useState<number | null>(null)

  // ── Datos artículo ────────────────────────────────────
  const [ean13, setEan13] = useState<string[]>([])
  const [eanInput, setEanInput] = useState("")
  const [codigoBulto, setCodigoBulto] = useState("")
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

  useEffect(() => {
    getProveedoresDeposito().then(setProveedores)
    getCategoriasDeposito().then(setCategorias)
  }, [])

  // Búsqueda libre reactiva
  useEffect(() => {
    const hayFiltro = !!(filtroProveedor || filtroCategoria)
    if (!busqueda && !hayFiltro) { setResultados([]); return }
    if (busqueda.length > 0 && busqueda.length < 2 && !hayFiltro) return
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setBuscando(true); setErrorBusqueda(null)
      try {
        const res = await buscarArticulosDeposito(busqueda, {
          proveedorId: filtroProveedor?.id,
          categoria: filtroCategoria ?? undefined,
        })
        if (res.error) setErrorBusqueda(res.error)
        setResultados(res.data as Articulo[])
      } catch (e: any) {
        setResultados([]); setErrorBusqueda(e?.message || "Error al buscar")
      } finally { setBuscando(false) }
    }, 250)
    return () => clearTimeout(debounce.current)
  }, [busqueda, filtroProveedor, filtroCategoria])

  // ── Helpers lista ─────────────────────────────────────
  const cargarLista = async (filtro: ListaFiltro, label: string, reset = true) => {
    const page = reset ? 0 : listaPagina + 1
    setListaCargando(true)
    if (reset) { setListaOrden([]); setListaTotal(0); setListaPagina(0); setIndiceActual(null) }
    const res = await getArticulosListado(filtro, page)
    if (reset) {
      setListaOrden(res.data)
    } else {
      setListaOrden(prev => [...prev, ...res.data])
      setListaPagina(page)
    }
    setListaTotal(res.total)
    setListaFiltro(filtro)
    setListaLabel(label)
    setListaCargando(false)
  }

  const abrirProv = () => { setPanelFiltro(panelFiltro === "prov" ? null : "prov"); setBusqFiltro("") }
  const abrirCat  = () => { setPanelFiltro(panelFiltro === "cat"  ? null : "cat");  setBusqFiltro("") }

  const seleccionarProveedor = async (p: {id:string;nombre:string}) => {
    setFiltroProveedor(p)
    setPanelFiltro("lista")
    await cargarLista({ proveedorId: p.id }, `Proveedor: ${p.nombre}`)
  }

  const seleccionarCategoria = async (cat: string) => {
    setFiltroCategoria(cat)
    setPanelFiltro("lista")
    await cargarLista({ categoria: cat }, `Categoría: ${cat}`)
  }

  const abrirOrden = async () => {
    if (panelFiltro === "lista" && listaFiltro.soloConOrden) { setPanelFiltro(null); return }
    setPanelFiltro("lista")
    if (!listaFiltro.soloConOrden || listaOrden.length === 0) {
      await cargarLista({ soloConOrden: true }, "Orden de Depósito")
    }
  }

  const cargarMas = () => cargarLista(listaFiltro, listaLabel, false)

  const limpiarLista = () => {
    setListaOrden([]); setListaTotal(0); setListaPagina(0)
    setListaFiltro({}); setListaLabel(""); setIndiceActual(null)
  }

  // ── Artículo ──────────────────────────────────────────
  const seleccionar = async (art: Articulo) => {
    setArticulo(art)
    setEan13(Array.isArray(art.ean13) ? art.ean13 : (art.ean13 ? [art.ean13] : []))
    setEanInput("")
    setCodigoBulto(art.codigo_bulto || "")
    setUnidadesBulto(art.unidades_por_bulto ? String(art.unidades_por_bulto) : "")
    setUnidadMedida(art.unidad_de_medida || "")
    setTipoFraccion(""); setCantidadFraccion("")
    setCantidad(tipo === "correccion" ? String(art.stock_actual ?? 0) : "")
    setMotivo(""); setMsgDatos(null); setMsgStock(null)
    setBusqueda(""); setPanelFiltro(null)
    try {
      const extra = await getArticuloExtra(art.id)
      if (extra) {
        setTipoFraccion(extra.tipo_fraccion || "")
        setCantidadFraccion(extra.cantidad_fraccion ? String(extra.cantidad_fraccion) : "")
      }
    } catch { /* columnas opcionales */ }
  }

  const seleccionarDeLista = (art: Articulo, index: number) => {
    setIndiceActual(index)
    seleccionar(art)
  }

  const irAnterior = () => {
    if (indiceActual === null || indiceActual <= 0) return
    seleccionarDeLista(listaOrden[indiceActual - 1], indiceActual - 1)
  }

  const irSiguiente = () => {
    if (indiceActual === null || indiceActual >= listaOrden.length - 1) return
    seleccionarDeLista(listaOrden[indiceActual + 1], indiceActual + 1)
  }

  const limpiarTodo = () => {
    setBusqueda(""); setResultados([]); setArticulo(null)
    setFiltroProveedor(null); setFiltroCategoria(null); setPanelFiltro(null)
    limpiarLista()
  }

  const guardarDatos = async () => {
    if (!articulo) return
    setGuardandoDatos(true); setMsgDatos(null)
    try {
      await actualizarDatosArticulo(articulo.id, {
        ean13: ean13.length > 0 ? ean13 : null,
        codigo_bulto: codigoBulto || null,
        unidades_por_bulto: unidadesBulto ? parseInt(unidadesBulto) : undefined,
        unidad_de_medida: unidadMedida || undefined,
        tipo_fraccion: tipoFraccion || null,
        cantidad_fraccion: cantidadFraccion ? parseInt(cantidadFraccion) : null,
      })
      setMsgDatos({ ok: true, txt: "✓ Datos guardados" })
      if (indiceActual === null) {
        setTimeout(() => { setArticulo(null); setBusqueda("") }, 600)
      }
    } catch (e: any) { setMsgDatos({ ok: false, txt: e.message || "Error al guardar" }) }
    setGuardandoDatos(false)
  }

  const aplicarStock = async () => {
    if (!articulo || !cantidad) { setMsgStock({ ok: false, txt: "Ingresá una cantidad" }); return }
    setGuardandoStock(true); setMsgStock(null)
    try {
      const res = await ajustarStock(articulo.id, parseFloat(cantidad), tipo, motivo)
      setArticulo(a => a ? { ...a, stock_actual: res.nuevoStock } : a)
      setCantidad(tipo === "correccion" ? String(res.nuevoStock) : "")
      setMotivo("")
      setMsgStock({ ok: true, txt: `✓ Stock: ${res.nuevoStock} ${articulo.unidad_de_medida || "UN"}` })
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

  const enNavegacion     = indiceActual !== null && listaOrden.length > 0
  const mostrarResultados = busqueda.length >= 2 || !!(filtroProveedor || filtroCategoria)
  const hayFiltroActivo   = !!(filtroProveedor || filtroCategoria)
  const hayLista          = listaOrden.length > 0

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

    filterPanel: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, background: "#111827", zIndex: 50, display: "flex", flexDirection: "column" as const },
    filterSearch: { background: "#374151", border: "1px solid #4b5563", borderRadius: 12, padding: "12px 16px", color: "#f9fafb", fontSize: 16, outline: "none", margin: "12px 14px 4px" },
    filterHeader: { padding: "14px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    filterTitle: { color: "#f9fafb", fontWeight: 700, fontSize: 17 },
    filterList: { flex: 1, overflowY: "auto" as const, padding: "4px 10px 20px" },
    filterItem: (active: boolean) => ({
      padding: "12px 16px", borderRadius: 12, margin: "4px 0", cursor: "pointer",
      background: active ? "#312e81" : "transparent",
      color: active ? "#a5b4fc" : "#e5e7eb",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }),

    // Item del listado navegable
    listaItem: (active: boolean) => ({
      padding: "12px 16px", borderRadius: 12, margin: "4px 0", cursor: "pointer",
      background: active ? "#312e81" : "transparent",
      display: "flex", flexDirection: "column" as const, gap: 4,
    }),
    listaItemTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
    listaItemName: (active: boolean) => ({ fontWeight: 700, fontSize: 15, lineHeight: 1.3, flex: 1, color: active ? "#a5b4fc" : "#e5e7eb" }),
    listaItemOrden: { color: "#6366f1", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" as const },
    listaItemMeta: { display: "flex", gap: 10, flexWrap: "wrap" as const, fontSize: 12, color: "#6b7280" },
    listaItemTag: { fontFamily: "monospace" as const, color: "#9ca3af" },
    listaItemMuted: { opacity: 0.45 },

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

    navBar: { background: "#1a2035", borderBottom: "1px solid #374151", padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 },
    navBtn: (disabled: boolean) => ({
      flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 700, fontSize: 14, border: "none", cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? "#1f2937" : "#312e81", color: disabled ? "#4b5563" : "#a5b4fc",
    }),
    navCounter: { color: "#6b7280", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const, textAlign: "center" as const, minWidth: 70 },

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
    loadMoreBtn: { width: "100%", marginTop: 8, padding: "14px", borderRadius: 12, background: "#1f2937", border: "1px solid #374151", color: "#a5b4fc", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  }

  const provsFiltrados = busqFiltro ? proveedores.filter(p => p.nombre.toLowerCase().includes(busqFiltro.toLowerCase())) : proveedores
  const catsFiltradas  = busqFiltro ? categorias.filter(c => c.toLowerCase().includes(busqFiltro.toLowerCase())) : categorias

  // ── Render del item del listado ───────────────────────
  const renderListaItem = (art: Articulo, i: number) => {
    const active = indiceActual === i
    return (
      <div key={art.id} style={C.listaItem(active)} onClick={() => seleccionarDeLista(art, i)}>
        <div style={C.listaItemTop}>
          <span style={C.listaItemName(active)}>{art.descripcion}</span>
          {art.orden_deposito != null && <span style={C.listaItemOrden}>#{art.orden_deposito}</span>}
        </div>
        <div style={C.listaItemMeta}>
          <span style={C.listaItemTag}>{art.sku}</span>
          {art.ean13?.length
            ? <span style={C.listaItemTag}>{art.ean13[0]}</span>
            : <span style={C.listaItemMuted}>Sin EAN</span>}
          {art.codigo_bulto
            ? <span style={C.listaItemTag}>DUN: {art.codigo_bulto}</span>
            : <span style={C.listaItemMuted}>Sin código de bulto</span>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...C.page, position: "relative" }}>

      {/* ── Barra de búsqueda ── */}
      {!articulo && (
        <div style={C.searchBar}>
          <input
            style={C.searchInput} type="text" inputMode="search"
            placeholder="Escanear EAN o buscar SKU / descripción..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)} autoFocus
          />
          {(busqueda || hayFiltroActivo || hayLista) && (
            <button style={C.clearBtn} onClick={limpiarTodo}>✕</button>
          )}
        </div>
      )}

      {/* ── Barra de filtros ── */}
      {!articulo && (
        <div style={C.filterBar}>
          <button style={C.filterChip(!!filtroProveedor)} onClick={abrirProv}>
            🏭 {filtroProveedor ? filtroProveedor.nombre : "Proveedor"}
            {filtroProveedor && (
              <span style={C.chipX} onClick={e => { e.stopPropagation(); setFiltroProveedor(null); limpiarLista() }}>×</span>
            )}
          </button>
          <button style={C.filterChip(!!filtroCategoria)} onClick={abrirCat}>
            🗂 {filtroCategoria ?? "Categoría"}
            {filtroCategoria && (
              <span style={C.chipX} onClick={e => { e.stopPropagation(); setFiltroCategoria(null); limpiarLista() }}>×</span>
            )}
          </button>
          <button style={C.filterChip(listaFiltro.soloConOrden === true && hayLista)} onClick={abrirOrden}>
            📦 Orden Depósito
            {listaFiltro.soloConOrden && hayLista && (
              <span style={C.chipX} onClick={e => { e.stopPropagation(); limpiarLista() }}>×</span>
            )}
          </button>
          {hayFiltroActivo && (
            <button style={{ ...C.filterChip(false) as any, border: "none", color: "#ef4444", fontSize: 12, marginLeft: "auto" }}
              onClick={() => { setFiltroProveedor(null); setFiltroCategoria(null); limpiarLista() }}>
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* ── Paneles overlay ── */}
      {panelFiltro && (
        <div style={C.filterPanel}>
          <div style={C.filterHeader}>
            <span style={C.filterTitle}>
              {panelFiltro === "prov" ? "Filtrar por Proveedor"
               : panelFiltro === "cat" ? "Filtrar por Categoría"
               : listaLabel}
            </span>
            <button style={{ ...C.clearBtn, width: 36, height: 36 }} onClick={() => setPanelFiltro(null)}>✕</button>
          </div>

          {/* Picker proveedor */}
          {panelFiltro === "prov" && (
            <>
              <input style={C.filterSearch} type="text" inputMode="search" autoFocus
                placeholder="Buscar proveedor..." value={busqFiltro} onChange={e => setBusqFiltro(e.target.value)} />
              <div style={C.filterList}>
                {provsFiltrados.map(p => (
                  <div key={p.id} style={C.filterItem(filtroProveedor?.id === p.id)} onClick={() => seleccionarProveedor(p)}>
                    <span>{p.nombre}</span>{filtroProveedor?.id === p.id && <span>✓</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Picker categoría */}
          {panelFiltro === "cat" && (
            <>
              <input style={C.filterSearch} type="text" inputMode="search" autoFocus
                placeholder="Buscar categoría..." value={busqFiltro} onChange={e => setBusqFiltro(e.target.value)} />
              <div style={C.filterList}>
                {catsFiltradas.map(cat => (
                  <div key={cat} style={C.filterItem(filtroCategoria === cat)} onClick={() => seleccionarCategoria(cat)}>
                    <span>{cat}</span>{filtroCategoria === cat && <span>✓</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Listado navegable */}
          {panelFiltro === "lista" && (
            <>
              {listaTotal > 0 && (
                <div style={{ padding: "6px 14px 2px", color: "#6b7280", fontSize: 12 }}>
                  {listaOrden.length} de {listaTotal} artículos
                </div>
              )}
              {listaCargando && listaOrden.length === 0 && (
                <div style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Cargando...</div>
              )}
              <div style={C.filterList}>
                {listaOrden.map((art, i) => renderListaItem(art, i))}
                {listaOrden.length < listaTotal && !listaCargando && (
                  <button style={C.loadMoreBtn} onClick={cargarMas}>
                    Cargar más ({listaOrden.length} / {listaTotal})
                  </button>
                )}
                {listaCargando && listaOrden.length > 0 && (
                  <div style={{ padding: "14px", textAlign: "center", color: "#6b7280", fontSize: 13 }}>Cargando...</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Resultados búsqueda libre ── */}
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
                  </div>
                </button>
              ))}
            </div>
          )}
          {!buscando && resultados.length === 0 && !errorBusqueda && (
            <div style={C.empty}><span>Sin resultados{busqueda ? ` para "${busqueda}"` : ""}{ hayFiltroActivo ? " con filtros activos" : ""}</span></div>
          )}
        </>
      )}

      {/* ── Estado vacío ── */}
      {!articulo && !mostrarResultados && !panelFiltro && (
        <div style={C.empty}>
          <span style={{ fontSize: 48 }}>🔧</span>
          <span style={{ fontSize: 16 }}>Buscá un artículo para modificarlo</span>
          <span style={{ fontSize: 13, textAlign: "center" as const }}>o filtrá por proveedor / categoría / orden de depósito</span>
        </div>
      )}

      {/* ── Artículo seleccionado ── */}
      {articulo && !panelFiltro && (
        <>
          <div style={C.artSelected}>
            <div style={C.artSelectedInfo}>
              <div style={C.artSelectedName}>{articulo.descripcion}</div>
              <div style={C.artSelectedSub}>{articulo.sku}{articulo.ean13?.length ? ` · ${articulo.ean13.join(', ')}` : ""}</div>
            </div>
            <div style={C.stockBadge}>Stock: {articulo.stock_actual ?? 0}</div>
            <button style={C.changeBtn} onClick={() => { setArticulo(null); setBusqueda(""); if (enNavegacion) setPanelFiltro("lista") }}>
              {enNavegacion ? "Volver" : "Cambiar"}
            </button>
          </div>

          {enNavegacion && (
            <div style={C.navBar}>
              <button style={C.navBtn(indiceActual! <= 0)} onClick={irAnterior} disabled={indiceActual! <= 0}>← Anterior</button>
              <span style={C.navCounter}>{indiceActual! + 1} / {listaOrden.length}{listaOrden.length < listaTotal ? "+" : ""}</span>
              <button style={C.navBtn(indiceActual! >= listaOrden.length - 1)} onClick={irSiguiente} disabled={indiceActual! >= listaOrden.length - 1}>Siguiente →</button>
            </div>
          )}

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
                <button style={C.saveBtn(tipo==="entrada"?"#16a34a":tipo==="salida"?"#dc2626":"#d97706",guardandoStock)} onClick={aplicarStock} disabled={guardandoStock}>
                  {guardandoStock?"Guardando...":tipo==="entrada"?"Registrar Entrada":tipo==="salida"?"Registrar Salida":"Aplicar Corrección"}
                </button>
              </>
            )}
            {seccion === "datos" && (
              <>
                <div style={C.card}>
                  <span style={C.label}>Código de Bulto</span>
                  <input
                    style={C.input} type="text" inputMode="numeric"
                    placeholder="Código de barras del bulto/caja..."
                    value={codigoBulto} onChange={e => setCodigoBulto(e.target.value)}
                    onBlur={e => { const v = e.target.value.trim(); if (/^\d+$/.test(v) && v.length < 13) setCodigoBulto(v.padStart(13, "0")) }}
                  />
                </div>
                <div style={C.card}>
                  <span style={C.label}>EAN 13 <span style={{color:"#6b7280",fontWeight:400,textTransform:"none" as const}}>— puede tener varios</span></span>
                  <div style={{display:"flex",flexWrap:"wrap" as const,gap:8,background:"#374151",border:"1px solid #4b5563",borderRadius:12,padding:"10px 12px",minHeight:48}}>
                    {ean13.map((e,i)=>(
                      <span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#1f2937",border:"1px solid #4b5563",borderRadius:20,padding:"4px 10px",color:"#e5e7eb",fontSize:14,fontFamily:"monospace"}}>
                        {e}<button type="button" onClick={()=>setEan13(p=>p.filter((_,j)=>j!==i))} style={{color:"#9ca3af",background:"none",border:"none",cursor:"pointer",fontSize:16,lineHeight:1,padding:0}}>×</button>
                      </span>
                    ))}
                    <input type="text" inputMode="numeric" value={eanInput} onChange={e=>setEanInput(e.target.value)}
                      placeholder={ean13.length===0?"Escribí un EAN y presioná Enter...":"Agregar otro..."}
                      style={{flex:1,minWidth:140,background:"transparent",border:"none",outline:"none",color:"#f9fafb",fontSize:15}}
                      onKeyDown={e=>{if((e.key==="Enter"||e.key===",")&&eanInput.trim()){e.preventDefault();const raw=eanInput.trim();const v=/^\d+$/.test(raw)&&raw.length<13?raw.padStart(13,"0"):raw;if(!ean13.includes(v))setEan13(p=>[...p,v]);setEanInput("")}}}
                      onBlur={()=>{if(eanInput.trim()){const raw=eanInput.trim();const v=/^\d+$/.test(raw)&&raw.length<13?raw.padStart(13,"0"):raw;if(!ean13.includes(v))setEan13(p=>[...p,v]);setEanInput("")}}}
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
                {msgDatos&&<div style={C.msg(msgDatos.ok)}>{msgDatos.txt}</div>}
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
