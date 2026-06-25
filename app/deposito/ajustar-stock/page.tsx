"use client"

import { useState, useRef, useEffect } from "react"
import { toast } from "sonner"
import {
  actualizarDatosArticulo, ajustarStock, getArticuloExtra,
  buscarArticulosDeposito, getProveedoresDeposito, getCategoriasDeposito,
  getArticulosListado, getArticuloAdyacente, getArticuloPorId,
} from "@/lib/actions/deposito"
import { localMatch } from "@/lib/search/local-match"
import { articuloMarcaSuffix, articuloInfoLine } from "@/components/search/ArticuloResultRow"
import { esQrOUrl } from "@/lib/utils/scan-guard"
import { scanError } from "@/lib/utils/scan-feedback"

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

const POS_KEY = "ajuste_stock_pos"

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

  // ── Recorrido (para Siguiente/Anterior por cursor) ────
  const [recorrido, setRecorrido] = useState<ListaFiltro | null>(null)

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
  const originalRef = useRef<any>(null)            // snapshot de datos para detectar cambios
  const articuloRef = useRef<Articulo | null>(null)
  const recorridoRef = useRef<ListaFiltro | null>(null)
  const navegando = useRef(false)
  const listaScrollRef = useRef<HTMLDivElement>(null)
  const activeItemRef = useRef<HTMLDivElement>(null)
  articuloRef.current = articulo
  recorridoRef.current = recorrido

  useEffect(() => {
    getProveedoresDeposito().then(setProveedores)
    getCategoriasDeposito().then(setCategorias)
  }, [])

  // ── Restaurar posición tras recarga / reapertura de la app ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (!raw) return
      const pos = JSON.parse(raw) as { artId?: string; filtros?: ListaFiltro | null; label?: string }
      if (!pos?.artId) return
      getArticuloPorId(pos.artId).then(res => {
        if (res.data) {
          if (pos.filtros) { setRecorrido(pos.filtros); setListaFiltro(pos.filtros); setListaLabel(pos.label || "") }
          abrirArticulo(res.data, { recorrido: pos.filtros ?? null, push: true })
        } else {
          localStorage.removeItem(POS_KEY)
        }
      })
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── "Atrás" (hardware / navegador / botón del layout) cierra el artículo y vuelve a la lista ──
  useEffect(() => {
    const onPop = () => {
      if (articuloRef.current) {
        setArticulo(null)
        if (recorridoRef.current) setPanelFiltro("lista")
      }
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  // ── Volver a la lista: scrollear al artículo activo (no reiniciar arriba) ──
  useEffect(() => {
    if (panelFiltro === "lista" && !articulo && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: "center" })
    }
  }, [panelFiltro, articulo, indiceActual])

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
    if (panelFiltro === "lista" && listaLabel === "Orden de Depósito") { setPanelFiltro(null); return }
    setPanelFiltro("lista")
    if (listaLabel !== "Orden de Depósito" || listaOrden.length === 0) {
      await cargarLista({}, "Orden de Depósito")
    }
  }

  const cargarMas = () => cargarLista(listaFiltro, listaLabel, false)

  const limpiarLista = () => {
    setListaOrden([]); setListaTotal(0); setListaPagina(0)
    setListaFiltro({}); setListaLabel(""); setIndiceActual(null); setRecorrido(null)
  }

  // ── Snapshot de datos para autosave ───────────────────
  const snapActual = () => ({
    ean: [...ean13].sort().join("|"),
    cb: codigoBulto.trim(),
    ub: unidadesBulto.trim(),
    um: unidadMedida.trim(),
    tf: tipoFraccion.trim(),
    cf: cantidadFraccion.trim(),
  })
  const hayCambiosDatos = () => {
    const b = originalRef.current
    if (!b) return false
    const a = snapActual()
    return a.ean !== b.ean || a.cb !== b.cb || a.ub !== b.ub || a.um !== b.um || a.tf !== b.tf || a.cf !== b.cf
  }

  // ── Cargar un artículo en el editor ───────────────────
  const seleccionar = async (art: Articulo) => {
    setArticulo(art)
    const eanArr = Array.isArray(art.ean13) ? art.ean13 : (art.ean13 ? [art.ean13] : [])
    setEan13(eanArr)
    setEanInput("")
    setCodigoBulto(art.codigo_bulto || "")
    setUnidadesBulto(art.unidades_por_bulto ? String(art.unidades_por_bulto) : "")
    setUnidadMedida(art.unidad_de_medida || "")
    setTipoFraccion(""); setCantidadFraccion("")
    setCantidad(tipo === "correccion" ? String(art.stock_actual ?? 0) : "")
    setMotivo(""); setMsgDatos(null); setMsgStock(null)
    setBusqueda(""); setPanelFiltro(null)
    // snapshot base (se completa con los campos extra al resolver)
    originalRef.current = {
      ean: [...eanArr].sort().join("|"),
      cb: (art.codigo_bulto || "").trim(),
      ub: (art.unidades_por_bulto ? String(art.unidades_por_bulto) : "").trim(),
      um: (art.unidad_de_medida || "").trim(),
      tf: "", cf: "",
    }
    try {
      const extra = await getArticuloExtra(art.id)
      if (extra) {
        const tf = extra.tipo_fraccion || ""
        const cf = extra.cantidad_fraccion ? String(extra.cantidad_fraccion) : ""
        setTipoFraccion(tf); setCantidadFraccion(cf)
        if (originalRef.current) { originalRef.current.tf = tf.trim(); originalRef.current.cf = cf.trim() }
      }
    } catch { /* columnas opcionales */ }
  }

  // Abre el artículo gestionando historial (para que "atrás" lo cierre) y persistencia.
  const abrirArticulo = async (
    art: Articulo,
    opts: { recorrido?: ListaFiltro | null; index?: number | null; push?: boolean } = {}
  ) => {
    if (opts.recorrido !== undefined) setRecorrido(opts.recorrido)
    if (opts.index !== undefined) setIndiceActual(opts.index)
    if (opts.push !== false) {
      try { window.history.pushState({ ajusteArt: art.id }, "") } catch { /* ignore */ }
    }
    const filtros = opts.recorrido !== undefined ? opts.recorrido : recorridoRef.current
    try { localStorage.setItem(POS_KEY, JSON.stringify({ artId: art.id, filtros, label: listaLabel })) } catch { /* ignore */ }
    await seleccionar(art)
  }

  const seleccionarDeLista = (art: Articulo, index: number) => {
    abrirArticulo(art, { recorrido: listaFiltro, index, push: true })
  }

  // ── Guardado ──────────────────────────────────────────
  const guardarDatosCore = async () => {
    if (!articulo) return
    setGuardandoDatos(true)
    try {
      await actualizarDatosArticulo(articulo.id, {
        ean13: ean13.length > 0 ? ean13 : null,
        codigo_bulto: codigoBulto || null,
        unidades_por_bulto: unidadesBulto ? parseInt(unidadesBulto) : undefined,
        unidad_de_medida: unidadMedida || undefined,
        tipo_fraccion: tipoFraccion || null,
        cantidad_fraccion: cantidadFraccion ? parseInt(cantidadFraccion) : null,
      })
      originalRef.current = snapActual()
      setMsgDatos({ ok: true, txt: "✓ Datos guardados" })
    } catch (e: any) {
      setMsgDatos({ ok: false, txt: e.message || "Error al guardar" })
      throw e
    } finally {
      setGuardandoDatos(false)
    }
  }

  const guardarDatos = async () => { try { await guardarDatosCore() } catch { /* mensaje ya seteado */ } }

  // Autosave: guarda los cambios de datos pendientes antes de movernos de artículo.
  const guardarSiCorresponde = async () => {
    if (!articulo || guardandoDatos || !hayCambiosDatos()) return
    try { await guardarDatosCore() } catch { /* si falla, igual seguimos para no trabar */ }
  }

  // ── Navegación por cursor (orden de depósito) ─────────
  const irAdyacente = async (dir: "next" | "prev") => {
    if (!articulo || navegando.current) return
    navegando.current = true
    try {
      await guardarSiCorresponde()
      const res = await getArticuloAdyacente(
        { orden_deposito: articulo.orden_deposito ?? null, descripcion: articulo.descripcion, id: articulo.id },
        dir, recorrido || {}
      )
      if (res.data) {
        const idx = listaOrden.findIndex(a => a.id === res.data.id)
        await abrirArticulo(res.data, { index: idx >= 0 ? idx : null, push: false })
      } else {
        toast.info(dir === "next" ? "Es el último artículo del recorrido" : "Es el primero del recorrido")
      }
    } finally {
      navegando.current = false
    }
  }

  const volver = async () => { await guardarSiCorresponde(); try { window.history.back() } catch { setArticulo(null); if (recorrido) setPanelFiltro("lista") } }

  const limpiarTodo = () => {
    setBusqueda(""); setResultados([]); setArticulo(null)
    setFiltroProveedor(null); setFiltroCategoria(null); setPanelFiltro(null)
    limpiarLista()
    try { localStorage.removeItem(POS_KEY) } catch { /* ignore */ }
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

  // ── Helpers de EAN / código de bulto (con guarda de QR/URL) ──
  const agregarEan = (raw0: string): boolean => {
    const raw = raw0.trim()
    if (!raw) return false
    if (esQrOUrl(raw)) { scanError(); toast.error("QR ignorado — escaneá el código de barras"); return false }
    const v = /^\d+$/.test(raw) && raw.length < 13 ? raw.padStart(13, "0") : raw
    if (!ean13.includes(v)) setEan13(p => [...p, v])
    return true
  }

  const enNavegacion      = recorrido !== null && !!articulo
  const mostrarResultados = busqueda.length >= 2 || !!(filtroProveedor || filtroCategoria)
  const hayFiltroActivo   = !!(filtroProveedor || filtroCategoria)
  const hayLista          = listaOrden.length > 0

  // ── Estilos (tema claro, coherente con el resto de depósito) ──
  const C = {
    page: { minHeight: "calc(100dvh - 64px)", background: "#f4f6f9", color: "#111827", display: "flex", flexDirection: "column" as const },
    searchBar: { background: "#ffffff", borderBottom: "1px solid #e5e7eb", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 },
    searchInput: { flex: 1, background: "#ffffff", border: "1px solid #d1d5db", borderRadius: 14, padding: "15px 18px", color: "#111827", fontSize: 18, outline: "none" },
    clearBtn: { width: 48, height: 48, borderRadius: 12, background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 as const },

    filterBar: { background: "#ffffff", borderBottom: "1px solid #e5e7eb", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const },
    filterChip: (active: boolean) => ({
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "10px 14px", borderRadius: 20, fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: 44,
      background: active ? "#eef2ff" : "#f3f4f6",
      border: `1px solid ${active ? "#6366f1" : "#e5e7eb"}`,
      color: active ? "#4338ca" : "#374151",
    }),
    chipX: { marginLeft: 2, color: "#6366f1", fontSize: 16, lineHeight: 1 },

    filterPanel: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, background: "#f4f6f9", zIndex: 50, display: "flex", flexDirection: "column" as const },
    filterSearch: { background: "#ffffff", border: "1px solid #d1d5db", borderRadius: 12, padding: "13px 16px", color: "#111827", fontSize: 17, outline: "none", margin: "12px 14px 4px" },
    filterHeader: { padding: "14px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    filterTitle: { color: "#111827", fontWeight: 700, fontSize: 18 },
    filterList: { flex: 1, overflowY: "auto" as const, padding: "4px 10px 20px" },
    filterItem: (active: boolean) => ({
      padding: "14px 16px", borderRadius: 12, margin: "4px 0", cursor: "pointer", minHeight: 48,
      background: active ? "#eef2ff" : "#ffffff",
      border: "1px solid #e5e7eb",
      color: active ? "#4338ca" : "#374151",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }),

    // Item del listado navegable
    listaItem: (active: boolean) => ({
      padding: "14px 16px", borderRadius: 12, margin: "6px 0", cursor: "pointer",
      background: active ? "#eef2ff" : "#ffffff",
      border: `1px solid ${active ? "#c7d2fe" : "#e5e7eb"}`,
      display: "flex", flexDirection: "column" as const, gap: 5,
    }),
    listaItemTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
    listaItemName: (active: boolean) => ({ fontWeight: 700, fontSize: 17, lineHeight: 1.3, flex: 1, color: active ? "#4338ca" : "#111827" }),
    listaItemOrden: { color: "#6366f1", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" as const },
    listaItemMeta: { display: "flex", gap: 10, flexWrap: "wrap" as const, fontSize: 13, color: "#6b7280" },
    listaItemTag: { fontFamily: "monospace" as const, color: "#6b7280" },
    listaItemMuted: { color: "#c4c9d4" },

    results: { flex: 1, overflowY: "auto" as const, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 8 },
    artBtn: { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 16, padding: "16px 18px", textAlign: "left" as const, cursor: "pointer", width: "100%" },
    artName: { color: "#111827", fontWeight: 700, fontSize: 18, lineHeight: 1.3 },
    artSub: { color: "#6b7280", fontSize: 14, marginTop: 5, display: "flex", gap: 14, flexWrap: "wrap" as const },
    artStock: { color: "#16a34a", fontWeight: 700 },

    artSelected: { background: "#ffffff", borderBottom: "1px solid #e5e7eb", padding: "14px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    artSelectedInfo: { flex: 1, minWidth: 0 },
    artSelectedName: { color: "#111827", fontWeight: 700, fontSize: 20, lineHeight: 1.3 },
    artSelectedSub: { color: "#6b7280", fontSize: 14, marginTop: 3 },
    stockBadge: { background: "#dcfce7", color: "#15803d", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" as const },
    changeBtn: { background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px", color: "#374151", fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: 44 },

    navBar: { background: "#ffffff", borderBottom: "1px solid #e5e7eb", padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 },
    navBtn: { flex: 1, padding: "14px 0", borderRadius: 12, fontWeight: 700, fontSize: 16, border: "none", cursor: "pointer", minHeight: 48, background: "#eef2ff", color: "#4338ca" },
    navCounter: { color: "#6b7280", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" as const, textAlign: "center" as const, minWidth: 80 },

    tabs: { display: "flex", borderBottom: "1px solid #e5e7eb", background: "#ffffff" },
    tab: (active: boolean, color: string) => ({
      flex: 1, padding: "16px", fontWeight: 700, fontSize: 16, textAlign: "center" as const, cursor: "pointer", minHeight: 52,
      background: active ? "#ffffff" : "transparent", color: active ? color : "#9ca3af",
      borderBottom: active ? `3px solid ${color}` : "3px solid transparent",
    }),
    body: { flex: 1, overflowY: "auto" as const, padding: "14px", display: "flex", flexDirection: "column" as const, gap: 12 },
    card: { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 16, padding: "16px" },
    label: { color: "#6b7280", fontSize: 13, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8, display: "block" },
    input: { width: "100%", background: "#ffffff", border: "1px solid #d1d5db", borderRadius: 12, padding: "14px 14px", color: "#111827", fontSize: 18, outline: "none", boxSizing: "border-box" as const },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    typeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 },
    typeBtn: (active: boolean, color: string) => ({
      padding: "14px 6px", borderRadius: 12, fontWeight: 700, fontSize: 15, textAlign: "center" as const, cursor: "pointer", border: "none", minHeight: 50,
      background: active ? color : "#f3f4f6", color: active ? "#fff" : "#6b7280",
    }),
    bigInput: { width: "100%", background: "#ffffff", border: "2px solid #d1d5db", borderRadius: 14, padding: "16px", color: "#111827", fontSize: 32, fontWeight: 700, textAlign: "center" as const, outline: "none", boxSizing: "border-box" as const },
    resultante: { textAlign: "center" as const, marginTop: 8, fontSize: 15, color: "#6b7280" },
    saveBtn: (color: string, disabled: boolean) => ({
      width: "100%", padding: "18px", borderRadius: 16, fontWeight: 700, fontSize: 18, border: "none", cursor: disabled ? "not-allowed" : "pointer", minHeight: 56,
      background: disabled ? "#e5e7eb" : color, color: disabled ? "#9ca3af" : "#fff", opacity: 1,
    }),
    msg: (ok: boolean) => ({
      padding: "12px 14px", borderRadius: 12, fontSize: 15, fontWeight: 600, textAlign: "center" as const,
      background: ok ? "#dcfce7" : "#fee2e2", color: ok ? "#15803d" : "#b91c1c",
    }),
    empty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 12, color: "#9ca3af" },
    loadMoreBtn: { width: "100%", marginTop: 8, padding: "16px", borderRadius: 12, background: "#ffffff", border: "1px solid #e5e7eb", color: "#4338ca", fontWeight: 700, fontSize: 15, cursor: "pointer" },
  }

  const provsFiltrados = busqFiltro ? proveedores.filter(p => localMatch(busqFiltro, p.nombre)) : proveedores
  const catsFiltradas  = busqFiltro ? categorias.filter(c => localMatch(busqFiltro, c)) : categorias

  // ── Render del item del listado ───────────────────────
  const renderListaItem = (art: Articulo, i: number) => {
    const active = indiceActual === i
    return (
      <div key={art.id} ref={active ? activeItemRef : undefined} style={C.listaItem(active)} onClick={() => seleccionarDeLista(art, i)}>
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
          <button style={C.filterChip(listaLabel === "Orden de Depósito" && hayLista)} onClick={abrirOrden}>
            📦 Orden Depósito
            {listaLabel === "Orden de Depósito" && hayLista && (
              <span style={C.chipX} onClick={e => { e.stopPropagation(); limpiarLista() }}>×</span>
            )}
          </button>
          {hayFiltroActivo && (
            <button style={{ ...C.filterChip(false) as any, border: "none", color: "#ef4444", fontSize: 13, marginLeft: "auto" }}
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
            <button style={{ ...C.clearBtn, width: 40, height: 40 }} onClick={() => setPanelFiltro(null)}>✕</button>
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
                <div style={{ padding: "6px 14px 2px", color: "#6b7280", fontSize: 13 }}>
                  {listaOrden.length} de {listaTotal} artículos
                </div>
              )}
              {listaCargando && listaOrden.length === 0 && (
                <div style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Cargando...</div>
              )}
              <div ref={listaScrollRef} style={C.filterList}>
                {listaOrden.map((art, i) => renderListaItem(art, i))}
                {listaOrden.length < listaTotal && !listaCargando && (
                  <button style={C.loadMoreBtn} onClick={cargarMas}>
                    Cargar más ({listaOrden.length} / {listaTotal})
                  </button>
                )}
                {listaCargando && listaOrden.length > 0 && (
                  <div style={{ padding: "14px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>Cargando...</div>
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
          {errorBusqueda && <div style={{ padding: "12px 16px", background: "#fee2e2", color: "#b91c1c", fontSize: 14, margin: "8px 14px", borderRadius: 10 }}>Error: {errorBusqueda}</div>}
          {resultados.length > 0 && (
            <div style={C.results}>
              {resultados.map(art => (
                <button key={art.id} style={C.artBtn} onClick={() => abrirArticulo(art, { recorrido: null, index: null, push: true })}>
                  <div style={C.artName}>{art.descripcion}{articuloMarcaSuffix(art)}</div>
                  <div style={C.artSub}>
                    <span style={{ fontFamily: "monospace" }}>{articuloInfoLine(art)}</span>
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
          <span style={{ fontSize: 17 }}>Buscá un artículo para modificarlo</span>
          <span style={{ fontSize: 14, textAlign: "center" as const }}>o filtrá por proveedor / categoría / orden de depósito</span>
        </div>
      )}

      {/* ── Artículo seleccionado ── */}
      {articulo && !panelFiltro && (
        <>
          <div style={C.artSelected}>
            <div style={C.artSelectedInfo}>
              <div style={C.artSelectedName}>{articulo.descripcion}{articuloMarcaSuffix(articulo)}</div>
              <div style={C.artSelectedSub}>{articuloInfoLine(articulo)}</div>
            </div>
            <div style={C.stockBadge}>Stock: {articulo.stock_actual ?? 0}</div>
            <button style={C.changeBtn} onClick={volver}>
              {enNavegacion ? "Volver" : "Cambiar"}
            </button>
          </div>

          {enNavegacion && (
            <div style={C.navBar}>
              <button style={C.navBtn} onClick={() => irAdyacente("prev")}>← Anterior</button>
              <span style={C.navCounter}>{articulo.orden_deposito != null ? `#${articulo.orden_deposito}` : "—"}{listaTotal ? ` / ${listaTotal}` : ""}</span>
              <button style={C.navBtn} onClick={() => irAdyacente("next")}>Siguiente →</button>
            </div>
          )}

          <div style={C.tabs}>
            <div style={C.tab(seccion === "stock", "#d97706")} onClick={() => setSeccion("stock")}>Ajustar Stock</div>
            <div style={C.tab(seccion === "datos", "#2563eb")} onClick={() => setSeccion("datos")}>Datos del Artículo</div>
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
                    <div style={C.resultante}>Stock resultante: <strong style={{color:(stockResultante()??0)<0?"#dc2626":"#16a34a",fontSize:20}}>{stockResultante()}</strong></div>
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
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (!v) return
                      if (esQrOUrl(v)) { scanError(); toast.error("QR ignorado — escaneá el código de barras"); setCodigoBulto(""); return }
                      if (/^\d+$/.test(v) && v.length < 13) setCodigoBulto(v.padStart(13, "0"))
                    }}
                  />
                </div>
                <div style={C.card}>
                  <span style={C.label}>EAN 13 <span style={{color:"#9ca3af",fontWeight:400,textTransform:"none" as const}}>— puede tener varios</span></span>
                  <div style={{display:"flex",flexWrap:"wrap" as const,gap:8,background:"#ffffff",border:"1px solid #d1d5db",borderRadius:12,padding:"12px 12px",minHeight:56}}>
                    {ean13.map((e,i)=>(
                      <span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:20,padding:"6px 12px",color:"#374151",fontSize:16,fontFamily:"monospace"}}>
                        {e}<button type="button" onClick={()=>setEan13(p=>p.filter((_,j)=>j!==i))} style={{color:"#9ca3af",background:"none",border:"none",cursor:"pointer",fontSize:18,lineHeight:1,padding:0}}>×</button>
                      </span>
                    ))}
                    <input type="text" inputMode="numeric" value={eanInput} onChange={e=>setEanInput(e.target.value)}
                      placeholder={ean13.length===0?"Escribí un EAN y presioná Enter...":"Agregar otro..."}
                      style={{flex:1,minWidth:140,background:"transparent",border:"none",outline:"none",color:"#111827",fontSize:16}}
                      onKeyDown={e=>{ if((e.key==="Enter"||e.key===",")&&eanInput.trim()){ e.preventDefault(); if(agregarEan(eanInput)) setEanInput("") ; else setEanInput("") } }}
                      onBlur={()=>{ if(eanInput.trim()){ agregarEan(eanInput); setEanInput("") } }}
                    />
                  </div>
                  <div style={{color:"#9ca3af",fontSize:13,marginTop:6}}>Enter o coma para agregar · × para quitar</div>
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
